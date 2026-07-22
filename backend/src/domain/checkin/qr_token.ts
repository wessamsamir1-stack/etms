import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * QR Check-in / Check-out tokens.
 *
 * A trip produces short-lived signed tokens that a rider presents (QR) and the
 * driver app scans, or vice-versa. The token is self-contained and tamper-proof
 * (HMAC-SHA256) so verification needs no server round-trip beyond the shared
 * secret. `now` is injected for deterministic testing.
 */
export interface CheckPayload {
  /** trip id */ t: string;
  /** employee id */ e: string;
  /** direction of the action */ k: 'in' | 'out';
  /** expiry, epoch seconds */ x: number;
}

export function signCheckToken(payload: CheckPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(hmac(body, secret));
  return `${body}.${sig}`;
}

export type VerifyResult =
  | { valid: true; payload: CheckPayload }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyCheckToken(
  token: string,
  secret: string,
  nowEpoch: number,
): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'malformed' };
  const [body, sig] = parts as [string, string];

  const expected = b64url(hmac(body, secret));
  if (!safeEqual(sig, expected)) return { valid: false, reason: 'bad_signature' };

  let payload: CheckPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8')) as CheckPayload;
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (typeof payload.x !== 'number' || payload.x < nowEpoch) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, payload };
}

function hmac(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}
function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}
function fromB64url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
