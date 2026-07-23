import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, authenticate, getPrincipal, requirePermission } from './middleware/context';
import { issueSession } from './auth_tokens';
import { parse } from './validate';
import {
  buildAuthorizeUrl, codeChallengeS256, randomToken, validateIdTokenClaims,
} from '../domain/sso/oidc';
import { decodeJwt, verifyRs256, Jwks } from '../util/jwt_rs256';
import type { Db } from './db/pool';
import type { Deps } from './routes';

interface SsoConfigRow {
  tenant_id: string;
  issuer: string;
  client_id: string;
  client_secret: string | null;
  authorize_url: string;
  token_url: string;
  jwks_url: string;
  redirect_uri: string;
}
interface AuthUserRow {
  user_id: string;
  tenant_id: string;
  status: string;
  full_name: string;
}

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Per-tenant SSO via OpenID Connect (Authorization Code + PKCE). The company
 * configures its IdP once (/v1/sso/config); users then sign in at
 * /v1/auth/sso/:slug/authorize, which round-trips through the IdP and lands on
 * /callback. There we verify the id_token against the IdP's JWKS, match the
 * email to an existing user in that tenant, and mint our normal session — so an
 * SSO user gets exactly the same permission-scoped tokens as a password user.
 */
export async function registerSsoRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  const auth = authenticate(config.jwtSecret);
  const requireDb = (): Db => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    return db;
  };
  const cfgBySlug = async (slug: string): Promise<SsoConfigRow | undefined> =>
    (await requireDb().query<SsoConfigRow>('SELECT * FROM sso_config($1)', [slug]))[0];

  // ---- Admin: manage the tenant's OIDC config (tenant.manage) --------------
  app.get('/v1/sso/config', { preHandler: [auth, requirePermission('tenant.manage')] }, async (req) => {
    const p = getPrincipal(req);
    const row = (
      await requireDb().withTenant(p.tenantId, p.userId, (c) =>
        c.query(`SELECT provider, issuer, client_id, authorize_url, token_url, jwks_url, redirect_uri, enabled
                 FROM tenant_sso WHERE tenant_id=$1`, [p.tenantId]),
      )
    ).rows[0];
    // client_secret is never returned.
    return { data: row ?? null };
  });

  app.put('/v1/sso/config', { preHandler: [auth, requirePermission('tenant.manage')] }, async (req) => {
    const b = parse(
      z.object({
        issuer: z.string().url(),
        clientId: z.string().min(1),
        clientSecret: z.string().optional(),
        authorizeUrl: z.string().url(),
        tokenUrl: z.string().url(),
        jwksUrl: z.string().url(),
        redirectUri: z.string().url(),
        enabled: z.boolean().default(true),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    const row = (
      await requireDb().withTenant(p.tenantId, p.userId, (c) =>
        c.query(
          `INSERT INTO tenant_sso(tenant_id, issuer, client_id, client_secret, authorize_url, token_url, jwks_url, redirect_uri, enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id) DO UPDATE SET
             issuer=EXCLUDED.issuer, client_id=EXCLUDED.client_id,
             client_secret=COALESCE(EXCLUDED.client_secret, tenant_sso.client_secret),
             authorize_url=EXCLUDED.authorize_url, token_url=EXCLUDED.token_url,
             jwks_url=EXCLUDED.jwks_url, redirect_uri=EXCLUDED.redirect_uri, enabled=EXCLUDED.enabled
           RETURNING provider, issuer, client_id, authorize_url, token_url, jwks_url, redirect_uri, enabled`,
          [p.tenantId, b.issuer, b.clientId, b.clientSecret ?? null, b.authorizeUrl, b.tokenUrl, b.jwksUrl, b.redirectUri, b.enabled],
        ),
      )
    ).rows[0];
    return { data: row };
  });

  // ---- Start the flow: redirect to the IdP ---------------------------------
  app.get('/v1/auth/sso/:slug/authorize', async (req, reply) => {
    const { slug } = parse(z.object({ slug: z.string().min(1) }), req.params);
    const q = parse(z.object({ redirect_to: z.string().optional() }), req.query);
    const cfg = await cfgBySlug(slug);
    if (!cfg) throw new ApiError(404, 'NOT_FOUND', 'SSO is not configured for this company');

    const state = randomToken();
    const verifier = randomToken();
    const nonce = randomToken();
    // Opportunistically prune abandoned flows (user never returned from the IdP)
    // so the transient-state table can't grow unbounded.
    await requireDb().query('DELETE FROM sso_auth_state WHERE expires_at < now()');
    await requireDb().query(
      `INSERT INTO sso_auth_state(state, tenant_id, code_verifier, nonce, redirect_to, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [state, cfg.tenant_id, verifier, nonce, q.redirect_to ?? null, new Date(Date.now() + STATE_TTL_MS)],
    );
    const url = buildAuthorizeUrl(cfg.authorize_url, {
      clientId: cfg.client_id, redirectUri: cfg.redirect_uri, state,
      codeChallenge: codeChallengeS256(verifier), nonce,
    });
    return reply.redirect(url, 302);
  });

  // ---- Finish the flow: verify id_token → mint our session -----------------
  app.get('/v1/auth/sso/:slug/callback', async (req, reply) => {
    const { slug } = parse(z.object({ slug: z.string().min(1) }), req.params);
    const q = parse(
      z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }),
      req.query,
    );
    if (q.error) throw new ApiError(401, 'UNAUTHENTICATED', `IdP returned: ${q.error}`);
    if (!q.code || !q.state) throw new ApiError(400, 'VALIDATION_ERROR', 'Missing code/state');

    // Consume the one-time state (also proves it was us who started the flow).
    const st = (
      await requireDb().query<{ tenant_id: string; code_verifier: string; nonce: string; redirect_to: string | null }>(
        `DELETE FROM sso_auth_state WHERE state=$1 AND expires_at > now() RETURNING tenant_id, code_verifier, nonce, redirect_to`,
        [q.state],
      )
    )[0];
    if (!st) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid or expired state');

    const cfg = await cfgBySlug(slug);
    if (!cfg || cfg.tenant_id !== st.tenant_id) throw new ApiError(400, 'VALIDATION_ERROR', 'SSO config mismatch');

    // Exchange the code for tokens (PKCE: send the verifier). Client auth uses
    // client_secret_post (secret in the body), which Entra/Okta/Google accept;
    // an IdP that requires client_secret_basic (HTTP Basic) is not yet supported.
    const form = new URLSearchParams({
      grant_type: 'authorization_code', code: q.code, redirect_uri: cfg.redirect_uri,
      client_id: cfg.client_id, code_verifier: st.code_verifier,
    });
    if (cfg.client_secret) form.set('client_secret', cfg.client_secret);
    let tokenRes: { id_token?: string };
    try {
      const r = await fetch(cfg.token_url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: form.toString(),
      });
      if (!r.ok) throw new Error(`token endpoint ${r.status}`);
      tokenRes = (await r.json()) as { id_token?: string };
    } catch (e) {
      throw new ApiError(502, 'INTERNAL', `Token exchange failed: ${(e as Error).message}`);
    }
    if (!tokenRes.id_token) throw new ApiError(401, 'UNAUTHENTICATED', 'No id_token from IdP');

    // Verify the id_token: signature (JWKS) + claims (issuer/aud/exp/nonce).
    let jwks: Jwks;
    try {
      const r = await fetch(cfg.jwks_url, { headers: { accept: 'application/json' } });
      jwks = (await r.json()) as Jwks;
    } catch (e) {
      throw new ApiError(502, 'INTERNAL', `JWKS fetch failed: ${(e as Error).message}`);
    }
    if (!verifyRs256(tokenRes.id_token, jwks)) throw new ApiError(401, 'UNAUTHENTICATED', 'id_token signature invalid');
    const { claims } = decodeJwt(tokenRes.id_token);
    const check = validateIdTokenClaims(claims, {
      issuer: cfg.issuer, audience: cfg.client_id, nowEpoch: Math.floor(Date.now() / 1000), nonce: st.nonce,
    });
    if (!check.ok) throw new ApiError(401, 'UNAUTHENTICATED', `id_token invalid: ${check.reason}`);

    // Match the federated email to an existing user in this tenant.
    const email = String(claims.email);
    const user = (await requireDb().query<AuthUserRow>('SELECT * FROM auth_lookup($1,$2)', [email, slug]))[0];
    if (!user) throw new ApiError(403, 'FORBIDDEN', `No account for ${email} in this company`);
    if (user.status !== 'active') throw new ApiError(403, 'FORBIDDEN', 'Account is not active');

    const session = await issueSession(requireDb(), config, user.user_id, user.tenant_id);
    const body = {
      access_token: session.access_token, refresh_token: session.refresh_token,
      token_type: 'Bearer', expires_in: session.expires_in,
      user: { id: user.user_id, tenantId: user.tenant_id, fullName: user.full_name, email },
    };
    // Browser flow: bounce back to the app with tokens in the fragment. API/test
    // flow (no redirect_to): return the tokens as JSON.
    if (st.redirect_to) {
      const u = new URL(st.redirect_to);
      u.hash = `access_token=${session.access_token}&refresh_token=${session.refresh_token}`;
      return reply.redirect(u.toString(), 302);
    }
    return body;
  });
}
