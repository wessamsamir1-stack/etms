import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt (Node built-in — no native Argon2 dependency in
 * this reference build; swap for argon2id in production behind this interface).
 * Format: `scrypt$N$<saltHex>$<hashHex>`.
 */
const N = 16384; // CPU/memory cost
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N });
  return `scrypt$${N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** A small blocklist of the most-guessed passwords (extend from a real list in prod). */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '12345678', '123456789',
  'qwerty', 'qwerty123', '111111', '000000', 'iloveyou', 'admin', 'welcome',
  'letmein', 'monkey', 'abc123', 'passw0rd',
]);

export interface PasswordStrength {
  ok: boolean;
  issues: string[];
}

/**
 * Enforces a minimum password policy to resist guessing (docs/etms/09 §Security).
 * Rules: ≥ 10 chars, upper + lower + digit, and not an obvious common password.
 */
export function validatePasswordStrength(pw: string): PasswordStrength {
  const issues: string[] = [];
  if (pw.length < 10) issues.push('too_short');
  if (!/[a-z]/.test(pw)) issues.push('need_lowercase');
  if (!/[A-Z]/.test(pw)) issues.push('need_uppercase');
  if (!/[0-9]/.test(pw)) issues.push('need_digit');
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) issues.push('too_common');
  return { ok: issues.length === 0, issues };
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const cost = Number(parts[1]);
  const salt = Buffer.from(parts[2]!, 'hex');
  const expected = Buffer.from(parts[3]!, 'hex');
  const actual = scryptSync(password, salt, expected.length, { N: cost });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
