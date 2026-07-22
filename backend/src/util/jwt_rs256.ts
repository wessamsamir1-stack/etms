import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

/** A JSON Web Key (RSA public key) as served by an OIDC JWKS endpoint. */
export interface Jwk {
  kty: string;
  n?: string;
  e?: string;
  kid?: string;
  alg?: string;
  use?: string;
}
export interface Jwks {
  keys: Jwk[];
}

interface DecodedJwt {
  header: { alg?: string; kid?: string; typ?: string };
  claims: Record<string, unknown>;
}

/** Decode a JWT's header + payload (no verification). Throws on malformed. */
export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed jwt');
  const [h, p] = parts as [string, string, string];
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')),
    claims: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')),
  };
}

/**
 * Verify an RS256 (RSASSA-PKCS1-v1_5 + SHA-256) JWT signature against a JWKS.
 * Picks the key by the token header's `kid` (falling back to the sole RSA key).
 * Returns false rather than throwing on any structural/verification problem.
 */
export function verifyRs256(token: string, jwks: Jwks): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [h, p, s] = parts as [string, string, string];
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256') return false;
    const rsaKeys = jwks.keys.filter((k) => k.kty === 'RSA');
    const jwk = (header.kid && rsaKeys.find((k) => k.kid === header.kid)) || rsaKeys[0];
    if (!jwk) return false;
    const key = createPublicKey({ key: jwk as unknown as import('crypto').JsonWebKey, format: 'jwk' });
    return cryptoVerify('sha256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
  } catch {
    return false;
  }
}
