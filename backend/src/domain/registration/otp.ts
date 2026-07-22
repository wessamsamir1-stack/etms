import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * One-time passcode for self-registration. The plaintext code is only ever sent
 * to the person (SMS/email) — we store an HMAC of it, never the code itself, and
 * compare in constant time. Pure + deterministic given a secret (mirrors the
 * `registration_request.otp_hash` column in db/V0019).
 */
export function generateOtp(digits = 6): string {
  if (digits < 4 || digits > 10) throw new Error('otp digits out of range');
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, '0');
}

export function hashOtp(code: string, secret: string): string {
  return createHmac('sha256', secret).update(code).digest('hex');
}

export function verifyOtp(code: string, hash: string, secret: string): boolean {
  const a = Buffer.from(hashOtp(code, secret), 'hex');
  const b = Buffer.from(hash ?? '', 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const OTP_TTL_SECONDS = 300; // 5 minutes
export const OTP_MAX_ATTEMPTS = 5;
