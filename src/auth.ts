import { createHash, randomBytes } from 'node:crypto';

import type { SqlClient } from './persistence.js';

export const MAGIC_LINK_TTL_MS = 15 * 60_000;
export const MAGIC_LINK_RATE_LIMIT_MS = 60_000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
export const SESSION_COOKIE = 'radar_session';

export type University = 'frankfurt_uas' | 'goethe';
export type SavedSearchInput = {
  university: University;
  maxTotalMonthlyRent: number;
  moveInMonth: string | null;
  housingTypes: string[];
};
export type SavedSearch = SavedSearchInput & { id: string; isActive: boolean };
export type AuthUser = { id: string; email: string };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function validateSavedSearch(input: SavedSearchInput): SavedSearchInput {
  if (input.university !== 'frankfurt_uas' && input.university !== 'goethe') throw new Error('Invalid university');
  if (!Number.isInteger(input.maxTotalMonthlyRent) || input.maxTotalMonthlyRent <= 0 || input.maxTotalMonthlyRent > 5000) throw new Error('Invalid rent ceiling');
  if (input.moveInMonth && !/^\d{4}-\d{2}-01$/.test(input.moveInMonth)) throw new Error('Invalid move-in month');
  const housingTypes = [...new Set(input.housingTypes.filter((value) => ['dorm', 'wg', 'studio'].includes(value)))];
  if (housingTypes.length === 0) throw new Error('Choose at least one housing type');
  return { ...input, housingTypes };
}

type IdRow = { id: string };
type UserRow = { id: string; email: string };
type SearchRow = {
  id: string;
  university: University;
  max_total_monthly_rent: number;
  move_in_month: string | Date | null;
  housing_types: string[];
  is_active: boolean;
};

export type MagicLinkClaim = { status: 'claimed'; userId: string; tokenId: string } | { status: 'rate_limited' };

export class PostgresAuthRepository {
  constructor(private readonly db: SqlClient) {}

  async claimMagicLink(email: string, tokenHash: string, now: Date, expiresAt: Date): Promise<MagicLinkClaim> {
    const normalized = normalizeEmail(email);
    await this.db.query('BEGIN');
    try {
      const insertedUser = await this.db.query<IdRow>(
        `INSERT INTO users (email, updated_at) VALUES ($1, NOW()) ON CONFLICT (email) DO UPDATE SET updated_at = NOW() RETURNING id`,
        [normalized],
      );
      const userId = String(insertedUser.rows[0]?.id);
      await this.db.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      const recent = await this.db.query<IdRow>(
        `SELECT id FROM magic_link_tokens WHERE user_id = $1 AND status IN ('pending', 'sent') AND requested_at > $2 LIMIT 1`,
        [userId, new Date(now.getTime() - MAGIC_LINK_RATE_LIMIT_MS)],
      );
      if (recent.rows.length > 0) {
        await this.db.query('COMMIT');
        return { status: 'rate_limited' };
      }
      const inserted = await this.db.query<IdRow>(
        `INSERT INTO magic_link_tokens (user_id, token_hash, requested_at, expires_at) VALUES ($1, $2, $3, $4) RETURNING id`,
        [userId, tokenHash, now, expiresAt],
      );
      await this.db.query('COMMIT');
      return { status: 'claimed', userId, tokenId: String(inserted.rows[0]?.id) };
    } catch (error) {
      await this.db.query('ROLLBACK');
      throw error;
    }
  }

  async markMagicLinkSent(tokenId: string): Promise<void> {
    await this.db.query(`UPDATE magic_link_tokens SET status = 'sent', send_error = NULL WHERE id = $1`, [tokenId]);
  }

  async markMagicLinkFailed(tokenId: string, error: string): Promise<void> {
    await this.db.query(`UPDATE magic_link_tokens SET status = 'failed', send_error = $2 WHERE id = $1`, [tokenId, error]);
  }

  async consumeMagicLink(tokenHash: string, now: Date, sessionHash: string, sessionExpiresAt: Date): Promise<AuthUser | null> {
    await this.db.query('BEGIN');
    try {
      const consumed = await this.db.query<UserRow>(
        `UPDATE magic_link_tokens m SET used_at = $2 WHERE m.token_hash = $1 AND m.status = 'sent' AND m.used_at IS NULL AND m.expires_at > $2 RETURNING m.user_id AS id, (SELECT email FROM users WHERE id = m.user_id) AS email`,
        [tokenHash, now],
      );
      const user = consumed.rows[0];
      if (!user) {
        await this.db.query('COMMIT');
        return null;
      }
      await this.db.query(
        `INSERT INTO user_sessions (user_id, token_hash, created_at, expires_at, last_seen_at) VALUES ($1, $2, $3, $4, $3)`,
        [user.id, sessionHash, now, sessionExpiresAt],
      );
      await this.db.query('COMMIT');
      return { id: String(user.id), email: user.email };
    } catch (error) {
      await this.db.query('ROLLBACK');
      throw error;
    }
  }

  async sessionUser(sessionHash: string, now: Date): Promise<AuthUser | null> {
    const result = await this.db.query<UserRow>(
      `SELECT u.id, u.email FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 LIMIT 1`,
      [sessionHash, now],
    );
    return result.rows[0] ? { id: String(result.rows[0].id), email: result.rows[0].email } : null;
  }

  async revokeSession(sessionHash: string): Promise<void> {
    await this.db.query(`UPDATE user_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL`, [sessionHash]);
  }

  async listSavedSearches(userId: string): Promise<SavedSearch[]> {
    const result = await this.db.query<SearchRow>(
      `SELECT id, university, max_total_monthly_rent, move_in_month, housing_types, is_active FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC, id DESC`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      university: row.university,
      maxTotalMonthlyRent: Number(row.max_total_monthly_rent),
      moveInMonth: row.move_in_month instanceof Date ? row.move_in_month.toISOString().slice(0, 7) + '-01' : row.move_in_month ? String(row.move_in_month).slice(0, 7) + '-01' : null,
      housingTypes: row.housing_types,
      isActive: row.is_active,
    }));
  }

  async createSavedSearch(userId: string, input: SavedSearchInput): Promise<string> {
    const valid = validateSavedSearch(input);
    const result = await this.db.query<IdRow>(
      `INSERT INTO saved_searches (user_id, university, max_total_monthly_rent, move_in_month, housing_types) VALUES ($1, $2, $3, $4, $5::text[]) RETURNING id`,
      [userId, valid.university, valid.maxTotalMonthlyRent, valid.moveInMonth, valid.housingTypes],
    );
    return String(result.rows[0]?.id);
  }

  async setSavedSearchActive(userId: string, searchId: string, active: boolean): Promise<boolean> {
    const result = await this.db.query<IdRow>(
      `UPDATE saved_searches SET is_active = $3, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id`,
      [searchId, userId, active],
    );
    return result.rows.length === 1;
  }

  async deleteSavedSearch(userId: string, searchId: string): Promise<boolean> {
    const result = await this.db.query<IdRow>(
      `DELETE FROM saved_searches WHERE id = $1 AND user_id = $2 RETURNING id`,
      [searchId, userId],
    );
    return result.rows.length === 1;
  }
}
