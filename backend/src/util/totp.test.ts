import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSecret, generateTotp, verifyTotp } from './totp';

// RFC 6238 test vector: ASCII secret "12345678901234567890" == Base32 below.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('matches the RFC 6238 6-digit vector at T=59', () => {
  // 8-digit vector is 94287082 → last 6 digits = 287082.
  assert.equal(generateTotp(RFC_SECRET, 59), '287082');
});

test('verify accepts the current code and rejects a wrong one', () => {
  const now = 1_700_000_000;
  const code = generateTotp(RFC_SECRET, now);
  assert.equal(verifyTotp(code, RFC_SECRET, now), true);
  assert.equal(verifyTotp('000000', RFC_SECRET, now), false);
});

test('verify tolerates ±1 step of clock skew', () => {
  const now = 1_700_000_000;
  const prev = generateTotp(RFC_SECRET, now - 30);
  assert.equal(verifyTotp(prev, RFC_SECRET, now), true); // within window
  const old = generateTotp(RFC_SECRET, now - 120);
  assert.equal(verifyTotp(old, RFC_SECRET, now), false); // outside window
});

test('generated secrets are valid Base32 and round-trip through verify', () => {
  const secret = generateSecret();
  assert.match(secret, /^[A-Z2-7]+$/);
  const now = 1_700_000_000;
  assert.equal(verifyTotp(generateTotp(secret, now), secret, now), true);
});
