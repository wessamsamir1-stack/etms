import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { FieldCrypto } from './field_crypto';

const key = (n: number): string => Buffer.alloc(32, n).toString('base64');
const fc = FieldCrypto.fromEnv(`k1:${key(1)}`);

test('round-trips a value and the stored form is opaque ciphertext', () => {
  const plain = 'Block 5, Street 12, Salmiya, Kuwait';
  const enc = fc.encrypt(plain)!;
  assert.ok(enc.startsWith('f1:k1:'), 'has version + key id');
  assert.ok(!enc.includes('Salmiya'), 'plaintext not present in ciphertext');
  assert.equal(fc.decrypt(enc), plain);
});

test('two encryptions of the same value differ (random IV) but both decrypt', () => {
  const a = fc.encrypt('same')!;
  const b = fc.encrypt('same')!;
  assert.notEqual(a, b);
  assert.equal(fc.decrypt(a), 'same');
  assert.equal(fc.decrypt(b), 'same');
});

test('tampering is detected (GCM auth tag) → decrypt throws', () => {
  const enc = fc.encrypt('secret')!;
  const parts = enc.split(':');
  const ct = Buffer.from(parts[4]!, 'base64url');
  ct[0]! ^= 0xff; // flip a ciphertext byte
  parts[4] = ct.toString('base64url');
  assert.throws(() => fc.decrypt(parts.join(':')));
});

test('a different key cannot decrypt', () => {
  const enc = fc.encrypt('secret')!;
  const other = FieldCrypto.fromEnv(`k1:${key(9)}`); // same id, different bytes
  assert.throws(() => other.decrypt(enc));
});

test('legacy plaintext (no prefix) passes through unchanged', () => {
  assert.equal(fc.decrypt('old address stored before encryption'), 'old address stored before encryption');
  assert.equal(fc.decrypt(null), null);
  assert.equal(fc.encrypt(null), null);
});

test('key rotation: new key active, old key still decrypts old ciphertext', () => {
  const oldFc = FieldCrypto.fromEnv(`k1:${key(1)}`);
  const oldCt = oldFc.encrypt('written under k1')!;
  // Rotate: k2 active, k1 retained for decrypt.
  const rotated = FieldCrypto.fromEnv(`k2:${key(2)},k1:${key(1)}`);
  assert.equal(rotated.decrypt(oldCt), 'written under k1'); // old still readable
  const newCt = rotated.encrypt('written under k2')!;
  assert.ok(newCt.startsWith('f1:k2:')); // new writes use the active key
  assert.equal(rotated.decrypt(newCt), 'written under k2');
});

test('disabled (no key) is a passthrough', () => {
  const off = FieldCrypto.fromEnv('');
  assert.equal(off.enabled, false);
  assert.equal(off.encrypt('x'), 'x');
  assert.equal(off.decrypt('x'), 'x');
});

test('rejects a non-32-byte key', () => {
  assert.throws(() => new FieldCrypto([{ id: 'bad', key: randomBytes(16) }]));
});
