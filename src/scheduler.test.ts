import assert from 'node:assert/strict';
import test from 'node:test';

import type { PersistenceStats, SqlClient } from './persistence.js';
import { loadSourcePolicy, runSourceOnce, type SchedulerLog } from './scheduler.js';
import type { HousingSource, Observation, RawItem } from './sources/types.js';

const rawItem: RawItem = {
  externalId: '83193',
  sourceUrl: 'https://example.test/83193',
  roomType: 'Zimmer',
  area: '60433 Frankfurt am Main',
  availableFromRaw: '01.10.2026',
};

const observation: Observation = {
  externalId: rawItem.externalId,
  sourceUrl: rawItem.sourceUrl,
  extractedFacts: {
    roomType: { value: 'Zimmer', status: 'CONFIRMED', evidence: 'Zimmer' },
    area: {
      value: '60433 Frankfurt am Main',
      status: 'CONFIRMED',
      evidence: '60433 Frankfurt am Main',
    },
    availableFrom: {
      value: '01.10.2026',
      status: 'CONFIRMED',
      evidence: '01.10.2026',
    },
  },
};

test('runSourceOnce fetches, parses, persists and logs stats exactly once', async () => {
  let fetchCalls = 0;
  let parseCalls = 0;
  let persistCalls = 0;
  const logs: SchedulerLog[] = [];

  const source: HousingSource = {
    async fetch() {
      fetchCalls += 1;
      return [rawItem];
    },
    async parse(item) {
      parseCalls += 1;
      assert.equal(item.externalId, rawItem.externalId);
      return observation;
    },
  };

  const client: SqlClient = {
    async query<T extends Record<string, unknown>>() {
      return { rows: [] as T[] };
    },
  };

  const expected: PersistenceStats = {
    itemsSeen: 1,
    listingsCreated: 1,
    listingsUpdated: 0,
    listingsChanged: 0,
    lifecycleTransitions: [],
  };

  const observedAt = new Date('2026-08-30T19:00:00.000Z');
  const result = await runSourceOnce(
    'wohnraum-gesucht.de',
    source,
    client,
    async (_client, sourceName, observations, at) => {
      persistCalls += 1;
      assert.equal(sourceName, 'wohnraum-gesucht.de');
      assert.deepEqual(observations, [observation]);
      assert.equal(at.toISOString(), observedAt.toISOString());
      return expected;
    },
    (entry) => logs.push(entry),
    observedAt,
  );

  assert.deepEqual(result, expected);
  assert.equal(fetchCalls, 1);
  assert.equal(parseCalls, 1);
  assert.equal(persistCalls, 1);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.source, 'wohnraum-gesucht.de');
  assert.equal(logs[0]?.itemsSeen, 1);
  assert.equal(logs[0]?.listingsCreated, 1);
  assert.equal(logs[0]?.observedAt, observedAt.toISOString());
});

test('loadSourcePolicy returns the active source crawl interval', async () => {
  const client: SqlClient = {
    async query<T extends Record<string, unknown>>() {
      const rows = [
        {
          policy: {
            crawlIntervalMinutes: 30,
            missingBeforeStale: 2,
            missingBeforeInactive: 6,
            explicit404MeansRemoved: false,
          },
        },
      ];
      return { rows: rows as unknown as T[] };
    },
  };

  const policy = await loadSourcePolicy(client, 'wohnraum-gesucht.de');
  assert.equal(policy.crawlIntervalMinutes, 30);
  assert.equal(policy.missingBeforeStale, 2);
  assert.equal(policy.missingBeforeInactive, 6);
});
