import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, authenticate, getPrincipal, requirePermission } from './middleware/context';
import { parse } from './validate';
import type { Deps } from './routes';

const uuid = z.object({ id: z.string().uuid() });
const rate = z.number().int().min(1).max(5).optional();

/**
 * Trip rating, lost & found, employee/vehicle history, and white-label branding
 * (docs/etms/17 §10–14). All RLS-tenant-scoped.
 */
export async function registerFeedbackRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  const auth = authenticate(config.jwtSecret);
  const requireDb = () => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    return db;
  };

  // ---- Trip rating (employee) ---------------------------------------------
  app.post('/v1/trips/:id/rating', { preHandler: [auth, requirePermission('rating.create')] }, async (req, reply) => {
    const { id } = parse(uuid, req.params);
    const b = parse(z.object({ driver: rate, cleanliness: rate, ac: rate, punctuality: rate, comment: z.string().max(500).optional() }), req.body);
    const p = getPrincipal(req);
    const row = await requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const emp = (await c.query('SELECT id FROM employee WHERE user_id=$1 AND deleted_at IS NULL', [p.userId])).rows[0];
      if (!emp) throw new ApiError(422, 'VALIDATION_ERROR', 'No employee is linked to your account');
      const driverId = (await c.query('SELECT driver_id FROM assignment WHERE trip_id=$1', [id])).rows[0]?.driver_id ?? null;
      const r = await c.query(
        `INSERT INTO trip_rating(tenant_id, trip_id, employee_id, driver_id, rate_driver, rate_cleanliness, rate_ac, rate_punctuality, comment)
         VALUES (app_current_tenant(),$1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (trip_id, employee_id) DO UPDATE
           SET rate_driver=EXCLUDED.rate_driver, rate_cleanliness=EXCLUDED.rate_cleanliness,
               rate_ac=EXCLUDED.rate_ac, rate_punctuality=EXCLUDED.rate_punctuality, comment=EXCLUDED.comment
         RETURNING *`,
        [id, emp.id, driverId, b.driver ?? null, b.cleanliness ?? null, b.ac ?? null, b.punctuality ?? null, b.comment ?? null],
      );
      return r.rows[0];
    });
    reply.code(201);
    return { data: row };
  });

  // Rating summary per driver (ops dashboard).
  app.get('/v1/ratings/summary', { preHandler: [auth, requirePermission('rating.read')] }, async (req) => {
    const p = getPrincipal(req);
    const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `SELECT d.id AS driver_id, d.full_name, count(*)::int AS ratings,
                round(avg(tr.rate_driver),2)      AS avg_driver,
                round(avg(tr.rate_cleanliness),2) AS avg_cleanliness,
                round(avg(tr.rate_ac),2)          AS avg_ac,
                round(avg(tr.rate_punctuality),2) AS avg_punctuality
         FROM trip_rating tr JOIN driver d ON d.id=tr.driver_id
         GROUP BY d.id, d.full_name ORDER BY avg_driver DESC NULLS LAST`,
      ),
    );
    return { data: rows.rows };
  });

  // ---- Lost & found -------------------------------------------------------
  app.post('/v1/lost-items', { preHandler: [auth, requirePermission('lost_item.create')] }, async (req, reply) => {
    const b = parse(z.object({ trip_id: z.string().uuid().optional(), description: z.string().min(1).max(500) }), req.body);
    const p = getPrincipal(req);
    const row = await requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const emp = (await c.query('SELECT id FROM employee WHERE user_id=$1 AND deleted_at IS NULL', [p.userId])).rows[0];
      if (!emp) throw new ApiError(422, 'VALIDATION_ERROR', 'No employee is linked to your account');
      const driverId = b.trip_id ? (await c.query('SELECT driver_id FROM assignment WHERE trip_id=$1', [b.trip_id])).rows[0]?.driver_id ?? null : null;
      const r = await c.query(
        `INSERT INTO lost_item(tenant_id, trip_id, employee_id, driver_id, description)
         VALUES (app_current_tenant(),$1,$2,$3,$4) RETURNING *`,
        [b.trip_id ?? null, emp.id, driverId, b.description],
      );
      return r.rows[0];
    });
    reply.code(201);
    return { data: row };
  });

  app.get('/v1/lost-items', { preHandler: [auth, requirePermission('lost_item.read')] }, async (req) => {
    const q = parse(z.object({ status: z.string().optional() }), req.query);
    const p = getPrincipal(req);
    const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `SELECT li.id, li.trip_id, li.description, li.status, li.created_at,
                e.full_name AS reporter, d.full_name AS driver
         FROM lost_item li JOIN employee e ON e.id=li.employee_id
         LEFT JOIN driver d ON d.id=li.driver_id
         WHERE ($1::text IS NULL OR li.status=$1) ORDER BY li.created_at DESC LIMIT 200`,
        [q.status ?? null],
      ),
    );
    return { data: rows.rows };
  });

  app.post('/v1/lost-items/:id/status', { preHandler: [auth, requirePermission('lost_item.read')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const b = parse(z.object({ status: z.enum(['open', 'found', 'returned', 'closed']) }), req.body);
    const p = getPrincipal(req);
    const res = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query('UPDATE lost_item SET status=$2 WHERE id=$1 RETURNING *', [id, b.status]),
    );
    if (res.rowCount === 0) throw new ApiError(404, 'NOT_FOUND', 'Report not found');
    return { data: res.rows[0] };
  });

  // ---- Employee & vehicle history -----------------------------------------
  app.get('/v1/employees/:id/history', { preHandler: [auth, requirePermission('employee.read')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const stats = (await c.query('SELECT trips, boarded, no_shows, excused, last_trip FROM v_employee_trip_stats WHERE employee_id=$1', [id])).rows[0]
        ?? { trips: 0, boarded: 0, no_shows: 0, excused: 0, last_trip: null };
      const recent = (
        await c.query(
          `SELECT tp.trip_id, t.service_date, t.direction, tp.status, tp.boarded_at
           FROM trip_passenger tp JOIN trip t ON t.id=tp.trip_id
           WHERE tp.employee_id=$1 ORDER BY t.service_date DESC LIMIT 30`,
          [id],
        )
      ).rows;
      return { data: { stats, recent } };
    });
  });

  app.get('/v1/vehicles/:id/history', { preHandler: [auth, requirePermission('vehicle.read')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const p = getPrincipal(req);
    const row = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query('SELECT vehicle_id, plate_no, status, trips, passengers, last_used FROM v_vehicle_stats WHERE vehicle_id=$1', [id]),
    );
    return { data: row.rows[0] ?? null };
  });

  // ---- White-label branding -----------------------------------------------
  app.get('/v1/branding', { preHandler: [auth, requirePermission('tenant.read')] }, async (req) => {
    const p = getPrincipal(req);
    const row = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query('SELECT app_name, logo_url, primary_color, secondary_color, theme_json FROM tenant_branding WHERE tenant_id=app_current_tenant()'),
    );
    return { data: row.rows[0] ?? {} };
  });

  app.put('/v1/branding', { preHandler: [auth, requirePermission('branding.manage')] }, async (req) => {
    const b = parse(
      z.object({
        app_name: z.string().max(80).optional(),
        logo_url: z.string().max(500).optional(),
        primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        secondary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        splash_url: z.string().max(500).optional(),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    const row = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `INSERT INTO tenant_branding(tenant_id, app_name, logo_url, primary_color, secondary_color, theme_json)
         VALUES (app_current_tenant(),$1,$2,$3,$4, jsonb_build_object('splash_url',$5::text))
         ON CONFLICT (tenant_id) DO UPDATE SET
           app_name=coalesce($1, tenant_branding.app_name),
           logo_url=coalesce($2, tenant_branding.logo_url),
           primary_color=coalesce($3, tenant_branding.primary_color),
           secondary_color=coalesce($4, tenant_branding.secondary_color),
           theme_json = tenant_branding.theme_json || jsonb_build_object('splash_url', coalesce($5, tenant_branding.theme_json->>'splash_url'))
         RETURNING app_name, logo_url, primary_color, secondary_color, theme_json`,
        [b.app_name ?? null, b.logo_url ?? null, b.primary_color ?? null, b.secondary_color ?? null, b.splash_url ?? null],
      ),
    );
    return { data: row.rows[0] };
  });
}
