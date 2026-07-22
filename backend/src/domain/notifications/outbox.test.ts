import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messageFromRow, nextBackoffSeconds, planRetry, NotificationRow } from './outbox';

const base = (payload: Record<string, unknown>, over: Partial<NotificationRow> = {}): NotificationRow => ({
  id: 'n1', tenant_id: 't1', user_id: 'u1', channel: 'push', template_code: null, payload, attempts: 0, ...over,
});

test('messageFromRow uses an explicit {to,text} payload (NotificationService path)', () => {
  const m = messageFromRow(base({ to: '+96550000000', text: 'hello', subject: 'Hi' }, { channel: 'sms' }));
  assert.deepEqual(m, { channel: 'sms', to: '+96550000000', subject: 'Hi', body: 'hello' });
});

test('messageFromRow renders a bilingual manifest push (ar+en), recipient from user_id', () => {
  const m = messageFromRow(base({ tripId: 'tr1', message: { ar: 'وصل الباص', en: 'Bus arrived' } }));
  assert.equal(m.channel, 'push');
  assert.equal(m.to, 'u1'); // no explicit `to` → falls back to the user id
  assert.equal(m.body, 'وصل الباص\nBus arrived');
});

test('messageFromRow falls back to the raw payload when nothing recognizable', () => {
  const m = messageFromRow(base({ weird: 1 }, { user_id: null }));
  assert.equal(m.to, 'unknown');
  assert.equal(m.body, JSON.stringify({ weird: 1 }));
});

test('nextBackoffSeconds is exponential and capped', () => {
  assert.equal(nextBackoffSeconds(0), 30);
  assert.equal(nextBackoffSeconds(1), 60);
  assert.equal(nextBackoffSeconds(3), 240);
  assert.equal(nextBackoffSeconds(20), 3600); // capped
});

test('planRetry: success → sent', () => {
  assert.deepEqual(planRetry(0, true), { status: 'sent', attempts: 1, retryInSeconds: null });
});

test('planRetry: failure re-queues with backoff until maxAttempts, then fails', () => {
  const r1 = planRetry(0, false, 3);
  assert.equal(r1.status, 'queued'); assert.equal(r1.attempts, 1); assert.equal(r1.retryInSeconds, 60);
  const r2 = planRetry(1, false, 3);
  assert.equal(r2.status, 'queued'); assert.equal(r2.attempts, 2);
  const dead = planRetry(2, false, 3);
  assert.deepEqual(dead, { status: 'failed', attempts: 3, retryInSeconds: null });
});
