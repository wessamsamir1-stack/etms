import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, validatePasswordStrength, verifyPassword } from './password';

test('verifies a correct password', () => {
  const stored = hashPassword('S3cret!');
  assert.equal(verifyPassword('S3cret!', stored), true);
});

test('rejects a wrong password', () => {
  const stored = hashPassword('S3cret!');
  assert.equal(verifyPassword('wrong', stored), false);
});

test('produces a distinct hash each time (random salt)', () => {
  assert.notEqual(hashPassword('same'), hashPassword('same'));
});

test('rejects a malformed stored hash', () => {
  assert.equal(verifyPassword('x', 'not-a-hash'), false);
});

test('password strength policy', () => {
  assert.equal(validatePasswordStrength('Str0ngPass!').ok, true);
  assert.deepEqual(validatePasswordStrength('short1A').issues, ['too_short']);
  assert.ok(validatePasswordStrength('alllowercase1').issues.includes('need_uppercase'));
  assert.ok(validatePasswordStrength('NoDigitsHere').issues.includes('need_digit'));
  assert.ok(validatePasswordStrength('password123').issues.includes('too_common'));
});
