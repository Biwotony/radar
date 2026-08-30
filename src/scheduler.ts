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

export type SchedulerFailureLog = {
  source: string;
  event: 'run_failed';
  error: string;
  code?: string | number;
  status?: string | number;
  statusCode?: string | number;
};

export type Logger = (entry: SchedulerLog) => void;
export type FailureLogger = (entry: SchedulerFailureLog) => void;

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

function optionalErrorField(
  error: Record<string, unknown>,
  key: 'code' | 'status' | 'statusCode',
): string | number | undefined {
  const value = error[key];
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

export function failureLog(sourceName: string, error: unknown): SchedulerFailureLog {
  const record = error !== null && typeof error === 'object'
    ? error as Record<string, unknown>
    : {};

  return {
    source: sourceName,
    event: 'run_failed',
    error: error instanceof Error ? error.message : String(error),
    code: optionalErrorField(record, 'code'),
    status: optionalErrorField(record, 'status'),
    statusCode: optionalErrorField(record, 'statusCode'),
  };
}

/**
 * Runs one unattended loop cycle. A transient fetch/parse/persist/policy-refresh
 * failure is logged and the previous known-good interval is retained, so the
 * caller can sleep and retry instead of terminating the process.
 */
export async function runLoopCycle(
  sourceName: string,
  currentIntervalMinutes: number,
  runOnce: () => Promise<void>,
  reloadPolicy: () => Promise<SourcePolicy>,
  logger: FailureLogger = (entry) => console.error(JSON.stringify(entry)),
): Promise<number> {
  try {
    await runOnce();
    const policy = await reloadPolicy();
    return policy.crawlIntervalMinutes;
  } catch (error) {
    logger(failureLog(sourceName, error));
    return currentIntervalMinutes;
  }
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
