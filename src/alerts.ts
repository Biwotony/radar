import { createHash } from 'node:crypto';

import type { LifecycleState, SqlClient } from './persistence.js';
import type { ExtractedFact } from './sources/types.js';

const SUPPORTED_HOUSING_TYPES = ['dorm', 'wg', 'studio'] as const;
type SupportedHousingType = (typeof SUPPORTED_HOUSING_TYPES)[number];

type ListingFacts = Record<string, ExtractedFact<unknown> | undefined>;

export type AlertCandidate = {
  userId: string;
  email: string;
  savedSearchId: string;
  university: 'frankfurt_uas' | 'goethe';
  maxTotalMonthlyRent: number;
  moveInMonth: Date | string | null;
  housingTypes: string[];
  listingId: string;
  lifecycleState: LifecycleState;
  extractedFacts: ListingFacts;
  sourceUrl: string;
};

export type AlertEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailSendResult = {
  messageId: string | null;
};

export interface EmailSender {
  send(message: AlertEmail, idempotencyKey: string): Promise<EmailSendResult>;
}

export type AlertDeliveryResult = 'sent' | 'skipped' | 'failed';

export interface AlertRepository {
  findCandidates(): Promise<AlertCandidate[]>;
  deliverExactlyOnce(
    candidate: AlertCandidate,
    alertKey: string,
    payload: Record<string, unknown>,
    send: () => Promise<EmailSendResult>,
  ): Promise<AlertDeliveryResult>;
}

export type AlertPassStats = {
  candidatesSeen: number;
  matched: number;
  sent: number;
  skippedAlreadySent: number;
  failed: number;
};

function fact<T>(facts: ListingFacts, key: string): ExtractedFact<T> | undefined {
  return facts[key] as ExtractedFact<T> | undefined;
}

function normalizedMonth(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) return null;
    return value.toISOString().slice(0, 7);
  }

  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}`;

  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (german) return `${german[3]}-${german[2]?.padStart(2, '0')}`;

  return null;
}

function classifyHousingType(roomType: ExtractedFact<string> | undefined): SupportedHousingType | null {
  if (!roomType || roomType.status === 'NOT_STATED' || roomType.status === 'CONFLICTING') {
    return null;
  }

  const value = roomType.value?.toLowerCase() ?? '';
  if (/wohnheim|dorm|studentenwohn/.test(value)) return 'dorm';
  if (/studio|apartment|wohnung|1-zimmer/.test(value)) return 'studio';
  if (/wg|zimmer|room/.test(value)) return 'wg';
  return null;
}

function searchAcceptsUnknownHousingType(housingTypes: string[]): boolean {
  return SUPPORTED_HOUSING_TYPES.every((type) => housingTypes.includes(type));
}

export function matchesSavedSearch(candidate: AlertCandidate): boolean {
  if (candidate.lifecycleState !== 'NEW' && candidate.lifecycleState !== 'ACTIVE') return false;

  // Budget is a hard ceiling. Unknown/conflicting rent cannot be proven to fit it,
  // so we deliberately suppress the alert instead of guessing.
  const rent = fact<number>(candidate.extractedFacts, 'totalMonthlyRent');
  if (!rent || rent.status !== 'CONFIRMED' || typeof rent.value !== 'number') return false;
  if (rent.value > candidate.maxTotalMonthlyRent) return false;

  const requestedMoveIn = normalizedMonth(candidate.moveInMonth);
  if (requestedMoveIn) {
    const availableFrom = fact<string>(candidate.extractedFacts, 'availableFrom');
    if (!availableFrom || availableFrom.status === 'NOT_STATED' || availableFrom.status === 'CONFLICTING') {
      return false;
    }
    if (normalizedMonth(availableFrom.value) !== requestedMoveIn) return false;
  }

  const roomType = fact<string>(candidate.extractedFacts, 'roomType');
  const housingType = classifyHousingType(roomType);
  if (housingType) {
    if (!candidate.housingTypes.includes(housingType)) return false;
  } else if (!searchAcceptsUnknownHousingType(candidate.housingTypes)) {
    return false;
  }

  // Current wohnraum-gesucht observations do not carry university eligibility.
  // Once eligibleUniversities is populated, enforce it; until then this dimension
  // is explicitly unknown and does not disqualify the listing.
  const eligibleUniversities = fact<string[]>(candidate.extractedFacts, 'eligibleUniversities');
  if (
    eligibleUniversities &&
    eligibleUniversities.status !== 'NOT_STATED' &&
    eligibleUniversities.status !== 'CONFLICTING' &&
    Array.isArray(eligibleUniversities.value) &&
    !eligibleUniversities.value.includes(candidate.university)
  ) {
    return false;
  }

  return true;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'not stated';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function renderFact(label: string, extracted: ExtractedFact<unknown> | undefined): string {
  if (!extracted || extracted.status === 'NOT_STATED') return `${label}: not stated`;
  return `${label}: ${displayValue(extracted.value)} (${extracted.status.toLowerCase()})`;
}

export function buildAlertEmail(candidate: AlertCandidate): AlertEmail {
  const facts = candidate.extractedFacts;
  const factLines = [
    renderFact('Room type', facts.roomType),
    renderFact('Area', facts.area),
    renderFact('Move-in', facts.availableFrom),
    renderFact('Total monthly rent', facts.totalMonthlyRent),
    renderFact('University eligibility', facts.eligibleUniversities),
  ];
  const text = [
    'A new student-housing listing matches your Radar search.',
    '',
    ...factLines,
    '',
    `Listing freshness: ${candidate.lifecycleState}`,
    `Source: ${candidate.sourceUrl}`,
    '',
    'Radar does not fill in facts the source did not state.',
  ].join('\n');

  const htmlFacts = factLines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  const safeUrl = escapeHtml(candidate.sourceUrl);
  const html = [
    '<p>A new student-housing listing matches your Radar search.</p>',
    htmlFacts,
    `<p>Listing freshness: ${escapeHtml(candidate.lifecycleState)}</p>`,
    `<p><a href="${safeUrl}">View the original listing</a></p>`,
    '<p>Radar does not fill in facts the source did not state.</p>',
  ].join('');

  return {
    to: candidate.email,
    subject: 'New student housing match in Frankfurt',
    text,
    html,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function alertKey(candidate: AlertCandidate): string {
  return createHash('sha256')
    .update(`${candidate.userId}:${candidate.savedSearchId}:${candidate.listingId}`)
    .digest('hex');
}

export async function runAlertPass(
  repository: AlertRepository,
  emailSender: EmailSender,
): Promise<AlertPassStats> {
  const candidates = await repository.findCandidates();
  const stats: AlertPassStats = {
    candidatesSeen: candidates.length,
    matched: 0,
    sent: 0,
    skippedAlreadySent: 0,
    failed: 0,
  };

  for (const candidate of candidates) {
    if (!matchesSavedSearch(candidate)) continue;
    stats.matched += 1;

    const key = alertKey(candidate);
    const email = buildAlertEmail(candidate);
    const result = await repository.deliverExactlyOnce(
      candidate,
      key,
      {
        sourceUrl: candidate.sourceUrl,
        extractedFacts: candidate.extractedFacts,
      },
      () => emailSender.send(email, key),
    );

    if (result === 'sent') stats.sent += 1;
    if (result === 'skipped') stats.skippedAlreadySent += 1;
    if (result === 'failed') stats.failed += 1;
  }

  return stats;
}

type CandidateRow = {
  user_id: string;
  email: string;
  saved_search_id: string;
  university: 'frankfurt_uas' | 'goethe';
  max_total_monthly_rent: number;
  move_in_month: Date | string | null;
  housing_types: string[];
  listing_id: string;
  lifecycle_state: 'NEW' | 'ACTIVE';
  extracted_facts: ListingFacts;
  source_url: string;
};

type AlertRow = {
  id: string;
  status: 'pending' | 'sent' | 'failed';
};

export class PostgresAlertRepository implements AlertRepository {
  constructor(private readonly client: SqlClient) {}

  async findCandidates(): Promise<AlertCandidate[]> {
    const result = await this.client.query<CandidateRow>(
      `SELECT
         u.id AS user_id,
         u.email,
         ss.id AS saved_search_id,
         ss.university,
         ss.max_total_monthly_rent,
         ss.move_in_month,
         ss.housing_types,
         l.id AS listing_id,
         l.lifecycle_state,
         l.extracted_facts,
         source_link.source_url
       FROM saved_searches ss
       JOIN users u ON u.id = ss.user_id
       JOIN listings l ON l.lifecycle_state IN ('NEW', 'ACTIVE')
       JOIN LATERAL (
         SELECT si.source_url
         FROM listing_source_items lsi
         JOIN source_items si ON si.id = lsi.source_item_id
         WHERE lsi.listing_id = l.id
         ORDER BY si.last_seen_at DESC, si.id ASC
         LIMIT 1
       ) source_link ON TRUE
       LEFT JOIN alerts_sent a
         ON a.user_id = u.id
        AND a.saved_search_id = ss.id
        AND a.listing_id = l.id
       WHERE ss.is_active = TRUE
         AND (a.id IS NULL OR a.status <> 'sent')
       ORDER BY l.last_confirmed_active_at DESC NULLS LAST, l.id ASC`,
    );

    return result.rows.map((row) => ({
      userId: String(row.user_id),
      email: row.email,
      savedSearchId: String(row.saved_search_id),
      university: row.university,
      maxTotalMonthlyRent: Number(row.max_total_monthly_rent),
      moveInMonth: row.move_in_month,
      housingTypes: row.housing_types,
      listingId: String(row.listing_id),
      lifecycleState: row.lifecycle_state,
      extractedFacts: row.extracted_facts,
      sourceUrl: row.source_url,
    }));
  }

  async deliverExactlyOnce(
    candidate: AlertCandidate,
    key: string,
    payload: Record<string, unknown>,
    send: () => Promise<EmailSendResult>,
  ): Promise<AlertDeliveryResult> {
    await this.client.query('BEGIN');

    try {
      const inserted = await this.client.query<AlertRow>(
        `INSERT INTO alerts_sent (
           user_id, saved_search_id, listing_id, alert_key, status,
           attempt_count, payload, updated_at
         )
         VALUES ($1, $2, $3, $4, 'pending', 0, $5::jsonb, NOW())
         ON CONFLICT (user_id, saved_search_id, listing_id) DO NOTHING
         RETURNING id, status`,
        [
          candidate.userId,
          candidate.savedSearchId,
          candidate.listingId,
          key,
          JSON.stringify(payload),
        ],
      );

      let alert = inserted.rows[0];
      if (!alert) {
        const existing = await this.client.query<AlertRow>(
          `SELECT id, status
           FROM alerts_sent
           WHERE user_id = $1 AND saved_search_id = $2 AND listing_id = $3
           FOR UPDATE`,
          [candidate.userId, candidate.savedSearchId, candidate.listingId],
        );
        alert = existing.rows[0];
      }

      if (!alert) throw new Error('Failed to claim alert delivery');
      if (alert.status === 'sent') {
        await this.client.query('COMMIT');
        return 'skipped';
      }

      try {
        const delivered = await send();
        await this.client.query(
          `UPDATE alerts_sent
           SET status = 'sent',
               provider_message_id = $2,
               sent_at = NOW(),
               attempt_count = attempt_count + 1,
               last_error = NULL,
               updated_at = NOW()
           WHERE id = $1`,
          [alert.id, delivered.messageId],
        );
        await this.client.query('COMMIT');
        return 'sent';
      } catch (error) {
        await this.client.query(
          `UPDATE alerts_sent
           SET status = 'failed',
               attempt_count = attempt_count + 1,
               last_error = $2,
               updated_at = NOW()
           WHERE id = $1`,
          [alert.id, error instanceof Error ? error.message : String(error)],
        );
        await this.client.query('COMMIT');
        return 'failed';
      }
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }
}
