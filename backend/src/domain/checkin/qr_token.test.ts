import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signCheckToken, verifyCheckToken, CheckPayload } from './qr_token';

const secret = 'test-secret';
const payload: CheckPayload = { t: 'trip1', e: 'emp1', k: 'in', x: 2000 };

test('round-trips a valid token', () => {
  const token = signCheckToken(payload, secret);
  const res = verifyCheckToken(token, secret, 1000);
  assert.equal(res.valid, true);
  if (res.valid) assert.deepEqual(res.payload, payload);
});

test('rejects a tampered payload', () => {
  const token = signCheckToken(payload, secret);
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...payload, e: 'attacker' })).toString('base64url');
  const res = verifyCheckToken(`${forged}.${sig}`, secret, 1000);
  assert.equal(res.valid, false);
  if (!res.valid) assert.equal(res.reason, 'bad_signature');
});

test('rejects a wrong secret', () => {
  const token = signCheckToken(payload, secret);
  const res = verifyCheckToken(token, 'other-secret', 1000);
  assert.equal(res.valid, false);
});

test('rejects an expired token', () => {
  const token = signCheckToken(payload, secret);
  const res = verifyCheckToken(token, secret, 9999);
  assert.equal(res.valid, false);
  if (!res.valid) assert.equal(res.reason, 'expired');
});

test('rejects a malformed token', () => {
  const res = verifyCheckToken('not-a-token', secret, 1000);
  assert.equal(res.valid, false);
  if (!res.valid) assert.equal(res.reason, 'malformed');
});
