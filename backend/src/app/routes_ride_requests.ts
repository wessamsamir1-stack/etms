import { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ApiError, authenticate, getPrincipal, requirePermission } from './middleware/context';
import { requireFeature } from './feature_flags';
import { FieldCrypto } from '../util/field_crypto';
import { parse } from './validate';
import { joinWaitlist, lockTrip, promoteWaitlist, syncSeatsTaken, tripSeats } from './waitlist';
import type { Deps } from './routes';

const uuid = z.object({ id: z.string().uuid() });
const hhmm = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional();
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

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
      const row = (
        await c.query(
          `SELECT mode, label, address, valid_until,
                  ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
           FROM employee_pickup WHERE employee_id=$1`,
          [emp.id],
        )
      ).rows[0];
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
        // Pinning the pickup on the map is what lets a driver's zone match it.
        lat: lat.optional(),
        lng: lng.optional(),
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
          `INSERT INTO employee_pickup(tenant_id, employee_id, mode, label, address, location, valid_until)
           VALUES (app_current_tenant(),$1,$2,$3,$4,
                   CASE WHEN $5::float8 IS NULL OR $6::float8 IS NULL THEN NULL
                        ELSE ST_SetSRID(ST_MakePoint($6,$5),4326)::geography END,
                   $7)
           ON CONFLICT (tenant_id, employee_id) DO UPDATE
             SET mode=EXCLUDED.mode, label=EXCLUDED.label, address=EXCLUDED.address,
                 location=coalesce(EXCLUDED.location, employee_pickup.location),
                 valid_until=EXCLUDED.valid_until
           RETURNING mode, label, address, valid_until,
                     ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng`,
          [emp.id, b.mode, b.label ?? null, fc.encrypt(b.address ?? null), b.lat ?? null, b.lng ?? null, b.valid_until ?? null],
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
            lat: lat.optional(),
            lng: lng.optional(),
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
      // The lat/lng, when known, is what the driver's zone is matched against.
      let mode: string, label: string | null, address: string | null;
      let plat: number | null = null, plng: number | null = null;
      if ('useSaved' in b.pickup) {
        const saved = (
          await c.query(
            `SELECT mode, label, address, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
             FROM employee_pickup WHERE employee_id=$1`,
            [emp.id],
          )
        ).rows[0];
        if (!saved) throw new ApiError(422, 'VALIDATION_ERROR', 'No saved pickup — set one first or send pickup details');
        mode = saved.mode; label = saved.label; address = fc.decrypt(saved.address);
        plat = saved.lat; plng = saved.lng;
      } else {
        mode = b.pickup.mode; label = b.pickup.label ?? null; address = b.pickup.address ?? null;
        plat = b.pickup.lat ?? null; plng = b.pickup.lng ?? null;
        if (mode === 'fixed' || mode === 'temporary') {
          await c.query(
            `INSERT INTO employee_pickup(tenant_id, employee_id, mode, label, address, location, valid_until)
             VALUES (app_current_tenant(),$1,$2,$3,$4,
                     CASE WHEN $5::float8 IS NULL OR $6::float8 IS NULL THEN NULL
                          ELSE ST_SetSRID(ST_MakePoint($6,$5),4326)::geography END,
                     $7)
             ON CONFLICT (tenant_id, employee_id) DO UPDATE
               SET mode=EXCLUDED.mode, label=EXCLUDED.label, address=EXCLUDED.address,
                   location=coalesce(EXCLUDED.location, employee_pickup.location),
                   valid_until=EXCLUDED.valid_until`,
            [emp.id, mode, label, fc.encrypt(address), plat, plng, b.pickup.valid_until ?? null],
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
              pickup_mode, pickup_label, pickup_address, pickup_location, target_driver_id, created_by)
           VALUES (app_current_tenant(),$1,$2,$3,$4,$5,$6,$7,
                   CASE WHEN $8::float8 IS NULL OR $9::float8 IS NULL THEN NULL
                        ELSE ST_SetSRID(ST_MakePoint($9,$8),4326)::geography END,
                   $10,$11)
           RETURNING *`,
          [emp.id, b.direction, b.service_date, b.requested_time ?? null, mode, label, fc.encrypt(address),
           plat, plng, b.target_driver_id ?? null, p.userId],
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
      // The raw geography is WKB — hand the clients plain coordinates instead.
      delete rr.pickup_location;
      rr.pickup_lat = plat;
      rr.pickup_lng = plng;
      reply.code(201);
      return { data: rr, mode: b.target_driver_id ? 'targeted' : 'broadcast', notifiedDrivers: drivers.length };
    });
  });

  // ---- List ride requests (role-aware) ------------------------------------
  // For a driver each row carries `matches_route`: is the pickup inside one of
  // the zones on the driver's APPROVED plan for that day (ST_Covers on the zone
  // boundary, db V0032)? true / false, or null when there is no approved plan
  // for the date and there is therefore no route to compare against.
  // `matchMyRoute=true` keeps only the matching ones, so a driver can work a
  // list of requests that are all genuinely on their way.
  app.get('/v1/ride-requests', { preHandler: [auth, requirePermission('ride_request.read'), feat] }, async (req) => {
    const q = parse(
      z.object({
        date: z.string().optional(),
        status: z.string().optional(),
        mine: z.enum(['driver', 'rider']).optional(),
        matchMyRoute: z.enum(['true', 'false']).optional(),
      }),
      req.query,
    );
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const base = `SELECT rr.id, rr.direction, rr.service_date, rr.requested_time, rr.pickup_mode,
                           rr.pickup_label, rr.pickup_address, rr.status, rr.target_driver_id,
                           rr.claimed_by_driver_id, rr.trip_id, e.full_name AS employee_name,
                           ST_Y(rr.pickup_location::geometry) AS pickup_lat,
                           ST_X(rr.pickup_location::geometry) AS pickup_lng
                    FROM ride_request rr JOIN employee e ON e.id = rr.employee_id`;
      let rows;
      if (q.mine === 'driver') {
        const drv = await myDriver(c, p.userId);
        if (!drv) throw new ApiError(422, 'VALIDATION_ERROR', 'No driver linked to your account');
        rows = await c.query(
          `SELECT s.*, app_ride_request_route_match(s.id, $1, s.service_date) AS matches_route
           FROM (${base}
             WHERE rr.status='open' AND EXISTS (
               SELECT 1 FROM ride_request_offer o WHERE o.request_id=rr.id AND o.driver_id=$1)
               AND ($2::date IS NULL OR rr.service_date=$2)
               AND (NOT $3::boolean OR app_ride_request_in_driver_route(rr.id, $1))
             ORDER BY rr.created_at DESC LIMIT 200) s`,
          [drv.id, q.date ?? null, q.matchMyRoute === 'true'],
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
      // seat). Capacity — the trip override or the assigned vehicle — is checked
      // against the active manifest; when the bus is full the rider joins the
      // trip's WAITING LIST and is promoted as soon as a seat frees.
      await lockTrip(c, trip.id);
      const seats = await tripSeats(c, trip.id);
      if (seats.remaining !== null && seats.remaining <= 0) {
        const entry = await joinWaitlist(c, {
          tripId: trip.id,
          employeeId: claimed.employee_id,
          source: 'ride_request',
          rideRequestId: id,
          createdBy: p.userId,
        });
        await c.query('UPDATE ride_request SET trip_id=$2 WHERE id=$1', [id, trip.id]);
        return {
          data: {
            id, status: 'assigned', driverId: drv.id, tripId: trip.id,
            onManifest: seats.occupied, capacity: seats.capacity,
          },
          waitlisted: true,
          position: entry.position,
        };
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
      const onManifest = await syncSeatsTaken(c, trip.id);

      await c.query('UPDATE ride_request SET trip_id=$2, trip_passenger_id=$3 WHERE id=$1', [id, trip.id, pax?.id ?? null]);
      return {
        data: { id, status: 'assigned', driverId: drv.id, tripId: trip.id, onManifest, capacity: seats.capacity },
        waitlisted: false,
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
      // Remove the rider from the manifest if they had been added by a claim,
      // and hand the freed seat to the head of the trip's waiting list.
      let promoted: Awaited<ReturnType<typeof promoteWaitlist>> = [];
      if (rr.trip_passenger_id) {
        await c.query("UPDATE trip_passenger SET status='removed' WHERE id=$1", [rr.trip_passenger_id]);
        if (rr.trip_id) {
          await syncSeatsTaken(c, rr.trip_id);
          promoted = await promoteWaitlist(c, rr.trip_id, p.userId);
        }
      }
      // A cancelled request must not keep a place in the queue either.
      await c.query(
        "UPDATE trip_waitlist SET status='cancelled' WHERE ride_request_id=$1 AND status='waiting'",
        [id],
      );
      await c.query("UPDATE ride_request SET status='cancelled' WHERE id=$1", [id]);
      return { data: { id, status: 'cancelled' }, promotedFromWaitlist: promoted };
    });
  });
}
