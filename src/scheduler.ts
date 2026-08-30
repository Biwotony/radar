import type { PersistenceStats, SqlClient, SourcePolicy } from './persistence.js';
import type { HousingSource, Observation } from './sources/types.js';

export type SchedulerLog = {
  source: string;
  observedAt: string;
  itemsSeen: number;
  listingsCreated: number;
  listingsUpdated: number;
  listingsChanged: number;
  lifecycleTransitions: PersistenceStats['lifecycleTransitions'];
  durationMs: number;
};

export type Logger = (entry: SchedulerLog) => void;

export type PersistObservations = (
  client: SqlClient,
  sourceName: string,
  observations: Observation[],
  observedAt: Date,
) => Promise<PersistenceStats>;

export async function runSourceOnce(
  sourceName: string,
  source: HousingSource,
  client: SqlClient,
  persist: PersistObservations,
  logger: Logger = (entry) => console.info(JSON.stringify(entry)),
  observedAt: Date = new Date(),
): Promise<PersistenceStats> {
  const startedAt = Date.now();
  const rawItems = await source.fetch();
  const observations = await Promise.all(rawItems.map((item) => source.parse(item)));
  const stats = await persist(client, sourceName, observations, observedAt);

  logger({
    source: sourceName,
    observedAt: observedAt.toISOString(),
    ...stats,
    durationMs: Date.now() - startedAt,
  });

  return stats;
}

export async function loadSourcePolicy(
  client: SqlClient,
  sourceName: string,
): Promise<SourcePolicy> {
  const result = await client.query<{ policy: SourcePolicy }>(
    `SELECT policy
     FROM sources
     WHERE name = $1 AND status = 'active'`,
    [sourceName],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Active source not found: ${sourceName}`);
  }

  if (!Number.isFinite(row.policy.crawlIntervalMinutes) || row.policy.crawlIntervalMinutes <= 0) {
    throw new Error(`Invalid crawl interval for ${sourceName}`);
  }

  return row.policy;
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
