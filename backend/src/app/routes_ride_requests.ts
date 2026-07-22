import { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ApiError, authenticate, getPrincipal, requirePermission } from './middleware/context';
import { requireFeature } from './feature_flags';
import { FieldCrypto } from '../util/field_crypto';
import { parse } from './validate';
import type { Deps } from './routes';

const uuid = z.object({ id: z.string().uuid() });
const hhmm = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional();

/**
 * Ride requests (docs/etms/16). A staff member sets a pickup — fixed / temporary /
 * per-request — and leaves a request either for a specific driver or broadcast to
 * all available drivers. The first driver to claim it gets the rider added to
 * that trip's MANIFEST (daily-commute model — not a reserved seat). All
 * RLS-tenant-scoped; claiming is atomic (first wins).
 */
export async function registerRideRequestRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  // Encrypt the employee's home/pickup address at rest (sensitive PII). Reads
  // decrypt transparently; legacy plaintext rows pass through unchanged.
  const fc = deps.fieldCrypto ?? new FieldCrypto([]);
  const auth = authenticate(config.jwtSecret);
  // Gate the whole ride-request surface on the tenant's 'ride_requests' feature.
  const feat = requireFeature(db, 'ride_requests');
  const requireDb = () => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    return db;
  };

  // Resolve the employee linked to the caller (riders act for themselves).
  async function myEmployee(c: PoolClient, userId: string): Promise<{ id: string } | undefined> {
    return (await c.query('SELECT id FROM employee WHERE user_id=$1 AND deleted_at IS NULL', [userId])).rows[0];
  }
  async function myDriver(c: PoolClient, userId: string): Promise<{ id: string } | undefined> {
    return (await c.query('SELECT id FROM driver WHERE user_id=$1 AND deleted_at IS NULL', [userId])).rows[0];
  }

  // ---- Saved default pickup (fixed / temporary) ---------------------------
  app.get('/v1/my-pickup', { preHandler: [auth, requirePermission('ride_request.create'), feat] }, async (req) => {
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const emp = await myEmployee(c, p.userId);
      if (!emp) throw new ApiError(422, 'VALIDATION_ERROR', 'No employee is linked to your account');
      const row = (await c.query('SELECT mode, label, address, valid_until FROM employee_pickup WHERE employee_id=$1', [emp.id])).rows[0];
      if (row) row.address = fc.decrypt(row.address);
      return { data: row ?? null };
    });
  });

  app.put('/v1/my-pickup', { preHandler: [auth, requirePermission('ride_request.create'), feat] }, async (req) => {
    const b = parse(
      z.object({
        mode: z.enum(['fixed', 'temporary']),
        label: z.string().max(160).optional(),
        address: z.string().max(300).optional(),
        valid_until: z.string().optional(),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const emp = await myEmployee(c, p.userId);
      if (!emp) throw new ApiError(422, 'VALIDATION_ERROR', 'No employee is linked to your account');
      const row = (
        await c.query(
          `INSERT INTO employee_pickup(tenant_id, employee_id, mode, label, address, valid_until)
           VALUES (app_current_tenant(),$1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id, employee_id) DO UPDATE
             SET mode=EXCLUDED.mode, label=EXCLUDED.label, address=EXCLUDED.address, valid_until=EXCLUDED.valid_until
           RETURNING mode, label, address, valid_until`,
          [emp.id, b.mode, b.label ?? null, fc.encrypt(b.address ?? null), b.valid_until ?? null],
        )
      ).rows[0];
      if (row) row.address = fc.decrypt(row.address);
      return { data: row };
    });
  });

  // ---- Create a ride request ----------------------------------------------
  app.post('/v1/ride-requests', { preHandler: [auth, requirePermission('ride_request.create'), feat] }, async (req, reply) => {
    const b = parse(
      z.object({
        direction: z.enum(['inbound', 'outbound']),
        service_date: z.string(),
        requested_time: hhmm,
        target_driver_id: z.string().uuid().nullish(),
        pickup: z.union([
          z.object({ useSaved: z.literal(true) }),
          z.object({
            mode: z.enum(['fixed', 'temporary', 'per_request']),
            label: z.string().max(160).optional(),
            address: z.string().max(300).optional(),
            valid_until: z.string().optional(),
          }),
        ]),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const emp = await myEmployee(c, p.userId);
      if (!emp) throw new ApiError(422, 'VALIDATION_ERROR', 'No employee is linked to your account');

      // Resolve the pickup: saved default, or provided (fixed/temporary get saved).
      let mode: string, label: string | null, address: string | null;
      if ('useSaved' in b.pickup) {
        const saved = (await c.query('SELECT mode, label, address FROM employee_pickup WHERE employee_id=$1', [emp.id])).rows[0];
        if (!saved) throw new ApiError(422, 'VALIDATION_ERROR', 'No saved pickup — set one first or send pickup details');
        mode = saved.mode; label = saved.label; address = fc.decrypt(saved.address);
      } else {
        mode = b.pickup.mode; label = b.pickup.label ?? null; address = b.pickup.address ?? null;
        if (mode === 'fixed' || mode === 'temporary') {
          await c.query(
            `INSERT INTO employee_pickup(tenant_id, employee_id, mode, label, address, valid_until)
             VALUES (app_current_tenant(),$1,$2,$3,$4,$5)
             ON CONFLICT (tenant_id, employee_id) DO UPDATE
               SET mode=EXCLUDED.mode, label=EXCLUDED.label, address=EXCLUDED.address, valid_until=EXCLUDED.valid_until`,
            [emp.id, mode, label, fc.encrypt(address), b.pickup.valid_until ?? null],
          );
        }
      }

      // Validate a targeted driver (verified) if given.
      if (b.target_driver_id) {
        const d = (await c.query("SELECT id FROM driver WHERE id=$1 AND verification_status='verified' AND deleted_at IS NULL", [b.target_driver_id])).rows[0];
        if (!d) throw new ApiError(422, 'VALIDATION_ERROR', 'Target driver not found or not verified');
      }

      const rr = (
        await c.query(
          `INSERT INTO ride_request
             (tenant_id, employee_id, direction, service_date, requested_time,
              pickup_mode, pickup_label, pickup_address, target_driver_id, created_by)
           VALUES (app_current_tenant(),$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [emp.id, b.direction, b.service_date, b.requested_time ?? null, mode, label, fc.encrypt(address), b.target_driver_id ?? null, p.userId],
        )
      ).rows[0];

      // Offer it: to the one target, or broadcast to all available+verified drivers.
      const drivers = (
        b.target_driver_id
          ? await c.query('SELECT id FROM driver WHERE id=$1', [b.target_driver_id])
          : await c.query("SELECT id FROM driver WHERE verification_status='verified' AND availability IN ('available','on_trip') AND deleted_at IS NULL")
      ).rows;
      for (const d of drivers) {
        await c.query(
          `INSERT INTO ride_request_offer(tenant_id, request_id, driver_id)
           VALUES (app_current_tenant(),$1,$2) ON CONFLICT (request_id, driver_id) DO NOTHING`,
          [rr.id, d.id],
        );
      }

      rr.pickup_address = fc.decrypt(rr.pickup_address);
      reply.code(201);
      return { data: rr, mode: b.target_driver_id ? 'targeted' : 'broadcast', notifiedDrivers: drivers.length };
    });
  });

  // ---- List ride requests (role-aware) ------------------------------------
  app.get('/v1/ride-requests', { preHandler: [auth, requirePermission('ride_request.read'), feat] }, async (req) => {
    const q = parse(z.object({ date: z.string().optional(), status: z.string().optional(), mine: z.enum(['driver', 'rider']).optional() }), req.query);
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const base = `SELECT rr.id, rr.direction, rr.service_date, rr.requested_time, rr.pickup_mode,
                           rr.pickup_label, rr.pickup_address, rr.status, rr.target_driver_id,
                           rr.claimed_by_driver_id, rr.trip_id, e.full_name AS employee_name
                    FROM ride_request rr JOIN employee e ON e.id = rr.employee_id`;
      let rows;
      if (q.mine === 'driver') {
        const drv = await myDriver(c, p.userId);
        if (!drv) throw new ApiError(422, 'VALIDATION_ERROR', 'No driver linked to your account');
        rows = await c.query(
          `${base}
           WHERE rr.status='open' AND EXISTS (
             SELECT 1 FROM ride_request_offer o WHERE o.request_id=rr.id AND o.driver_id=$1)
             AND ($2::date IS NULL OR rr.service_date=$2)
           ORDER BY rr.created_at DESC LIMIT 200`,
          [drv.id, q.date ?? null],
        );
      } else if (q.mine === 'rider') {
        const emp = await myEmployee(c, p.userId);
        if (!emp) throw new ApiError(422, 'VALIDATION_ERROR', 'No employee linked to your account');
        rows = await c.query(`${base} WHERE rr.employee_id=$1 ORDER BY rr.created_at DESC LIMIT 200`, [emp.id]);
      } else {
        rows = await c.query(
          `${base} WHERE ($1::date IS NULL OR rr.service_date=$1) AND ($2::text IS NULL OR rr.status=$2)
           ORDER BY rr.created_at DESC LIMIT 200`,
          [q.date ?? null, q.status ?? null],
        );
      }
      for (const r of rows.rows) r.pickup_address = fc.decrypt(r.pickup_address);
      return { data: rows.rows };
    });
  });

  // ---- Driver claims → rider added to the driver's trip manifest ----------
  app.post('/v1/ride-requests/:id/claim', { preHandler: [auth, requirePermission('ride_request.claim'), feat] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const drv = await myDriver(c, p.userId);
      if (!drv) throw new ApiError(422, 'VALIDATION_ERROR', 'No driver is linked to your account');

      // Must have been offered this request (targeted or broadcast).
      const offered = (await c.query('SELECT 1 FROM ride_request_offer WHERE request_id=$1 AND driver_id=$2', [id, drv.id])).rows[0];
      if (!offered) throw new ApiError(403, 'FORBIDDEN', 'This request was not offered to you');

      // Atomic first-wins claim.
      const claimed = (
        await c.query(
          `UPDATE ride_request SET status='assigned', claimed_by_driver_id=$2, claimed_at=now()
           WHERE id=$1 AND status='open' RETURNING *`,
          [id, drv.id],
        )
      ).rows[0];
      if (!claimed) throw new ApiError(409, 'CONFLICT', 'Already taken or not open');

      // Find (or create) this driver's trip for the date + direction, then seat the rider.
      let trip = (
        await c.query(
          `SELECT t.* FROM trip t JOIN assignment a ON a.trip_id=t.id
           WHERE a.driver_id=$1 AND t.service_date=$2 AND t.direction=$3
             AND t.status NOT IN ('completed','cancelled') LIMIT 1`,
          [drv.id, claimed.service_date, claimed.direction],
        )
      ).rows[0];
      if (!trip) {
        trip = (
          await c.query(
            `INSERT INTO trip(tenant_id, service_date, direction, status, seats_taken)
             VALUES (app_current_tenant(),$1,$2,'assigned',0) RETURNING *`,
            [claimed.service_date, claimed.direction],
          )
        ).rows[0];
        await c.query(
          `INSERT INTO assignment(tenant_id, trip_id, driver_id, assigned_by)
           VALUES (app_current_tenant(),$1,$2,$3) ON CONFLICT (trip_id) DO NOTHING`,
          [trip.id, drv.id, p.userId],
        );
      }
      // Daily-commute model: add the rider to the trip MANIFEST (not a reserved
      // seat). Capacity, when set, is checked against the active manifest.
      const activeCount = async (): Promise<number> =>
        Number(
          (
            await c.query(
              `SELECT count(*)::int AS n FROM trip_passenger
               WHERE trip_id=$1 AND status IN ('expected','on_the_way','boarded')`,
              [trip.id],
            )
          ).rows[0].n,
        );
      if (trip.capacity != null && (await activeCount()) >= trip.capacity) {
        throw new ApiError(409, 'CONFLICT', 'The driver\'s trip is full');
      }

      const pax = (
        await c.query(
          `INSERT INTO trip_passenger(tenant_id, trip_id, employee_id, status)
           VALUES (app_current_tenant(),$1,$2,'expected')
           ON CONFLICT (trip_id, employee_id) DO NOTHING RETURNING id`,
          [trip.id, claimed.employee_id],
        )
      ).rows[0];
      // Keep the trip's quick occupancy counter coherent with the manifest.
      const onManifest = await activeCount();
      await c.query('UPDATE trip SET seats_taken=$2 WHERE id=$1', [trip.id, onManifest]);

      await c.query('UPDATE ride_request SET trip_id=$2, trip_passenger_id=$3 WHERE id=$1', [id, trip.id, pax?.id ?? null]);
      return {
        data: { id, status: 'assigned', driverId: drv.id, tripId: trip.id, onManifest, capacity: trip.capacity },
      };
    });
  });

  // ---- Cancel (owner while open, or manage_any) ---------------------------
  app.post('/v1/ride-requests/:id/cancel', { preHandler: [auth, requirePermission('ride_request.read'), feat] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const rr = (await c.query('SELECT * FROM ride_request WHERE id=$1', [id])).rows[0];
      if (!rr) throw new ApiError(404, 'NOT_FOUND', 'Request not found');
      const canManage = p.permissions.has('ride_request.manage_any');
      if (!canManage) {
        const emp = await myEmployee(c, p.userId);
        if (!emp || emp.id !== rr.employee_id) throw new ApiError(403, 'FORBIDDEN', 'Not your request');
        if (rr.status !== 'open') throw new ApiError(409, 'CONFLICT', `Request is ${rr.status}`);
      }
      // Remove the rider from the manifest if they had been added by a claim.
      if (rr.trip_passenger_id) {
        await c.query("UPDATE trip_passenger SET status='removed' WHERE id=$1", [rr.trip_passenger_id]);
        if (rr.trip_id) {
          await c.query(
            `UPDATE trip SET seats_taken = (
               SELECT count(*) FROM trip_passenger
               WHERE trip_id=$1 AND status IN ('expected','on_the_way','boarded'))
             WHERE id=$1`,
            [rr.trip_id],
          );
        }
      }
      await c.query("UPDATE ride_request SET status='cancelled' WHERE id=$1", [id]);
      return { data: { id, status: 'cancelled' } };
    });
  });
}
