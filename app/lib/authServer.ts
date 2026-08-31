import pg from 'pg';
import { cookies } from 'next/headers';

import {
  PostgresAuthRepository,
  SESSION_COOKIE,
  hashToken,
  type AuthUser,
} from '../../src/auth';
import type { SqlClient } from '../../src/persistence';

let writePool: pg.Pool | null = null;

function pool(): pg.Pool {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for auth and saved-search writes');
  writePool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
  return writePool;
}

function sqlClient(): SqlClient {
  return {
    async query<T extends Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }> {
      const result = await pool().query(text, values as unknown[] | undefined);
      return { rows: result.rows as T[] };
    },
  };
}

export function authRepository(): PostgresAuthRepository {
  return new PostgresAuthRepository(sqlClient());
}

export async function currentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return authRepository().sessionUser(hashToken(token), new Date());
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.AUTH_COOKIE_SECURE !== 'false',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export async function sendMagicLink(email: string, url: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_FROM_EMAIL ?? process.env.ALERT_FROM_EMAIL;
  if (!apiKey) throw new Error('RESEND_API_KEY is required');
  if (!from) throw new Error('AUTH_FROM_EMAIL or ALERT_FROM_EMAIL is required');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Sign in to Frankfurt Student Housing Radar',
      text: `Use this link to sign in to Radar. It expires in 15 minutes and can only be used once:\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Use this link to sign in to Radar. It expires in 15 minutes and can only be used once.</p><p><a href="${escapeHtml(url)}">Sign in to Radar</a></p><p>If you did not request this, you can ignore this email.</p>`,
    }),
  });
  if (!response.ok) throw new Error(`Resend magic-link send failed with HTTP ${response.status}`);
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
