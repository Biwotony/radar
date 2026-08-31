import assert from 'node:assert/strict';
import test from 'node:test';

import { MAGIC_LINK_RATE_LIMIT_MS, PostgresAuthRepository, hashToken, validateSavedSearch } from './auth.js';
import type { SqlClient } from './persistence.js';

type Row = Record<string, unknown>;

class ScriptedDb implements SqlClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  constructor(private readonly responder: (text: string, values: readonly unknown[]) => Row[] = () => []) {}
  async query<T extends Row>(text: string, values: readonly unknown[] = []): Promise<{ rows: T[] }> {
    this.calls.push({ text, values });
    return { rows: this.responder(text, values) as T[] };
  }
}

test('magic-link requests are rate-limited per email inside the locked user transaction', async () => {
  const now = new Date('2026-08-31T18:00:00Z');
  const db = new ScriptedDb((text) => {
    if (text.startsWith('INSERT INTO users')) return [{ id: '7' }];
    if (text.includes('FROM magic_link_tokens') && text.includes("status IN ('pending', 'sent')")) return [{ id: '99' }];
    return [];
  });
  const repository = new PostgresAuthRepository(db);
  const result = await repository.claimMagicLink('Student@Example.com', 'hash', now, new Date(now.getTime() + 900_000));
  assert.deepEqual(result, { status: 'rate_limited' });
  const rateCall = db.calls.find((call) => call.text.includes("status IN ('pending', 'sent')"));
  assert.ok(rateCall);
  assert.equal((rateCall.values[1] as Date).getTime(), now.getTime() - MAGIC_LINK_RATE_LIMIT_MS);
  assert.equal(db.calls.some((call) => call.text.startsWith('INSERT INTO magic_link_tokens')), false);
});

test('expired or already-used magic links are rejected by the atomic consume predicate', async () => {
  const db = new ScriptedDb(() => []);
  const repository = new PostgresAuthRepository(db);
  const now = new Date('2026-08-31T18:00:00Z');
  const user = await repository.consumeMagicLink(hashToken('expired-token'), now, hashToken('session'), new Date(now.getTime() + 1000));
  assert.equal(user, null);
  const consume = db.calls.find((call) => call.text.includes('UPDATE magic_link_tokens'));
  assert.ok(consume);
  assert.match(consume.text, /status IN \('pending', 'sent'\)/);
  assert.match(consume.text, /used_at IS NULL/);
  assert.match(consume.text, /expires_at > \$2/);
  assert.equal(db.calls.some((call) => call.text.startsWith('INSERT INTO user_sessions')), false);
});

class OwnedSearchDb implements SqlClient {
  searches = new Map<string, { userId: string; active: boolean }>([
    ['10', { userId: 'A', active: true }],
    ['20', { userId: 'B', active: true }],
  ]);
  async query<T extends Row>(text: string, values: readonly unknown[] = []): Promise<{ rows: T[] }> {
    if (text.startsWith('SELECT id, university')) {
      const userId = String(values[0]);
      const rows = [...this.searches.entries()]
        .filter(([, value]) => value.userId === userId)
        .map(([id, value]) => ({ id, university: 'frankfurt_uas', max_total_monthly_rent: 500, move_in_month: null, housing_types: ['dorm', 'wg', 'studio'], is_active: value.active }));
      return { rows: rows as unknown as T[] };
    }
    if (text.startsWith('UPDATE saved_searches')) {
      assert.match(text, /WHERE id = \$1 AND user_id = \$2/);
      const [id, userId, active] = values.map(String);
      const row = this.searches.get(id);
      if (!row || row.userId !== userId) return { rows: [] as T[] };
      row.active = active === 'true';
      return { rows: [{ id }] as unknown as T[] };
    }
    if (text.startsWith('DELETE FROM saved_searches')) {
      assert.match(text, /WHERE id = \$1 AND user_id = \$2/);
      const id = String(values[0]);
      const userId = String(values[1]);
      const row = this.searches.get(id);
      if (!row || row.userId !== userId) return { rows: [] as T[] };
      this.searches.delete(id);
      return { rows: [{ id }] as unknown as T[] };
    }
    return { rows: [] as T[] };
  }
}

test('user A can only see their own saved searches', async () => {
  const repository = new PostgresAuthRepository(new OwnedSearchDb());
  const searches = await repository.listSavedSearches('A');
  assert.deepEqual(searches.map((search) => search.id), ['10']);
});

test('user A cannot pause, resume, or delete user B saved search even with its ID', async () => {
  const db = new OwnedSearchDb();
  const repository = new PostgresAuthRepository(db);
  assert.equal(await repository.setSavedSearchActive('A', '20', false), false);
  assert.equal(db.searches.get('20')?.active, true);
  assert.equal(await repository.setSavedSearchActive('A', '20', true), false);
  assert.equal(await repository.deleteSavedSearch('A', '20'), false);
  assert.equal(db.searches.has('20'), true);
});

test('saved-search validation refuses empty housing types and malformed values', () => {
  assert.throws(() => validateSavedSearch({ university: 'frankfurt_uas', maxTotalMonthlyRent: 500, moveInMonth: null, housingTypes: [] }));
  assert.throws(() => validateSavedSearch({ university: 'goethe', maxTotalMonthlyRent: -1, moveInMonth: null, housingTypes: ['wg'] }));
});
