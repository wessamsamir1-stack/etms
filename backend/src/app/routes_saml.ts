import { FastifyInstance } from 'fastify';
import { SAML, type SamlConfig } from '@node-saml/node-saml';
import { z } from 'zod';
import { ApiError, authenticate, getPrincipal, requirePermission } from './middleware/context';
import { issueSession } from './auth_tokens';
import { parse } from './validate';
import type { Db } from './db/pool';
import type { Deps } from './routes';

interface SamlConfigRow {
  tenant_id: string;
  sp_entity_id: string;
  idp_entry_point: string;
  idp_cert: string;
  callback_url: string;
  idp_issuer: string | null;
}
interface AuthUserRow {
  user_id: string;
  tenant_id: string;
  status: string;
  full_name: string;
}

/**
 * Per-tenant SSO via SAML 2.0 (SP-initiated, HTTP-POST binding), complementing
 * OIDC (routes_sso). We are the Service Provider: /login builds an AuthnRequest
 * and redirects to the IdP; /acs receives the IdP's SAMLResponse and validates
 * it — the security-critical XML-DSig signature check + condition validation are
 * performed by @node-saml/node-saml, not hand-rolled. On success the assertion's
 * email is matched to an existing user and our normal session is minted.
 */
export async function registerSamlRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  const auth = authenticate(config.jwtSecret);
  const requireDb = (): Db => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    return db;
  };

  // The IdP posts the SAMLResponse as application/x-www-form-urlencoded.
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    });
  }

  const cfgBySlug = async (slug: string): Promise<SamlConfigRow | undefined> =>
    (await requireDb().query<SamlConfigRow>('SELECT * FROM saml_config($1)', [slug]))[0];

  const buildSaml = (cfg: SamlConfigRow): SAML => {
    const opts: SamlConfig = {
      issuer: cfg.sp_entity_id,
      callbackUrl: cfg.callback_url,
      entryPoint: cfg.idp_entry_point,
      idpCert: cfg.idp_cert,
      audience: cfg.sp_entity_id,
      wantAssertionsSigned: true,      // the assertion must be signed by the IdP
      wantAuthnResponseSigned: false,  // response-level signature not required
      disableRequestedAuthnContext: true,
      acceptedClockSkewMs: 5000,
      ...(cfg.idp_issuer ? { idpIssuer: cfg.idp_issuer } : {}),
    };
    return new SAML(opts);
  };

  // ---- Admin: manage the tenant's SAML config (tenant.manage) --------------
  app.get('/v1/saml/config', { preHandler: [auth, requirePermission('tenant.manage')] }, async (req) => {
    const p = getPrincipal(req);
    const row = (
      await requireDb().withTenant(p.tenantId, p.userId, (c) =>
        c.query(`SELECT sp_entity_id, idp_entry_point, callback_url, idp_issuer, enabled
                 FROM tenant_saml WHERE tenant_id=$1`, [p.tenantId]),
      )
    ).rows[0];
    return { data: row ?? null }; // idp_cert is not echoed back
  });

  app.put('/v1/saml/config', { preHandler: [auth, requirePermission('tenant.manage')] }, async (req) => {
    const b = parse(
      z.object({
        spEntityId: z.string().min(1),
        idpEntryPoint: z.string().url(),
        idpCert: z.string().min(1),
        callbackUrl: z.string().url(),
        idpIssuer: z.string().optional(),
        enabled: z.boolean().default(true),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    const row = (
      await requireDb().withTenant(p.tenantId, p.userId, (c) =>
        c.query(
          `INSERT INTO tenant_saml(tenant_id, sp_entity_id, idp_entry_point, idp_cert, callback_url, idp_issuer, enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (tenant_id) DO UPDATE SET
             sp_entity_id=EXCLUDED.sp_entity_id, idp_entry_point=EXCLUDED.idp_entry_point,
             idp_cert=EXCLUDED.idp_cert, callback_url=EXCLUDED.callback_url,
             idp_issuer=EXCLUDED.idp_issuer, enabled=EXCLUDED.enabled
           RETURNING sp_entity_id, idp_entry_point, callback_url, idp_issuer, enabled`,
          [p.tenantId, b.spEntityId, b.idpEntryPoint, b.idpCert, b.callbackUrl, b.idpIssuer ?? null, b.enabled],
        ),
      )
    ).rows[0];
    return { data: row };
  });

  // ---- Start: redirect to the IdP with an AuthnRequest ---------------------
  app.get('/v1/auth/saml/:slug/login', async (req, reply) => {
    const { slug } = parse(z.object({ slug: z.string().min(1) }), req.params);
    const q = parse(z.object({ redirect_to: z.string().optional() }), req.query);
    const cfg = await cfgBySlug(slug);
    if (!cfg) throw new ApiError(404, 'NOT_FOUND', 'SAML is not configured for this company');
    const url = await buildSaml(cfg).getAuthorizeUrlAsync(q.redirect_to ?? '', req.headers.host, {});
    return reply.redirect(302, url);
  });

  // ---- Finish: consume the IdP's signed SAMLResponse -----------------------
  app.post('/v1/auth/saml/:slug/acs', async (req, reply) => {
    const { slug } = parse(z.object({ slug: z.string().min(1) }), req.params);
    const cfg = await cfgBySlug(slug);
    if (!cfg) throw new ApiError(404, 'NOT_FOUND', 'SAML is not configured for this company');

    const body = parse(
      z.object({ SAMLResponse: z.string().min(1), RelayState: z.string().optional() }),
      req.body,
    );
    let email: string;
    try {
      const { profile } = await buildSaml(cfg).validatePostResponseAsync(body);
      if (!profile) throw new Error('no profile');
      email = String(profile.email ?? profile.mail ?? profile.nameID);
    } catch (e) {
      throw new ApiError(401, 'UNAUTHENTICATED', `Invalid SAML response: ${(e as Error).message}`);
    }
    if (!email || email === 'undefined') throw new ApiError(401, 'UNAUTHENTICATED', 'No email in the SAML assertion');

    const user = (await requireDb().query<AuthUserRow>('SELECT * FROM auth_lookup($1,$2)', [email, slug]))[0];
    if (!user) throw new ApiError(403, 'FORBIDDEN', `No account for ${email} in this company`);
    if (user.status !== 'active') throw new ApiError(403, 'FORBIDDEN', 'Account is not active');

    const session = await issueSession(requireDb(), config, user.user_id, user.tenant_id);
    const out = {
      access_token: session.access_token, refresh_token: session.refresh_token,
      token_type: 'Bearer', expires_in: session.expires_in,
      user: { id: user.user_id, tenantId: user.tenant_id, fullName: user.full_name, email },
    };
    if (body.RelayState && /^https?:\/\//.test(body.RelayState)) {
      const u = new URL(body.RelayState);
      u.hash = `access_token=${session.access_token}&refresh_token=${session.refresh_token}`;
      return reply.redirect(302, u.toString());
    }
    return out;
  });
}
