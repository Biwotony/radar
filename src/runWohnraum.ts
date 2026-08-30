import pg from 'pg';

import { persistSuccessfulSourceFetch, type SqlClient } from './persistence.js';
import {
  failureLog,
  loadSourcePolicy,
  runLoopCycle,
  runSourceOnce,
  sleep,
} from './scheduler.js';
import { WohnraumGesuchtSource } from './sources/wohnraumGesucht.js';

const SOURCE_NAME = 'wohnraum-gesucht.de';
const ONCE = process.argv.includes('--once');
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const source = new WohnraumGesuchtSource();

function asSqlClient(client: pg.PoolClient): SqlClient {
  return {
    async query<T extends Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<{ rows: T[] }> {
      const result = await client.query(text, values as unknown[] | undefined);
      return { rows: result.rows as T[] };
    },
  };
}

async function withClient<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await work(asSqlClient(client));
  } finally {
    client.release();
  }
}

async function runOnce(): Promise<void> {
  await withClient((client) =>
    runSourceOnce(
      SOURCE_NAME,
      source,
      client,
      persistSuccessfulSourceFetch,
    ).then(() => undefined),
  );
}

async function loadPolicy() {
  return withClient((client) => loadSourcePolicy(client, SOURCE_NAME));
}

async function main(): Promise<void> {
  try {
    if (ONCE) {
      await runOnce();
      return;
    }

    // Startup preflight: fail loudly/non-zero if the database or active source policy
    // is unavailable before the unattended loop starts.
    let intervalMinutes = (await loadPolicy()).crawlIntervalMinutes;

    while (true) {
      // Intentionally sequential: the next cycle is not started until the current
      // fetch/parse/persist path has completed and the full sleep interval has elapsed.
      // Persistence also serializes same-source writes on the source row.
      intervalMinutes = await runLoopCycle(
        SOURCE_NAME,
        intervalMinutes,
        runOnce,
        loadPolicy,
      );

      console.info(
        JSON.stringify({
          source: SOURCE_NAME,
          event: 'sleeping',
          intervalMinutes,
        }),
      );
      await sleep(intervalMinutes * 60_000);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify(failureLog(SOURCE_NAME, error)));
  process.exitCode = 1;
});
