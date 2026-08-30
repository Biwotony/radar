import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySighting,
  stateAfterMisses,
  type ListingState,
  type SourcePolicy,
} from './persistence.js';
import type { Observation } from './sources/types.js';

const policy: SourcePolicy = {
  crawlIntervalMinutes: 30,
  missingBeforeStale: 2,
  missingBeforeInactive: 6,
  explicit404MeansRemoved: true,
};

const facts: Observation['extractedFacts'] = {
  roomType: {
    value: '1-Zimmerwohnung',
    status: 'CONFIRMED',
    evidence: '1-Zimmerwohnung',
  },
  area: {
    value: '60323 Frankfurt am Main',
    status: 'CONFIRMED',
    evidence: '60323 Frankfurt am Main',
  },
  availableFrom: {
    value: '01.10.2026',
    status: 'CONFIRMED',
    evidence: '01.10.2026',
  },
};

function existingState(overrides: Partial<ListingState> = {}): ListingState {
  const firstSeen = new Date('2026-08-30T10:00:00.000Z');

  return {
    lifecycleState: 'NEW',
    extractedFacts: facts,
    firstSeenAt: firstSeen,
    lastSeenAt: firstSeen,
    lastChangedAt: firstSeen,
    lastConfirmedActiveAt: firstSeen,
    ...overrides,
  };
}

test('first sighting creates a NEW listing with all freshness timestamps set', () => {
  const seenAt = new Date('2026-08-30T11:00:00.000Z');
  const result = applySighting(null, facts, seenAt);

  assert.equal(result.lifecycleState, 'NEW');
  assert.equal(result.factsChanged, true);
  assert.equal(result.firstSeenAt, seenAt);
  assert.equal(result.lastSeenAt, seenAt);
  assert.equal(result.lastChangedAt, seenAt);
  assert.equal(result.lastConfirmedActiveAt, seenAt);
});

test('repeat sighting without changes becomes ACTIVE and bumps only seen/confirmed timestamps', () => {
  const seenAt = new Date('2026-08-30T11:30:00.000Z');
  const current = existingState();
  const result = applySighting(current, facts, seenAt);

  assert.equal(result.lifecycleState, 'ACTIVE');
  assert.equal(result.factsChanged, false);
  assert.equal(result.firstSeenAt, current.firstSeenAt);
  assert.equal(result.lastSeenAt, seenAt);
  assert.equal(result.lastChangedAt, current.lastChangedAt);
  assert.equal(result.lastConfirmedActiveAt, seenAt);
});

test('repeat sighting with changed facts bumps last_changed_at', () => {
  const seenAt = new Date('2026-08-30T12:00:00.000Z');
  const changedFacts: Observation['extractedFacts'] = {
    ...facts,
    availableFrom: {
      value: '15.10.2026',
      status: 'CONFIRMED',
      evidence: '15.10.2026',
    },
  };

  const current = existingState({ lifecycleState: 'ACTIVE' });
  const result = applySighting(current, changedFacts, seenAt);

  assert.equal(result.lifecycleState, 'ACTIVE');
  assert.equal(result.factsChanged, true);
  assert.equal(result.lastSeenAt, seenAt);
  assert.equal(result.lastChangedAt, seenAt);
  assert.deepEqual(result.extractedFacts, changedFacts);
});

test('miss thresholds move ACTIVE to POSSIBLY_STALE and then INACTIVE', () => {
  assert.equal(stateAfterMisses('ACTIVE', 1, policy), 'ACTIVE');
  assert.equal(stateAfterMisses('ACTIVE', 2, policy), 'POSSIBLY_STALE');
  assert.equal(stateAfterMisses('POSSIBLY_STALE', 5, policy), 'POSSIBLY_STALE');
  assert.equal(stateAfterMisses('POSSIBLY_STALE', 6, policy), 'INACTIVE');
});

test('a re-sighting revives a stale listing to ACTIVE', () => {
  const seenAt = new Date('2026-08-30T13:00:00.000Z');
  const current = existingState({ lifecycleState: 'POSSIBLY_STALE' });
  const result = applySighting(current, facts, seenAt);

  assert.equal(result.lifecycleState, 'ACTIVE');
  assert.equal(result.lastSeenAt, seenAt);
  assert.equal(result.lastConfirmedActiveAt, seenAt);
});
