import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, authenticate, getPrincipal, requirePermission } from './middleware/context';
import { parse } from './validate';
import type { Deps } from './routes';

const uuid = z.object({ id: z.string().uuid() });
const hhmm = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'expected HH:MM');

/**
 * Driver daily route plans (docs/etms/14 §driver-routes). A driver proposes,
 * for a given day, the zones (areas) they'll cover and the time window; a
 * dispatcher/ops approves. All RLS-tenant-scoped.
 */
export async function registerDriverPlanRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  const auth = authenticate(config.jwtSecret);
  const requireDb = () => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    return db;
  };

  // Driver proposes their own plan for a date (zones + time window).
  app.post('/v1/driver-plans', { preHandler: [auth, requirePermission('route_plan.propose')] }, async (req, reply) => {
    const b = parse(
      z.object({
        service_date: z.string(),
        window_start: hhmm,
        window_end: hhmm,
        zone_ids: z.array(z.string().uuid()).min(1).max(50),
        note: z.string().max(500).optional(),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const driver = (await c.query('SELECT id FROM driver WHERE user_id=$1 AND deleted_at IS NULL', [p.userId])).rows[0];
      if (!driver) throw new ApiError(422, 'VALIDATION_ERROR', 'No driver record is linked to your account');

      // Re-propose replaces a still-open plan; an approved plan is locked.
      const existing = (
        await c.query('SELECT id, status FROM driver_route_plan WHERE driver_id=$1 AND service_date=$2', [driver.id, b.service_date])
      ).rows[0];
      if (existing && existing.status === 'approved') {
        throw new ApiError(409, 'CONFLICT', 'An approved plan already exists for this date');
      }
      if (existing) await c.query('DELETE FROM driver_route_plan WHERE id=$1', [existing.id]);

      const plan = (
        await c.query(
          `INSERT INTO driver_route_plan(tenant_id, driver_id, service_date, window_start, window_end, note)
           VALUES (app_current_tenant(),$1,$2,$3,$4,$5) RETURNING *`,
          [driver.id, b.service_date, b.window_start, b.window_end, b.note ?? null],
        )
      ).rows[0];

      for (const zoneId of b.zone_ids) {
        await c.query(
          `INSERT INTO driver_route_plan_zone(tenant_id, plan_id, zone_id)
           VALUES (app_current_tenant(),$1,$2) ON CONFLICT (plan_id, zone_id) DO NOTHING`,
          [plan.id, zoneId],
        );
      }
      reply.code(201);
      return { data: { ...plan, zone_ids: b.zone_ids } };
    });
  });

  // List plans (with their zones) for a date / status.
  app.get('/v1/driver-plans', { preHandler: [auth, requirePermission('route_plan.read')] }, async (req) => {
    const q = parse(z.object({ date: z.string().optional(), status: z.string().optional() }), req.query);
    const p = getPrincipal(req);
    const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `SELECT pl.id, pl.driver_id, d.full_name AS driver_name, pl.service_date,
                pl.window_start, pl.window_end, pl.status, pl.note,
                coalesce(array_agg(z.name ORDER BY z.name) FILTER (WHERE z.name IS NOT NULL), '{}') AS zones
         FROM driver_route_plan pl
         JOIN driver d ON d.id = pl.driver_id
         LEFT JOIN driver_route_plan_zone pz ON pz.plan_id = pl.id
         LEFT JOIN zone z ON z.id = pz.zone_id
         WHERE ($1::date IS NULL OR pl.service_date=$1) AND ($2::text IS NULL OR pl.status=$2)
         GROUP BY pl.id, d.full_name
         ORDER BY pl.service_date DESC, d.full_name LIMIT 300`,
        [q.date ?? null, q.status ?? null],
      ),
    );
    return { data: rows.rows };
  });

  // Dispatcher/ops approve or reject.
  const decide = (to: 'approved' | 'rejected') => async (req: import('fastify').FastifyRequest) => {
    const { id } = parse(uuid, req.params);
    const body = to === 'rejected' ? parse(z.object({ reason: z.string().min(1).max(500) }), req.body) : { reason: null };
    const p = getPrincipal(req);
    const res = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `UPDATE driver_route_plan SET status=$2, reviewed_by=$3,
           note = COALESCE($4, note)
         WHERE id=$1 AND status='proposed' RETURNING *`,
        [id, to, p.userId, body.reason],
      ),
    );
    if (res.rowCount === 0) throw new ApiError(409, 'CONFLICT', 'Plan not found or not awaiting approval');
    return { data: res.rows[0] };
  };

  app.post('/v1/driver-plans/:id/approve', { preHandler: [auth, requirePermission('route_plan.approve')] }, decide('approved'));
  app.post('/v1/driver-plans/:id/reject', { preHandler: [auth, requirePermission('route_plan.approve')] }, decide('rejected'));
}
