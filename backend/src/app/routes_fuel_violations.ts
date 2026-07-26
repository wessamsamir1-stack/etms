import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, authenticate, getPrincipal, requirePermission } from './middleware/context';
import { parse } from './validate';
import type { Deps } from './routes';

const uuid = z.object({ id: z.string().uuid() });
const dateRange = z.object({ from: z.string(), to: z.string() });
const money = z.number().nonnegative();

const fuelTypes = ['petrol_91', 'petrol_95', 'diesel'] as const;
const violationTypes = [
  'speeding', 'parking', 'red_light', 'phone_use', 'seat_belt', 'lane', 'overload', 'documents', 'other',
] as const;
const violationStatuses = ['pending', 'paid', 'disputed', 'waived', 'deducted'] as const;

/**
 * Fuel log + traffic-violation register + their reports (db V0029).
 * All RLS-tenant-scoped.
 */
export async function registerFuelViolationRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  const auth = authenticate(config.jwtSecret);
  const requireDb = () => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    return db;
  };

  // ---- Fuel log -----------------------------------------------------------
  app.post('/v1/fuel-logs', { preHandler: [auth, requirePermission('fuel.create')] }, async (req, reply) => {
    const b = parse(
      z.object({
        vehicle_id: z.string().uuid(),
        driver_id: z.string().uuid().optional(),
        filled_at: z.string().datetime({ offset: true }).optional(),
        fuel_type: z.enum(fuelTypes).default('petrol_91'),
        liters: z.number().positive(),
        cost_amount: money,
        odometer_km: z.number().int().nonnegative().optional(),
        station: z.string().max(120).optional(),
        receipt_url: z.string().max(500).optional(),
        notes: z.string().max(500).optional(),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    const row = await requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      // A driver recording their own fill doesn't send driver_id — resolve it
      // from their linked driver row.
      const driverId = b.driver_id
        ?? (await c.query('SELECT id FROM driver WHERE user_id=$1 AND deleted_at IS NULL', [p.userId])).rows[0]?.id
        ?? null;
      const r = await c.query(
        `INSERT INTO fuel_log(tenant_id, vehicle_id, driver_id, filled_at, fuel_type, liters,
                              cost_amount, odometer_km, station, receipt_url, notes, created_by)
         VALUES (app_current_tenant(),$1,$2,coalesce($3::timestamptz, now()),$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [b.vehicle_id, driverId, b.filled_at ?? null, b.fuel_type, b.liters, b.cost_amount,
         b.odometer_km ?? null, b.station ?? null, b.receipt_url ?? null, b.notes ?? null, p.userId],
      );
      return r.rows[0];
    });
    reply.code(201);
    return { data: row };
  });

  app.get('/v1/fuel-logs', { preHandler: [auth, requirePermission('fuel.read')] }, async (req) => {
    const q = parse(
      z.object({
        vehicle_id: z.string().uuid().optional(),
        driver_id: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
      req.query,
    );
    const p = getPrincipal(req);
    const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `SELECT fl.id, fl.vehicle_id, v.plate_no, fl.driver_id, d.full_name AS driver,
                fl.filled_at, fl.fuel_type, fl.liters, fl.cost_amount, fl.currency_code,
                fl.odometer_km, fl.station, fl.receipt_url, fl.notes
         FROM fuel_log fl
         JOIN vehicle v ON v.id = fl.vehicle_id
         LEFT JOIN driver d ON d.id = fl.driver_id
         WHERE fl.deleted_at IS NULL
           AND ($1::uuid IS NULL OR fl.vehicle_id=$1)
           AND ($2::uuid IS NULL OR fl.driver_id=$2)
           AND ($3::date IS NULL OR fl.filled_at >= $3::date)
           AND ($4::date IS NULL OR fl.filled_at < ($4::date + 1))
         ORDER BY fl.filled_at DESC LIMIT 200`,
        [q.vehicle_id ?? null, q.driver_id ?? null, q.from ?? null, q.to ?? null],
      ),
    );
    return { data: rows.rows };
  });

  app.patch('/v1/fuel-logs/:id', { preHandler: [auth, requirePermission('fuel.manage')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const b = parse(
      z.object({
        liters: z.number().positive().optional(),
        cost_amount: money.optional(),
        odometer_km: z.number().int().nonnegative().optional(),
        station: z.string().max(120).optional(),
        notes: z.string().max(500).optional(),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    const res = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `UPDATE fuel_log SET
           liters      = coalesce($2, liters),
           cost_amount = coalesce($3, cost_amount),
           odometer_km = coalesce($4, odometer_km),
           station     = coalesce($5, station),
           notes       = coalesce($6, notes)
         WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
        [id, b.liters ?? null, b.cost_amount ?? null, b.odometer_km ?? null, b.station ?? null, b.notes ?? null],
      ),
    );
    if (res.rowCount === 0) throw new ApiError(404, 'NOT_FOUND', 'Fuel log not found');
    return { data: res.rows[0] };
  });

  app.delete('/v1/fuel-logs/:id', { preHandler: [auth, requirePermission('fuel.manage')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const p = getPrincipal(req);
    const res = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query('UPDATE fuel_log SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL', [id]),
    );
    if (res.rowCount === 0) throw new ApiError(404, 'NOT_FOUND', 'Fuel log not found');
    return { data: { id, deleted: true } };
  });

  // ---- Traffic violations -------------------------------------------------
  app.post('/v1/violations', { preHandler: [auth, requirePermission('violation.create')] }, async (req, reply) => {
    const b = parse(
      z.object({
        vehicle_id: z.string().uuid(),
        driver_id: z.string().uuid().optional(),
        trip_id: z.string().uuid().optional(),
        violation_no: z.string().max(60).optional(),
        violation_type: z.enum(violationTypes).default('other'),
        occurred_at: z.string().datetime({ offset: true }).optional(),
        location: z.string().max(200).optional(),
        amount: money.default(0),
        deduct_from_driver: z.boolean().default(false),
        notes: z.string().max(500).optional(),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    const row = await requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const r = await c.query(
        `INSERT INTO traffic_violation(tenant_id, vehicle_id, driver_id, trip_id, violation_no,
                                       violation_type, occurred_at, location, amount,
                                       deduct_from_driver, notes, created_by)
         VALUES (app_current_tenant(),$1,$2,$3,$4,$5,coalesce($6::timestamptz, now()),$7,$8,$9,$10,$11)
         RETURNING *`,
        [b.vehicle_id, b.driver_id ?? null, b.trip_id ?? null, b.violation_no ?? null,
         b.violation_type, b.occurred_at ?? null, b.location ?? null, b.amount,
         b.deduct_from_driver, b.notes ?? null, p.userId],
      ).catch((e: { code?: string }) => {
        if (e.code === '23505') throw new ApiError(409, 'CONFLICT', 'This violation number is already registered');
        throw e;
      });
      return r.rows[0];
    });
    reply.code(201);
    return { data: row };
  });

  app.get('/v1/violations', { preHandler: [auth, requirePermission('violation.read')] }, async (req) => {
    const q = parse(
      z.object({
        status: z.enum(violationStatuses).optional(),
        vehicle_id: z.string().uuid().optional(),
        driver_id: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
      req.query,
    );
    const p = getPrincipal(req);
    // A driver (read-only, no manage permission) sees only their own violations.
    const manager = p.permissions.has('violation.manage');
    const rows = await requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      let ownDriverId: string | null = null;
      if (!manager) {
        ownDriverId =
          (await c.query('SELECT id FROM driver WHERE user_id=$1 AND deleted_at IS NULL', [p.userId])).rows[0]?.id ?? null;
      }
      return c.query(
        `SELECT tv.id, tv.vehicle_id, v.plate_no, tv.driver_id, d.full_name AS driver,
                tv.violation_no, tv.violation_type, tv.occurred_at, tv.location,
                tv.amount, tv.currency_code, tv.status, tv.paid_at, tv.deduct_from_driver, tv.notes
         FROM traffic_violation tv
         JOIN vehicle v ON v.id = tv.vehicle_id
         LEFT JOIN driver d ON d.id = tv.driver_id
         WHERE tv.deleted_at IS NULL
           AND ($1::text IS NULL OR tv.status=$1)
           AND ($2::uuid IS NULL OR tv.vehicle_id=$2)
           AND ($3::uuid IS NULL OR tv.driver_id=$3)
           AND ($4::date IS NULL OR tv.occurred_at >= $4::date)
           AND ($5::date IS NULL OR tv.occurred_at < ($5::date + 1))
           AND ($6::boolean OR tv.driver_id = $7::uuid)
         ORDER BY tv.occurred_at DESC LIMIT 200`,
        [q.status ?? null, q.vehicle_id ?? null, q.driver_id ?? null, q.from ?? null, q.to ?? null,
         manager, ownDriverId],
      );
    });
    return { data: rows.rows };
  });

  app.post('/v1/violations/:id/status', { preHandler: [auth, requirePermission('violation.manage')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const b = parse(z.object({ status: z.enum(violationStatuses) }), req.body);
    const p = getPrincipal(req);
    const res = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `UPDATE traffic_violation SET status=$2,
                paid_at = CASE WHEN $2 IN ('paid','deducted') THEN coalesce(paid_at, now()) ELSE paid_at END
         WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
        [id, b.status],
      ),
    );
    if (res.rowCount === 0) throw new ApiError(404, 'NOT_FOUND', 'Violation not found');
    return { data: res.rows[0] };
  });

  app.delete('/v1/violations/:id', { preHandler: [auth, requirePermission('violation.manage')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const p = getPrincipal(req);
    const res = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query('UPDATE traffic_violation SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL', [id]),
    );
    if (res.rowCount === 0) throw new ApiError(404, 'NOT_FOUND', 'Violation not found');
    return { data: { id, deleted: true } };
  });

  // ---- Reports ------------------------------------------------------------
  app.get('/v1/reports/fuel', { preHandler: [auth, requirePermission('report.operational')] }, async (req) => {
    const q = parse(dateRange, req.query);
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const totals = (
        await c.query(
          `SELECT count(*)::int AS fills, coalesce(sum(liters),0) AS liters, coalesce(sum(cost_amount),0) AS cost
           FROM fuel_log
           WHERE deleted_at IS NULL AND filled_at >= $1::date AND filled_at < ($2::date + 1)`,
          [q.from, q.to],
        )
      ).rows[0];
      const perVehicle = (
        await c.query(
          `SELECT fl.vehicle_id, v.plate_no, count(*)::int AS fills,
                  sum(fl.liters) AS liters, sum(fl.cost_amount) AS cost,
                  max(fl.odometer_km) - min(fl.odometer_km) AS km,
                  CASE WHEN sum(fl.liters) > 0 AND max(fl.odometer_km) > min(fl.odometer_km)
                       THEN round((max(fl.odometer_km) - min(fl.odometer_km)) / sum(fl.liters), 2)
                  END AS km_per_liter
           FROM fuel_log fl JOIN vehicle v ON v.id = fl.vehicle_id
           WHERE fl.deleted_at IS NULL AND fl.filled_at >= $1::date AND fl.filled_at < ($2::date + 1)
           GROUP BY fl.vehicle_id, v.plate_no ORDER BY cost DESC`,
          [q.from, q.to],
        )
      ).rows;
      return { data: { totals, perVehicle } };
    });
  });

  app.get('/v1/reports/violations', { preHandler: [auth, requirePermission('report.operational')] }, async (req) => {
    const q = parse(dateRange, req.query);
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const totals = (
        await c.query(
          `SELECT count(*)::int AS violations,
                  count(*) FILTER (WHERE status='pending')::int AS pending,
                  coalesce(sum(amount),0) AS total_amount,
                  coalesce(sum(amount) FILTER (WHERE status IN ('pending','disputed')),0) AS unpaid_amount
           FROM traffic_violation
           WHERE deleted_at IS NULL AND occurred_at >= $1::date AND occurred_at < ($2::date + 1)`,
          [q.from, q.to],
        )
      ).rows[0];
      const byType = (
        await c.query(
          `SELECT violation_type, count(*)::int AS violations, sum(amount) AS amount
           FROM traffic_violation
           WHERE deleted_at IS NULL AND occurred_at >= $1::date AND occurred_at < ($2::date + 1)
           GROUP BY violation_type ORDER BY violations DESC`,
          [q.from, q.to],
        )
      ).rows;
      const perDriver = (
        await c.query(
          `SELECT tv.driver_id, d.full_name, count(*)::int AS violations, sum(tv.amount) AS amount
           FROM traffic_violation tv JOIN driver d ON d.id = tv.driver_id
           WHERE tv.deleted_at IS NULL AND tv.occurred_at >= $1::date AND tv.occurred_at < ($2::date + 1)
           GROUP BY tv.driver_id, d.full_name ORDER BY violations DESC LIMIT 50`,
          [q.from, q.to],
        )
      ).rows;
      return { data: { totals, byType, perDriver } };
    });
  });
}
