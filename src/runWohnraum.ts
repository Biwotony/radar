import pg from 'pg';

import { persistSuccessfulSourceFetch, type SqlClient } from './persistence.js';
import { loadSourcePolicy, runSourceOnce, sleep } from './scheduler.js';
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

async function runOnce(): Promise<void> {
  const client = await pool.connect();
  try {
    await runSourceOnce(
      SOURCE_NAME,
      source,
      asSqlClient(client),
      persistSuccessfulSourceFetch,
    );
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  try {
    if (ONCE) {
      await runOnce();
      return;
    }

    while (true) {
      await runOnce();

      const client = await pool.connect();
      let intervalMinutes: number;
      try {
        const policy = await loadSourcePolicy(asSqlClient(client), SOURCE_NAME);
        intervalMinutes = policy.crawlIntervalMinutes;
      } finally {
        client.release();
      }

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
  console.error(
    JSON.stringify({
      source: SOURCE_NAME,
      event: 'run_failed',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
