import { createHash, randomBytes } from 'node:crypto';

/** PKCE code_challenge for a verifier, using the S256 method (RFC 7636). Pure. */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** A high-entropy URL-safe token for `state` / `code_verifier` / `nonce`. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export interface IdTokenClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  sub?: string;
  [k: string]: unknown;
}

export interface ClaimCheck {
  issuer: string;
  audience: string; // our client_id
  nowEpoch: number;
  nonce: string;
  clockSkewSeconds?: number;
}

export type ClaimResult = { ok: true } | { ok: false; reason: string };

/**
 * Validate an OIDC id_token's claims (RFC 8252 §3.1.3.7 / OIDC Core §3.1.3.7):
 * issuer match, audience contains our client_id, not expired / not-before, and
 * the nonce binds the token to this login. Signature is checked separately
 * (verifyRs256 against the JWKS). Pure — unit-tested.
 */
export function validateIdTokenClaims(claims: IdTokenClaims, c: ClaimCheck): ClaimResult {
  const skew = c.clockSkewSeconds ?? 60;
  if (claims.iss !== c.issuer) return { ok: false, reason: 'issuer_mismatch' };
  const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!aud.includes(c.audience)) return { ok: false, reason: 'audience_mismatch' };
  if (typeof claims.exp !== 'number' || claims.exp + skew < c.nowEpoch) return { ok: false, reason: 'expired' };
  if (typeof claims.nbf === 'number' && claims.nbf - skew > c.nowEpoch) return { ok: false, reason: 'not_yet_valid' };
  if (!claims.nonce || claims.nonce !== c.nonce) return { ok: false, reason: 'nonce_mismatch' };
  if (!claims.email) return { ok: false, reason: 'no_email' };
  return { ok: true };
}

/** Build an IdP authorize URL for the Authorization-Code + PKCE flow. */
export function buildAuthorizeUrl(base: string, params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  nonce: string;
  scope?: string;
}): string {
  const u = new URL(base);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', params.clientId);
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('scope', params.scope ?? 'openid email profile');
  u.searchParams.set('state', params.state);
  u.searchParams.set('nonce', params.nonce);
  u.searchParams.set('code_challenge', params.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}
