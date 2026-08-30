import { createHash } from 'node:crypto';

import type { Observation } from './sources/types.js';

export type LifecycleState =
  | 'NEW'
  | 'ACTIVE'
  | 'POSSIBLY_STALE'
  | 'INACTIVE'
  | 'REMOVED';

export type SourcePolicy = {
  crawlIntervalMinutes: number;
  missingBeforeStale: number;
  missingBeforeInactive: number;
  explicit404MeansRemoved: boolean;
};

export type ListingState = {
  lifecycleState: LifecycleState;
  extractedFacts: Observation['extractedFacts'];
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastChangedAt: Date;
  lastConfirmedActiveAt: Date | null;
};

export type ListingTransition = ListingState & {
  factsChanged: boolean;
};

export interface SqlClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }

  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function observationHash(observation: Observation): string {
  return createHash('sha256')
    .update(stableJson(observation.extractedFacts))
    .digest('hex');
}

export function applySighting(
  current: ListingState | null,
  extractedFacts: Observation['extractedFacts'],
  observedAt: Date,
): ListingTransition {
  if (current === null) {
    return {
      lifecycleState: 'NEW',
      extractedFacts,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      lastChangedAt: observedAt,
      lastConfirmedActiveAt: observedAt,
      factsChanged: true,
    };
  }

  const factsChanged = stableJson(current.extractedFacts) !== stableJson(extractedFacts);

  return {
    lifecycleState: 'ACTIVE',
    extractedFacts,
    firstSeenAt: current.firstSeenAt,
    lastSeenAt: observedAt,
    lastChangedAt: factsChanged ? observedAt : current.lastChangedAt,
    lastConfirmedActiveAt: observedAt,
    factsChanged,
  };
}

export function stateAfterMisses(
  currentState: LifecycleState,
  consecutiveMisses: number,
  policy: SourcePolicy,
): LifecycleState {
  if (currentState === 'REMOVED') {
    return 'REMOVED';
  }

  if (consecutiveMisses >= policy.missingBeforeInactive) {
    return 'INACTIVE';
  }

  if (consecutiveMisses >= policy.missingBeforeStale) {
    return 'POSSIBLY_STALE';
  }

  return currentState;
}

type SourceRow = {
  id: string;
  policy: SourcePolicy;
};

type SourceItemRow = {
  id: string;
};

type ListingRow = {
  id: string;
  lifecycle_state: LifecycleState;
  extracted_facts: Observation['extractedFacts'];
  first_seen_at: Date;
  last_seen_at: Date;
  last_changed_at: Date;
  last_confirmed_active_at: Date | null;
};

type MissedListingRow = {
  id: string;
  lifecycle_state: LifecycleState;
  min_misses: number | string;
};

function listingStateFromRow(row: ListingRow): ListingState {
  return {
    lifecycleState: row.lifecycle_state,
    extractedFacts: row.extracted_facts,
    firstSeenAt: new Date(row.first_seen_at),
    lastSeenAt: new Date(row.last_seen_at),
    lastChangedAt: new Date(row.last_changed_at),
    lastConfirmedActiveAt: row.last_confirmed_active_at
      ? new Date(row.last_confirmed_active_at)
      : null,
  };
}

/**
 * Persists one successful, complete source fetch. The supplied SqlClient must be a
 * dedicated transaction-capable connection; failed/partial fetches must never call
 * this function because absence in a successful fetch is lifecycle evidence.
 */
export async function persistSuccessfulSourceFetch(
  client: SqlClient,
  sourceName: string,
  observations: Observation[],
  observedAt: Date = new Date(),
): Promise<void> {
  await client.query('BEGIN');

  try {
    const sourceResult = await client.query<SourceRow>(
      `SELECT id, policy
       FROM sources
       WHERE name = $1 AND status = 'active'
       FOR UPDATE`,
      [sourceName],
    );

    const source = sourceResult.rows[0];
    if (!source) {
      throw new Error(`Active source not found: ${sourceName}`);
    }

    const seenSourceItemIds: string[] = [];

    for (const observation of observations) {
      const sourceItemResult = await client.query<SourceItemRow>(
        `INSERT INTO source_items (
           source_id, external_id, source_url, first_seen_at, last_seen_at,
           consecutive_misses, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $4, 0, $4, $4)
         ON CONFLICT (source_id, external_id)
         DO UPDATE SET
           source_url = EXCLUDED.source_url,
           last_seen_at = EXCLUDED.last_seen_at,
           consecutive_misses = 0,
           updated_at = EXCLUDED.updated_at
         RETURNING id`,
        [source.id, observation.externalId, observation.sourceUrl, observedAt],
      );

      const sourceItem = sourceItemResult.rows[0];
      if (!sourceItem) {
        throw new Error(`Failed to upsert source item ${observation.externalId}`);
      }

      seenSourceItemIds.push(sourceItem.id);

      await client.query(
        `INSERT INTO source_snapshots (
           source_item_id, fetched_at, content_hash, raw_payload, created_at
         )
         VALUES ($1, $2, $3, $4::jsonb, $2)`,
        [
          sourceItem.id,
          observedAt,
          observationHash(observation),
          JSON.stringify(observation),
        ],
      );

      const listingResult = await client.query<ListingRow>(
        `SELECT
           l.id, l.lifecycle_state, l.extracted_facts,
           l.first_seen_at, l.last_seen_at, l.last_changed_at,
           l.last_confirmed_active_at
         FROM listings l
         JOIN listing_source_items lsi ON lsi.listing_id = l.id
         WHERE lsi.source_item_id = $1
         LIMIT 1
         FOR UPDATE OF l`,
        [sourceItem.id],
      );

      const existing = listingResult.rows[0];
      const transition = applySighting(
        existing ? listingStateFromRow(existing) : null,
        observation.extractedFacts,
        observedAt,
      );

      let listingId: string;

      if (!existing) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO listings (
             lifecycle_state, extracted_facts, first_seen_at, last_seen_at,
             last_changed_at, last_confirmed_active_at, created_at, updated_at
           )
           VALUES ('NEW', $1::jsonb, $2, $2, $2, $2, $2, $2)
           RETURNING id`,
          [JSON.stringify(transition.extractedFacts), observedAt],
        );

        const created = inserted.rows[0];
        if (!created) {
          throw new Error(`Failed to create listing for ${observation.externalId}`);
        }

        listingId = created.id;

        await client.query(
          `INSERT INTO listing_source_items (listing_id, source_item_id, created_at)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [listingId, sourceItem.id, observedAt],
        );
      } else {
        listingId = existing.id;

        await client.query(
          `UPDATE listings
           SET lifecycle_state = 'ACTIVE',
               extracted_facts = $2::jsonb,
               last_seen_at = $3,
               last_changed_at = CASE WHEN $4 THEN $3 ELSE last_changed_at END,
               last_confirmed_active_at = $3,
               updated_at = $3
           WHERE id = $1`,
          [
            listingId,
            JSON.stringify(transition.extractedFacts),
            observedAt,
            transition.factsChanged,
          ],
        );
      }
    }

    const missedItems = await client.query<SourceItemRow>(
      `UPDATE source_items
       SET consecutive_misses = consecutive_misses + 1,
           updated_at = $3
       WHERE source_id = $1
         AND NOT (id = ANY($2::bigint[]))
       RETURNING id`,
      [source.id, seenSourceItemIds, observedAt],
    );

    if (missedItems.rows.length > 0) {
      const missedIds = missedItems.rows.map((row) => row.id);
      const affectedListings = await client.query<MissedListingRow>(
        `SELECT
           l.id,
           l.lifecycle_state,
           MIN(si.consecutive_misses) AS min_misses
         FROM listings l
         JOIN listing_source_items target_lsi ON target_lsi.listing_id = l.id
         JOIN listing_source_items all_lsi ON all_lsi.listing_id = l.id
         JOIN source_items si ON si.id = all_lsi.source_item_id
         WHERE target_lsi.source_item_id = ANY($1::bigint[])
         GROUP BY l.id, l.lifecycle_state
         FOR UPDATE OF l`,
        [missedIds],
      );

      for (const listing of affectedListings.rows) {
        const nextState = stateAfterMisses(
          listing.lifecycle_state,
          Number(listing.min_misses),
          source.policy,
        );

        if (nextState !== listing.lifecycle_state) {
          await client.query(
            `UPDATE listings
             SET lifecycle_state = $2::listing_lifecycle_state,
                 updated_at = $3
             WHERE id = $1`,
            [listing.id, nextState, observedAt],
          );
        }
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
