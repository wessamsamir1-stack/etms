import { createHmac, timingSafeEqual } from 'node:crypto';

/** Minimal HS256 JWT sign/verify (no external dependency). */
export interface JwtClaims {
  sub: string; // user id
  tenant_id: string;
  permissions?: string[];
  scope_site_ids?: string[] | null;
  /** Cross-tenant platform (Super-Admin) token — set on platform-API tokens only. */
  platform?: boolean;
  exp?: number; // epoch seconds
  [k: string]: unknown;
}

export function signJwt(claims: JwtClaims, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const data = `${header}.${payload}`;
  const sig = b64url(createHmac('sha256', secret).update(data).digest());
  return `${data}.${sig}`;
}

export type JwtResult =
  | { valid: true; claims: JwtClaims }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyJwt(token: string, secret: string, nowEpoch: number): JwtResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };
  const [header, payload, sig] = parts as [string, string, string];
  const expected = b64url(
    createHmac('sha256', secret).update(`${header}.${payload}`).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: 'bad_signature' };
  }
  let claims: JwtClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as JwtClaims;
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (typeof claims.exp === 'number' && claims.exp < nowEpoch) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, claims };
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}
