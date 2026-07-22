import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { signJwt } from '../util/jwt';
import { hashPassword, validatePasswordStrength, verifyPassword } from '../util/password';
import { hashToken } from '../util/tokens';
import { generateSecret, otpauthUri, verifyTotp } from '../util/totp';
import { ApiError, authenticate, getPrincipal } from './middleware/context';
import { FixedWindowLimiter, rateLimit } from './middleware/rate_limit';
import { issueSession, loadPermissions, loadScope } from './auth_tokens';
import { parse } from './validate';
import type { Db } from './db/pool';
import type { Deps } from './routes';

const STEPUP_TTL_SECONDS = 5 * 60;

interface AuthRow {
  user_id: string;
  tenant_id: string;
  password_hash: string | null;
  status: string;
  full_name: string;
}
interface SessionRow {
  session_id: string;
  user_id: string;
  tenant_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  user_status: string;
}

/**
 * Auth routes: rate-limited login, refresh-token rotation, and logout.
 * Login mints a short-lived access JWT (permissions in claims) + a long-lived
 * opaque refresh token (only its hash is stored, in user_session). Refresh
 * rotates the token (revoke old, issue new) so a stolen refresh token is
 * single-use. All lookups that predate a tenant context use the V0014/V0015
 * SECURITY DEFINER functions; writes run tenant-scoped (RLS).
 */
export async function registerAuthRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  const loginLimiter = new FixedWindowLimiter(60_000, 10); // 10 attempts / minute / IP
  // Rate limiting is infra (unit-tested in rate_limit.test.ts); skip it under
  // the test env so the shared-IP test suite doesn't trip the limit.
  const loginGuards = config.env === 'test' ? [] : [rateLimit(loginLimiter)];

  app.post('/v1/auth/login', { preHandler: loginGuards }, async (req, reply) => {
    const b = parse(
      z.object({
        tenantSlug: z.string().min(1),
        email: z.string().email(),
        password: z.string().min(1),
      }),
      req.body,
    );
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');

    // Per-account lockout: reject while the account is in a cool-down window
    // (progressive lock after repeated failures — see V0017). Works even for
    // non-existent accounts, so it also throttles email guessing.
    const status = (
      await db.query<{ locked: boolean; retry_after: number }>(
        'SELECT * FROM auth_login_status($1,$2)',
        [b.tenantSlug, b.email],
      )
    )[0];
    if (status?.locked) {
      reply.header('Retry-After', status.retry_after);
      throw new ApiError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts; account temporarily locked');
    }

    const rows = await db.query<AuthRow>('SELECT * FROM auth_lookup($1,$2)', [b.email, b.tenantSlug]);
    const user = rows[0];
    if (!user || !user.password_hash || !verifyPassword(b.password, user.password_hash)) {
      await db.query('SELECT * FROM auth_login_failure($1,$2)', [b.tenantSlug, b.email]);
      throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid credentials');
    }
    if (user.status !== 'active') throw new ApiError(403, 'FORBIDDEN', 'Account is not active');

    // Successful auth → clear the failure counter.
    await db.query('SELECT auth_login_success($1,$2)', [b.tenantSlug, b.email]);

    const session = await issueSession(db, config, user.user_id, user.tenant_id);
    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      token_type: 'Bearer',
      expires_in: session.expires_in,
      user: { id: user.user_id, tenantId: user.tenant_id, fullName: user.full_name, permissions: session.permissions },
    };
  });

  app.post('/v1/auth/refresh', async (req) => {
    const b = parse(z.object({ refreshToken: z.string().min(1) }), req.body);
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');

    const rows = await db.query<SessionRow>('SELECT * FROM auth_session_lookup($1)', [
      hashToken(b.refreshToken),
    ]);
    const s = rows[0];
    if (!s || s.revoked_at || new Date(s.expires_at).getTime() < Date.now()) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid or expired refresh token');
    }
    if (s.user_status !== 'active') throw new ApiError(403, 'FORBIDDEN', 'Account is not active');

    // Rotate: revoke the used token, issue a fresh one (single-use refresh).
    await db.withTenant(s.tenant_id, s.user_id, (c) =>
      c.query('UPDATE user_session SET revoked_at = now() WHERE id = $1', [s.session_id]),
    );
    const session = await issueSession(db, config, s.user_id, s.tenant_id);
    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      token_type: 'Bearer',
      expires_in: session.expires_in,
    };
  });

  app.post('/v1/auth/logout', async (req) => {
    const b = parse(z.object({ refreshToken: z.string().min(1) }), req.body);
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    const rows = await db.query<SessionRow>('SELECT * FROM auth_session_lookup($1)', [
      hashToken(b.refreshToken),
    ]);
    const s = rows[0];
    if (s && !s.revoked_at) {
      await db.withTenant(s.tenant_id, s.user_id, (c) =>
        c.query('UPDATE user_session SET revoked_at = now() WHERE id = $1', [s.session_id]),
      );
    }
    return { ok: true };
  });

  // ---- Change password (authenticated) -------------------------------------
  const auth = authenticate(config.jwtSecret);

  app.post('/v1/auth/password', { preHandler: [auth] }, async (req) => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    const b = parse(
      z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) }),
      req.body,
    );
    const strength = validatePasswordStrength(b.newPassword);
    if (!strength.ok) {
      throw new ApiError(422, 'VALIDATION_ERROR', `Weak password: ${strength.issues.join(', ')}`);
    }
    const p = getPrincipal(req);
    return db.withTenant(p.tenantId, p.userId, async (c) => {
      const u = (await c.query<{ password_hash: string | null }>(
        'SELECT password_hash FROM app_user WHERE id=$1',
        [p.userId],
      )).rows[0];
      if (!u?.password_hash || !verifyPassword(b.currentPassword, u.password_hash)) {
        throw new ApiError(401, 'UNAUTHENTICATED', 'Current password is incorrect');
      }
      await c.query('UPDATE app_user SET password_hash=$2 WHERE id=$1', [p.userId, hashPassword(b.newPassword)]);
      // Force re-login on other devices after a password change.
      await c.query('UPDATE user_session SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [p.userId]);
      return { ok: true };
    });
  });

  // Enroll: issue a TOTP secret (unconfirmed until /verify).
  app.post('/v1/auth/mfa/enroll', { preHandler: [auth] }, async (req) => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    const p = getPrincipal(req);
    const secret = generateSecret();
    await db.withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `INSERT INTO user_mfa_factor(tenant_id, user_id, type, secret_enc) VALUES ($1,$2,'totp',$3)`,
        [p.tenantId, p.userId, secret], // production: KMS-encrypt secret_enc
      ),
    );
    return { secret, otpauthUri: otpauthUri(secret, p.userId) };
  });

  // Confirm enrollment: verify a code → mark confirmed + enable MFA on the user.
  app.post('/v1/auth/mfa/verify', { preHandler: [auth] }, async (req) => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    const b = parse(z.object({ code: z.string().length(6) }), req.body);
    const p = getPrincipal(req);
    return db.withTenant(p.tenantId, p.userId, async (c) => {
      const factor = (
        await c.query<{ id: string; secret_enc: string }>(
          `SELECT id, secret_enc FROM user_mfa_factor
           WHERE user_id=$1 AND type='totp' ORDER BY created_at DESC LIMIT 1`,
          [p.userId],
        )
      ).rows[0];
      if (!factor) throw new ApiError(422, 'VALIDATION_ERROR', 'No MFA factor enrolled');
      if (!verifyTotp(b.code, factor.secret_enc, Math.floor(Date.now() / 1000))) {
        throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid code');
      }
      await c.query('UPDATE user_mfa_factor SET confirmed_at = now() WHERE id=$1', [factor.id]);
      await c.query('UPDATE app_user SET mfa_enabled = true WHERE id=$1', [p.userId]);
      return { enabled: true };
    });
  });

  // Step-up: verify a code → mint a short-lived access token carrying mfa:true,
  // which requireMfa()-guarded sensitive endpoints demand.
  app.post('/v1/auth/mfa/challenge', { preHandler: [auth] }, async (req) => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    const b = parse(z.object({ code: z.string().length(6) }), req.body);
    const p = getPrincipal(req);
    const factor = (
      await db.withTenant(p.tenantId, p.userId, (c) =>
        c.query<{ secret_enc: string }>(
          `SELECT secret_enc FROM user_mfa_factor
           WHERE user_id=$1 AND type='totp' AND confirmed_at IS NOT NULL
           ORDER BY created_at DESC LIMIT 1`,
          [p.userId],
        ),
      )
    ).rows[0];
    if (!factor) throw new ApiError(422, 'VALIDATION_ERROR', 'MFA is not set up');
    if (!verifyTotp(b.code, factor.secret_enc, Math.floor(Date.now() / 1000))) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid code');
    }
    const perms = await loadPermissions(db, p.userId);
    const scope = await loadScope(db, p.userId);
    const exp = Math.floor(Date.now() / 1000) + STEPUP_TTL_SECONDS;
    const access_token = signJwt(
      { sub: p.userId, tenant_id: p.tenantId, permissions: perms, scope_site_ids: scope, mfa: true, exp },
      config.jwtSecret,
    );
    return { access_token, token_type: 'Bearer', expires_in: STEPUP_TTL_SECONDS, mfa: true };
  });
}
