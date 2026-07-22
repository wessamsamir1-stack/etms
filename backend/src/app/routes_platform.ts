import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { signJwt } from '../util/jwt';
import { hashPassword, validatePasswordStrength, verifyPassword } from '../util/password';
import { ApiError } from './middleware/context';
import { invalidateFeatureCache } from './feature_flags';
import { authenticatePlatform, getPlatform } from './middleware/platform';
import { FixedWindowLimiter, rateLimit } from './middleware/rate_limit';
import { parse } from './validate';
import type { PoolClient } from 'pg';
import type { Db } from './db/pool';
import type { Deps } from './routes';

const PLATFORM_TTL_SECONDS = 60 * 60; // 1h — short-lived; Super-Admin re-auths often.

const slug = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'lowercase letters, digits and hyphens');
const planCode = z.enum(['starter', 'business', 'enterprise', 'custom']);

/** Append a row to the platform audit trail. */
async function recordEvent(
  c: PoolClient,
  adminId: string,
  action: string,
  tenantId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await c.query(
    `INSERT INTO platform_event(admin_id, action, tenant_id, detail) VALUES ($1,$2,$3,$4)`,
    [adminId, action, tenantId, JSON.stringify(detail)],
  );
}

/**
 * Super-Admin **platform** API — cross-tenant company provisioning, subscription
 * & plan management, and per-tenant feature flags. It is deliberately SEPARATE
 * from the tenant-scoped API: it authenticates platform operators (not tenant
 * users) and runs on `platformDb`, a connection using the BYPASSRLS
 * `etms_platform` role, so it can read and write across every company. A tenant
 * JWT can never reach these routes (guard requires `platform:true`), and a
 * platform JWT carries no tenant and can never reach the tenant-scoped routes.
 */
export async function registerPlatformRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { config } = deps;
  const platformDb = deps.platformDb;
  const guard = authenticatePlatform(config.jwtSecret);
  const requireDb = (): Db => {
    if (!platformDb) throw new ApiError(503, 'INTERNAL', 'Platform database not configured');
    return platformDb;
  };

  const loginLimiter = new FixedWindowLimiter(60_000, 10);
  const loginGuards = config.env === 'test' ? [] : [rateLimit(loginLimiter)];

  // ---- Platform login (operator → platform JWT) ----------------------------
  app.post('/v1/platform/login', { preHandler: loginGuards }, async (req) => {
    const b = parse(
      z.object({ email: z.string().email(), password: z.string().min(1) }),
      req.body,
    );
    const db = requireDb();
    const admin = (
      await db.query<{ id: string; password_hash: string | null; status: string; full_name: string }>(
        'SELECT id, password_hash, status, full_name FROM platform_admin WHERE email=$1',
        [b.email],
      )
    )[0];
    if (!admin || !admin.password_hash || !verifyPassword(b.password, admin.password_hash)) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid credentials');
    }
    if (admin.status !== 'active') throw new ApiError(403, 'FORBIDDEN', 'Account is disabled');
    await db.query('UPDATE platform_admin SET last_login_at = now() WHERE id=$1', [admin.id]);

    const exp = Math.floor(Date.now() / 1000) + PLATFORM_TTL_SECONDS;
    const access_token = signJwt({ sub: admin.id, tenant_id: '', platform: true, exp }, config.jwtSecret);
    return {
      access_token,
      token_type: 'Bearer',
      expires_in: PLATFORM_TTL_SECONDS,
      admin: { id: admin.id, fullName: admin.full_name },
    };
  });

  // ---- List companies (tenants) + their active plan ------------------------
  app.get('/v1/platform/companies', { preHandler: [guard] }, async () => {
    const rows = await requireDb().query(
      `SELECT t.id, t.name, t.slug, t.status, t.region, t.default_locale,
              t.default_currency, t.default_timezone, t.created_at,
              s.plan_code, s.status AS subscription_status,
              s.seats_limit, s.vehicles_limit, s.sites_limit, s.ends_at
         FROM tenant t
         LEFT JOIN subscription s ON s.tenant_id = t.id AND s.status = 'active'
        WHERE t.deleted_at IS NULL
        ORDER BY t.created_at DESC
        LIMIT 500`,
    );
    return { data: rows };
  });

  // ---- Provision a company (tenant + optional admin + subscription) --------
  app.post('/v1/platform/companies', { preHandler: [guard] }, async (req, reply) => {
    const b = parse(
      z.object({
        name: z.string().min(1),
        slug,
        region: z.string().optional(),
        defaultLocale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
        defaultCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
        defaultTimezone: z.string().optional(),
        plan: planCode.optional(),
        seatsLimit: z.number().int().nonnegative().optional(),
        vehiclesLimit: z.number().int().nonnegative().optional(),
        sitesLimit: z.number().int().nonnegative().optional(),
        adminEmail: z.string().email().optional(),
        adminPassword: z.string().optional(),
        adminName: z.string().optional(),
      }),
      req.body,
    );
    if (b.adminEmail && !b.adminPassword) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'adminPassword is required with adminEmail');
    }
    if (b.adminPassword) {
      const s = validatePasswordStrength(b.adminPassword);
      if (!s.ok) throw new ApiError(422, 'VALIDATION_ERROR', `Weak password: ${s.issues.join(', ')}`);
    }
    const admin = getPlatform(req);

    try {
      const result = await requireDb().tx(async (c) => {
        const tenant = (
          await c.query<{ id: string }>(
            `INSERT INTO tenant(name, slug, region, default_locale, default_currency, default_timezone)
             VALUES ($1,$2,COALESCE($3,'default'),COALESCE($4,'ar'),COALESCE($5,'KWD'),COALESCE($6,'Asia/Kuwait'))
             RETURNING id`,
            [b.name, b.slug, b.region ?? null, b.defaultLocale ?? null, b.defaultCurrency ?? null, b.defaultTimezone ?? null],
          )
        ).rows[0]!;
        const tenantId = tenant.id;

        // Optional bootstrap admin so the company can sign in immediately: a
        // tenant 'admin' role cloning the company_admin permission set + a user.
        let adminUserId: string | null = null;
        if (b.adminEmail && b.adminPassword) {
          const roleId = (
            await c.query<{ id: string }>(
              `INSERT INTO role(tenant_id, code, name) VALUES ($1,'admin','Administrator') RETURNING id`,
              [tenantId],
            )
          ).rows[0]!.id;
          await c.query(
            `INSERT INTO role_permission(role_id, permission_id)
               SELECT $1, rp.permission_id FROM role_permission rp
               JOIN role r ON r.id = rp.role_id
               WHERE r.code='company_admin' AND r.tenant_id IS NULL
               ON CONFLICT DO NOTHING`,
            [roleId],
          );
          adminUserId = (
            await c.query<{ id: string }>(
              `INSERT INTO app_user(tenant_id, email, full_name, status, password_hash)
               VALUES ($1,$2,COALESCE($3,'Administrator'),'active',$4) RETURNING id`,
              [tenantId, b.adminEmail, b.adminName ?? null, hashPassword(b.adminPassword)],
            )
          ).rows[0]!.id;
          await c.query(
            `INSERT INTO user_role(tenant_id, user_id, role_id) VALUES ($1,$2,$3)
             ON CONFLICT (user_id, role_id) DO NOTHING`,
            [tenantId, adminUserId, roleId],
          );
        }

        // Optional initial subscription (plan + limits).
        if (b.plan) {
          await c.query(
            `INSERT INTO subscription(tenant_id, plan_code, seats_limit, vehicles_limit, sites_limit, status)
             VALUES ($1,$2,$3,$4,$5,'active')`,
            [tenantId, b.plan, b.seatsLimit ?? null, b.vehiclesLimit ?? null, b.sitesLimit ?? null],
          );
        }

        await recordEvent(c, admin.adminId, 'company.create', tenantId, {
          slug: b.slug,
          plan: b.plan ?? null,
          admin_user: adminUserId,
        });

        const row = (
          await c.query(
            `SELECT id, name, slug, status, region, default_locale, default_currency,
                    default_timezone, created_at FROM tenant WHERE id=$1`,
            [tenantId],
          )
        ).rows[0];
        return { tenant: row, adminUserId };
      });
      reply.code(201);
      return { data: result.tenant, adminUserId: result.adminUserId };
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ApiError(409, 'CONFLICT', 'A company with that slug already exists');
      }
      throw e;
    }
  });

  // ---- Company detail (tenant + active subscription + feature flags) -------
  app.get('/v1/platform/companies/:id', { preHandler: [guard] }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const db = requireDb();
    const tenant = (
      await db.query(
        `SELECT id, name, slug, status, region, default_locale, default_currency,
                default_timezone, created_at FROM tenant WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )
    )[0];
    if (!tenant) throw new ApiError(404, 'NOT_FOUND', 'Company not found');
    const subscriptions = await db.query(
      `SELECT id, plan_code, status, seats_limit, vehicles_limit, sites_limit,
              started_at, ends_at FROM subscription WHERE tenant_id=$1 ORDER BY started_at DESC`,
      [id],
    );
    const features = await db.query(
      `SELECT feature, enabled, config, updated_at FROM tenant_feature WHERE tenant_id=$1 ORDER BY feature`,
      [id],
    );
    return { data: { ...tenant, subscriptions, features } };
  });

  // ---- Suspend / activate a company ----------------------------------------
  const setStatus = (action: 'suspend' | 'activate', status: 'suspended' | 'active') =>
    async (req: import('fastify').FastifyRequest) => {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const admin = getPlatform(req);
      const row = await requireDb().tx(async (c) => {
        const r = (
          await c.query<{ id: string; status: string }>(
            `UPDATE tenant SET status=$2 WHERE id=$1 AND deleted_at IS NULL RETURNING id, status`,
            [id, status],
          )
        ).rows[0];
        if (!r) throw new ApiError(404, 'NOT_FOUND', 'Company not found');
        await recordEvent(c, admin.adminId, `company.${action}`, id, {});
        return r;
      });
      return { data: row };
    };
  app.post('/v1/platform/companies/:id/suspend', { preHandler: [guard] }, setStatus('suspend', 'suspended'));
  app.post('/v1/platform/companies/:id/activate', { preHandler: [guard] }, setStatus('activate', 'active'));

  // ---- Set / change a company's subscription (plan + limits) ---------------
  // Enforces one active subscription per tenant (uq_subscription_active): the
  // current active row is cancelled, then the new plan becomes active.
  app.put('/v1/platform/companies/:id/subscription', { preHandler: [guard] }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(
      z.object({
        plan: planCode,
        seatsLimit: z.number().int().nonnegative().nullable().optional(),
        vehiclesLimit: z.number().int().nonnegative().nullable().optional(),
        sitesLimit: z.number().int().nonnegative().nullable().optional(),
        endsAt: z.string().datetime().nullable().optional(),
      }),
      req.body,
    );
    const admin = getPlatform(req);
    return requireDb().tx(async (c) => {
      const exists = (await c.query('SELECT 1 FROM tenant WHERE id=$1 AND deleted_at IS NULL', [id])).rowCount;
      if (!exists) throw new ApiError(404, 'NOT_FOUND', 'Company not found');
      await c.query(`UPDATE subscription SET status='cancelled' WHERE tenant_id=$1 AND status='active'`, [id]);
      const sub = (
        await c.query(
          `INSERT INTO subscription(tenant_id, plan_code, seats_limit, vehicles_limit, sites_limit, status, ends_at)
           VALUES ($1,$2,$3,$4,$5,'active',$6)
           RETURNING id, plan_code, status, seats_limit, vehicles_limit, sites_limit, started_at, ends_at`,
          [id, b.plan, b.seatsLimit ?? null, b.vehiclesLimit ?? null, b.sitesLimit ?? null, b.endsAt ?? null],
        )
      ).rows[0];
      await recordEvent(c, admin.adminId, 'subscription.set', id, { plan: b.plan });
      return { data: sub };
    });
  });

  // ---- Feature flags -------------------------------------------------------
  app.get('/v1/platform/companies/:id/features', { preHandler: [guard] }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const rows = await requireDb().query(
      `SELECT feature, enabled, config, updated_at FROM tenant_feature WHERE tenant_id=$1 ORDER BY feature`,
      [id],
    );
    return { data: rows };
  });

  app.put('/v1/platform/companies/:id/features', { preHandler: [guard] }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(
      z.object({
        feature: z.string().min(1).max(64).regex(/^[a-z0-9_.]+$/, 'lowercase, digits, dot, underscore'),
        enabled: z.boolean(),
        config: z.record(z.unknown()).optional(),
      }),
      req.body,
    );
    const admin = getPlatform(req);
    return requireDb().tx(async (c) => {
      const exists = (await c.query('SELECT 1 FROM tenant WHERE id=$1 AND deleted_at IS NULL', [id])).rowCount;
      if (!exists) throw new ApiError(404, 'NOT_FOUND', 'Company not found');
      const row = (
        await c.query(
          `INSERT INTO tenant_feature(tenant_id, feature, enabled, config)
           VALUES ($1,$2,$3,COALESCE($4,'{}'::jsonb))
           ON CONFLICT (tenant_id, feature)
           DO UPDATE SET enabled=EXCLUDED.enabled,
             -- Preserve existing config when the request omits it (a plain
             -- enable/disable toggle must not wipe a feature's config).
             config = CASE WHEN $4 IS NULL THEN tenant_feature.config ELSE $4::jsonb END,
             updated_at=now()
           RETURNING feature, enabled, config, updated_at`,
          [id, b.feature, b.enabled, b.config ? JSON.stringify(b.config) : null],
        )
      ).rows[0];
      await recordEvent(c, admin.adminId, 'feature.set', id, { feature: b.feature, enabled: b.enabled });
      invalidateFeatureCache(id); // same-process: reflect the change immediately
      return { data: row };
    });
  });
}
