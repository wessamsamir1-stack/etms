import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeChallengeS256, validateIdTokenClaims, buildAuthorizeUrl, IdTokenClaims } from './oidc';

test('codeChallengeS256 matches the RFC 7636 test vector', () => {
  // RFC 7636 Appendix B.
  assert.equal(
    codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});

const base = (over: Partial<IdTokenClaims> = {}): IdTokenClaims => ({
  iss: 'https://idp.example', aud: 'client-123', exp: 2000, nonce: 'N', email: 'a@b.com', ...over,
});
const check = { issuer: 'https://idp.example', audience: 'client-123', nowEpoch: 1000, nonce: 'N' };

test('valid claims pass', () => {
  assert.deepEqual(validateIdTokenClaims(base(), check), { ok: true });
});

test('audience may be an array containing our client_id', () => {
  assert.deepEqual(validateIdTokenClaims(base({ aud: ['other', 'client-123'] }), check), { ok: true });
});

test('rejects issuer / audience / expiry / nonce / missing-email', () => {
  assert.equal((validateIdTokenClaims(base({ iss: 'evil' }), check) as any).reason, 'issuer_mismatch');
  assert.equal((validateIdTokenClaims(base({ aud: 'someone-else' }), check) as any).reason, 'audience_mismatch');
  assert.equal((validateIdTokenClaims(base({ exp: 100 }), check) as any).reason, 'expired');
  assert.equal((validateIdTokenClaims(base({ nonce: 'different' }), check) as any).reason, 'nonce_mismatch');
  assert.equal((validateIdTokenClaims(base({ email: undefined }), check) as any).reason, 'no_email');
});

test('clock skew tolerates a just-expired token within the window', () => {
  assert.deepEqual(validateIdTokenClaims(base({ exp: 970 }), { ...check, clockSkewSeconds: 60 }), { ok: true });
  assert.equal((validateIdTokenClaims(base({ exp: 900 }), { ...check, clockSkewSeconds: 60 }) as any).reason, 'expired');
});

test('buildAuthorizeUrl carries PKCE + state + nonce', () => {
  const url = new URL(buildAuthorizeUrl('https://idp.example/authorize', {
    clientId: 'c1', redirectUri: 'https://app/cb', state: 'S', codeChallenge: 'CC', nonce: 'N',
  }));
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge'), 'CC');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'S');
  assert.equal(url.searchParams.get('nonce'), 'N');
  assert.equal(url.searchParams.get('client_id'), 'c1');
});
