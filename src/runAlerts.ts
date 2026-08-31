import pg from 'pg';

import { PostgresAlertRepository, runAlertPass } from './alerts.js';
import { ResendEmailSender } from './email/resend.js';
import type { SqlClient } from './persistence.js';
import { failureLog, sleep } from './scheduler.js';

const ONCE = process.argv.includes('--once');
const databaseUrl = process.env.DATABASE_URL;
const resendApiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.ALERT_FROM_EMAIL;
const intervalMinutes = Number(process.env.ALERT_INTERVAL_MINUTES ?? '5');

if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!resendApiKey) throw new Error('RESEND_API_KEY is required');
if (!fromEmail) throw new Error('ALERT_FROM_EMAIL is required');
if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
  throw new Error('ALERT_INTERVAL_MINUTES must be a positive number');
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const sender = new ResendEmailSender(resendApiKey, fromEmail);

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
    const stats = await runAlertPass(new PostgresAlertRepository(asSqlClient(client)), sender);
    console.info(
      JSON.stringify({
        event: 'alert_pass_completed',
        ...stats,
      }),
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

    // Separate alert loop by design: ingestion remains healthy even if the email
    // provider is degraded, and alert delivery can retry independently.
    while (true) {
      try {
        await runOnce();
      } catch (error) {
        console.error(JSON.stringify(failureLog('alerts', error)));
      }

      console.info(JSON.stringify({ event: 'alert_sleeping', intervalMinutes }));
      await sleep(intervalMinutes * 60_000);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify(failureLog('alerts', error)));
  process.exitCode = 1;
});
