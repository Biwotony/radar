import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAlertEmail,
  runAlertPass,
  type AlertCandidate,
  type AlertDeliveryResult,
  type AlertEmail,
  type AlertRepository,
  type EmailSender,
  type EmailSendResult,
} from './alerts.js';

function candidate(overrides: Partial<AlertCandidate> = {}): AlertCandidate {
  return {
    userId: '1',
    email: 'student@example.com',
    savedSearchId: '10',
    university: 'frankfurt_uas',
    maxTotalMonthlyRent: 500,
    moveInMonth: '2026-10-01',
    housingTypes: ['dorm', 'wg', 'studio'],
    listingId: '100',
    lifecycleState: 'NEW',
    extractedFacts: {
      roomType: { value: 'Zimmer', status: 'CONFIRMED', evidence: 'Zimmer' },
      area: { value: '60433 Frankfurt am Main', status: 'CONFIRMED', evidence: '60433 Frankfurt am Main' },
      availableFrom: { value: '01.10.2026', status: 'CONFIRMED', evidence: '01.10.2026' },
      totalMonthlyRent: { value: 450, status: 'CONFIRMED', evidence: '450 €' },
      eligibleUniversities: { value: null, status: 'NOT_STATED' },
    },
    sourceUrl: 'https://www.wohnraum-gesucht.de/wohnraumangebote?id=100',
    ...overrides,
  };
}

class MemoryAlertRepository implements AlertRepository {
  private readonly delivered = new Set<string>();

  constructor(private readonly candidates: AlertCandidate[]) {}

  async findCandidates(): Promise<AlertCandidate[]> {
    return this.candidates;
  }

  async deliverExactlyOnce(
    _candidate: AlertCandidate,
    alertKey: string,
    _payload: Record<string, unknown>,
    send: () => Promise<EmailSendResult>,
  ): Promise<AlertDeliveryResult> {
    if (this.delivered.has(alertKey)) return 'skipped';
    try {
      await send();
      this.delivered.add(alertKey);
      return 'sent';
    } catch {
      return 'failed';
    }
  }
}

class RecordingSender implements EmailSender {
  readonly sent: Array<{ message: AlertEmail; idempotencyKey: string }> = [];

  async send(message: AlertEmail, idempotencyKey: string): Promise<EmailSendResult> {
    this.sent.push({ message, idempotencyKey });
    return { messageId: `message-${this.sent.length}` };
  }
}

test('a matching listing sends exactly one alert across repeated passes', async () => {
  const repository = new MemoryAlertRepository([candidate()]);
  const sender = new RecordingSender();

  const first = await runAlertPass(repository, sender);
  const second = await runAlertPass(repository, sender);

  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(second.skippedAlreadySent, 1);
  assert.equal(sender.sent.length, 1);
});

test('the same listing matching two users sends one alert to each user', async () => {
  const repository = new MemoryAlertRepository([
    candidate({ userId: '1', savedSearchId: '10', email: 'one@example.com' }),
    candidate({ userId: '2', savedSearchId: '20', email: 'two@example.com' }),
  ]);
  const sender = new RecordingSender();

  const stats = await runAlertPass(repository, sender);

  assert.equal(stats.sent, 2);
  assert.deepEqual(sender.sent.map((entry) => entry.message.to).sort(), [
    'one@example.com',
    'two@example.com',
  ]);
});

test('a POSSIBLY_STALE listing does not trigger an alert', async () => {
  const repository = new MemoryAlertRepository([
    candidate({ lifecycleState: 'POSSIBLY_STALE' }),
  ]);
  const sender = new RecordingSender();

  const stats = await runAlertPass(repository, sender);

  assert.equal(stats.matched, 0);
  assert.equal(stats.sent, 0);
  assert.equal(sender.sent.length, 0);
});

test('NOT_STATED facts render explicitly instead of disappearing', async () => {
  const listing = candidate({
    extractedFacts: {
      ...candidate().extractedFacts,
      area: { value: null, status: 'NOT_STATED' },
      eligibleUniversities: { value: null, status: 'NOT_STATED' },
    },
  });
  const repository = new MemoryAlertRepository([listing]);
  const sender = new RecordingSender();

  const stats = await runAlertPass(repository, sender);

  assert.equal(stats.sent, 1);
  assert.equal(sender.sent.length, 1);
  assert.match(sender.sent[0]?.message.text ?? '', /Area: not stated/);
  assert.match(sender.sent[0]?.message.text ?? '', /University eligibility: not stated/);
  assert.match(sender.sent[0]?.message.html ?? '', /View the original listing/);
});

test('unknown rent does not pass a hard budget ceiling', async () => {
  const listing = candidate({
    extractedFacts: {
      ...candidate().extractedFacts,
      totalMonthlyRent: { value: null, status: 'NOT_STATED' },
    },
  });
  const repository = new MemoryAlertRepository([listing]);
  const sender = new RecordingSender();

  const stats = await runAlertPass(repository, sender);

  assert.equal(stats.matched, 0);
  assert.equal(sender.sent.length, 0);
});

test('email contains source URL and fact confidence wording', () => {
  const email = buildAlertEmail(candidate());
  assert.match(email.text, /Room type: Zimmer \(confirmed\)/);
  assert.match(email.text, /https:\/\/www\.wohnraum-gesucht\.de/);
  assert.match(email.html, /href="https:\/\/www\.wohnraum-gesucht\.de/);
});
