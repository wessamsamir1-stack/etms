import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateOtp, hashOtp, verifyOtp } from './otp';

test('generateOtp returns the requested number of digits', () => {
  for (let i = 0; i < 50; i++) {
    const c = generateOtp(6);
    assert.match(c, /^\d{6}$/);
  }
  assert.match(generateOtp(4), /^\d{4}$/);
  assert.throws(() => generateOtp(2));
});

test('hashOtp is deterministic and never equals the code', () => {
  const h = hashOtp('123456', 'secret');
  assert.equal(h, hashOtp('123456', 'secret'));
  assert.notEqual(h, '123456');
  assert.notEqual(h, hashOtp('123456', 'other-secret'));
});

test('verifyOtp accepts the right code and rejects wrong / tampered', () => {
  const h = hashOtp('987654', 'sekret');
  assert.equal(verifyOtp('987654', h, 'sekret'), true);
  assert.equal(verifyOtp('000000', h, 'sekret'), false);
  assert.equal(verifyOtp('987654', h, 'wrong-secret'), false);
  assert.equal(verifyOtp('987654', '', 'sekret'), false);
  assert.equal(verifyOtp('987654', 'zz', 'sekret'), false);
});
