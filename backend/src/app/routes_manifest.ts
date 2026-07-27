import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, authenticate, getPrincipal, requirePermission } from './middleware/context';
import { parse } from './validate';
import { effectiveWaitSeconds, manifestCounts, commuteMessages, type PassengerStatus } from '../domain/commute/manifest';
import { enqueuePush } from './push_outbox';
import { joinWaitlist, lockTrip, promoteWaitlist, syncSeatsTaken, tripSeats } from './waitlist';
import type { Deps } from './routes';

const uuid = z.object({ id: z.string().uuid() });

/**
 * Daily-commute manifest (docs/etms/17). No seat reservation: each trip has a
 * passenger MANIFEST with attendance statuses. The driver marks a stop "Arrived"
 * (or GPS/geofence does), which starts an admin-configured waiting countdown;
 * boarding is recorded per passenger; on departure the still-awaited passengers
 * are auto-marked No-Show. Employees can flag "I'm on the way". RLS-scoped.
 */
export async function registerManifestRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  const auth = authenticate(config.jwtSecret);
  const requireDb = () => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    return db;
  };

  // ---- Waiting-timer policy (admin-configurable per tenant) ---------------
  app.get('/v1/transport-policy', { preHandler: [auth, requirePermission('tenant.read')] }, async (req) => {
    const p = getPrincipal(req);
    const row = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query('SELECT wait_seconds, notify_before_min, allow_driver_skip FROM tenant_transport_policy WHERE tenant_id=app_current_tenant()'),
    );
    return { data: row.rows[0] ?? { wait_seconds: 120, notify_before_min: [10, 3], allow_driver_skip: true } };
  });

  app.put('/v1/transport-policy', { preHandler: [auth, requirePermission('tenant.manage')] }, async (req) => {
    const b = parse(
      z.object({
        wait_seconds: z.number().int().min(0).max(3600),
        notify_before_min: z.array(z.number().int().min(0).max(120)).max(6).optional(),
        allow_driver_skip: z.boolean().optional(),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    const row = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `INSERT INTO tenant_transport_policy(tenant_id, wait_seconds, notify_before_min, allow_driver_skip)
         VALUES (app_current_tenant(),$1,coalesce($2::int[],'{10,3}'::int[]),coalesce($3::boolean,true))
         ON CONFLICT (tenant_id) DO UPDATE
           SET wait_seconds=EXCLUDED.wait_seconds,
               notify_before_min=coalesce($2::int[], tenant_transport_policy.notify_before_min),
               allow_driver_skip=coalesce($3::boolean, tenant_transport_policy.allow_driver_skip)
         RETURNING wait_seconds, notify_before_min, allow_driver_skip`,
        [b.wait_seconds, b.notify_before_min ?? null, b.allow_driver_skip ?? null],
      ),
    );
    return { data: row.rows[0] };
  });

  // ---- Define a stop on a trip --------------------------------------------
  app.post('/v1/trips/:id/stops', { preHandler: [auth, requirePermission('trip.dispatch')] }, async (req, reply) => {
    const { id } = parse(uuid, req.params);
    const b = parse(z.object({ name: z.string().max(160), seq: z.number().int().min(0).optional(), route_stop_id: z.string().uuid().optional() }), req.body);
    const p = getPrincipal(req);
    const row = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `INSERT INTO trip_stop(tenant_id, trip_id, name, seq, route_stop_id)
         VALUES (app_current_tenant(),$1,$2,coalesce($3,(SELECT coalesce(max(seq)+1,0) FROM trip_stop WHERE trip_id=$1)),$4)
         RETURNING *`,
        [id, b.name, b.seq ?? null, b.route_stop_id ?? null],
      ),
    );
    reply.code(201);
    return { data: row.rows[0] };
  });

  // ---- Add a passenger to the manifest ------------------------------------
  // Capacity guard: the bus only holds what trip.capacity (or the assigned
  // vehicle) says. When it is full the employee joins the trip's WAITING LIST
  // (202) instead of being rejected, and is promoted automatically as soon as a
  // seat frees. Send `waitlist: false` to get the plain 409 instead.
  app.post('/v1/trips/:id/passengers', { preHandler: [auth, requirePermission('manifest.manage')] }, async (req, reply) => {
    const { id } = parse(uuid, req.params);
    const b = parse(
      z.object({
        employee_id: z.string().uuid(),
        trip_stop_id: z.string().uuid().optional(),
        waitlist: z.boolean().default(true),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    const result = await requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const emp = (await c.query('SELECT id FROM employee WHERE id=$1 AND deleted_at IS NULL', [b.employee_id])).rows[0];
      if (!emp) throw new ApiError(422, 'VALIDATION_ERROR', 'Employee not found');
      // Serializes the check-then-insert against a concurrent add.
      if (!(await lockTrip(c, id))) throw new ApiError(404, 'NOT_FOUND', 'Trip not found');

      const seats = await tripSeats(c, id);
      if (seats.remaining !== null && seats.remaining <= 0) {
        const onManifest = (
          await c.query('SELECT 1 FROM trip_passenger WHERE trip_id=$1 AND employee_id=$2', [id, b.employee_id])
        ).rowCount;
        if (onManifest) throw new ApiError(409, 'CONFLICT', 'Employee already on this manifest');
        if (!b.waitlist) throw new ApiError(409, 'CONFLICT', 'The trip is full');
        const entry = await joinWaitlist(c, {
          tripId: id,
          employeeId: b.employee_id,
          tripStopId: b.trip_stop_id ?? null,
          createdBy: p.userId,
        });
        return { waitlisted: true as const, entry, seats };
      }

      const r = await c.query(
        `INSERT INTO trip_passenger(tenant_id, trip_id, trip_stop_id, employee_id, updated_by)
         VALUES (app_current_tenant(),$1,$2,$3,$4)
         ON CONFLICT (trip_id, employee_id) DO NOTHING RETURNING *`,
        [id, b.trip_stop_id ?? null, b.employee_id, p.userId],
      );
      if (r.rowCount === 0) throw new ApiError(409, 'CONFLICT', 'Employee already on this manifest');
      await syncSeatsTaken(c, id);
      return { waitlisted: false as const, passenger: r.rows[0], seats: await tripSeats(c, id) };
    });

    if (result.waitlisted) {
      reply.code(202);
      return {
        data: result.entry,
        waitlisted: true,
        position: result.entry.position,
        seats: result.seats,
        message: {
          ar: commuteMessages.waitlisted(result.entry.position, 'ar'),
          en: commuteMessages.waitlisted(result.entry.position, 'en'),
        },
      };
    }
    reply.code(201);
    return { data: result.passenger, waitlisted: false, seats: result.seats };
  });

  // ---- Trip waiting list ---------------------------------------------------
  app.get('/v1/trips/:id/waitlist', { preHandler: [auth, requirePermission('waitlist.read')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const q = parse(z.object({ status: z.enum(['waiting', 'promoted', 'cancelled', 'expired']).optional() }), req.query);
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const rows = (
        await c.query(
          `SELECT w.id, w.employee_id, e.full_name, w.trip_stop_id, w.position, w.status,
                  w.source, w.ride_request_id, w.trip_passenger_id, w.promoted_at, w.note, w.created_at
           FROM trip_waitlist w JOIN employee e ON e.id = w.employee_id
           WHERE w.trip_id=$1 AND ($2::text IS NULL OR w.status=$2)
           ORDER BY w.status='waiting' DESC, w.position`,
          [id, q.status ?? null],
        )
      ).rows;
      return { data: rows, seats: await tripSeats(c, id) };
    });
  });

  // Ops can queue someone explicitly (e.g. a late request for a known-full bus).
  app.post('/v1/trips/:id/waitlist', { preHandler: [auth, requirePermission('waitlist.manage')] }, async (req, reply) => {
    const { id } = parse(uuid, req.params);
    const b = parse(
      z.object({
        employee_id: z.string().uuid(),
        trip_stop_id: z.string().uuid().optional(),
        note: z.string().max(300).optional(),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    const out = await requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const emp = (await c.query('SELECT id FROM employee WHERE id=$1 AND deleted_at IS NULL', [b.employee_id])).rows[0];
      if (!emp) throw new ApiError(422, 'VALIDATION_ERROR', 'Employee not found');
      if (!(await lockTrip(c, id))) throw new ApiError(404, 'NOT_FOUND', 'Trip not found');
      const already = (
        await c.query(
          `SELECT 1 FROM trip_passenger WHERE trip_id=$1 AND employee_id=$2
             AND status IN ('expected','on_the_way','boarded')`,
          [id, b.employee_id],
        )
      ).rowCount;
      if (already) throw new ApiError(409, 'CONFLICT', 'Employee is already on this manifest');
      const entry = await joinWaitlist(c, {
        tripId: id,
        employeeId: b.employee_id,
        tripStopId: b.trip_stop_id ?? null,
        note: b.note ?? null,
        createdBy: p.userId,
      });
      // A seat may be free right now — promote immediately rather than waiting.
      const promoted = await promoteWaitlist(c, id, p.userId);
      return { entry, promoted, seats: await tripSeats(c, id) };
    });
    reply.code(out.promoted.some((x) => x.waitlistId === out.entry.id) ? 201 : 202);
    return { data: out.entry, promoted: out.promoted, seats: out.seats };
  });

  // Leave / withdraw a queue entry (a cancelled entry never gets promoted).
  app.delete('/v1/trips/:id/waitlist/:wid', { preHandler: [auth, requirePermission('waitlist.manage')] }, async (req) => {
    const params = parse(z.object({ id: z.string().uuid(), wid: z.string().uuid() }), req.params);
    const p = getPrincipal(req);
    const res = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        "UPDATE trip_waitlist SET status='cancelled' WHERE id=$1 AND trip_id=$2 AND status='waiting' RETURNING *",
        [params.wid, params.id],
      ),
    );
    if (res.rowCount === 0) throw new ApiError(409, 'CONFLICT', 'Waiting-list entry not found or already resolved');
    return { data: res.rows[0] };
  });

  // Manual kick of the promotion pass (it also runs on every seat-freeing event).
  app.post('/v1/trips/:id/waitlist/promote', { preHandler: [auth, requirePermission('waitlist.manage')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const promoted = await promoteWaitlist(c, id, p.userId);
      return { data: promoted, promoted: promoted.length, seats: await tripSeats(c, id) };
    });
  });

  // ---- Employee: my own ride history (daily commute) ----------------------
  app.get('/v1/my/rides', { preHandler: [auth, requirePermission('trip.attend')] }, async (req) => {
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const emp = (await c.query('SELECT id FROM employee WHERE user_id=$1 AND deleted_at IS NULL', [p.userId])).rows[0];
      if (!emp) throw new ApiError(422, 'VALIDATION_ERROR', 'No employee is linked to your account');
      const rows = (
        await c.query(
          `SELECT tp.trip_id, t.service_date, t.direction, tp.status, tp.boarded_at
           FROM trip_passenger tp JOIN trip t ON t.id = tp.trip_id
           WHERE tp.employee_id=$1 ORDER BY t.service_date DESC, tp.created_at DESC LIMIT 60`,
          [emp.id],
        )
      ).rows;
      return { data: rows };
    });
  });

  // ---- Read the manifest (driver/ops screen data) -------------------------
  app.get('/v1/trips/:id/manifest', { preHandler: [auth, requirePermission('trip.read')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const passengers = (
        await c.query(
          `SELECT tp.id, tp.employee_id, e.full_name, tp.status, tp.trip_stop_id, tp.on_the_way_at, tp.boarded_at
           FROM trip_passenger tp JOIN employee e ON e.id=tp.employee_id
           WHERE tp.trip_id=$1 ORDER BY e.full_name`,
          [id],
        )
      ).rows;
      const stops = (await c.query('SELECT * FROM trip_stop WHERE trip_id=$1 ORDER BY seq', [id])).rows;
      const current = stops.find((s) => s.status === 'arrived') ?? stops.find((s) => s.status === 'pending') ?? null;
      const counts = manifestCounts(passengers.map((x) => x.status as PassengerStatus));
      const countdownSeconds = current?.departs_at
        ? Math.max(0, Math.round((new Date(current.departs_at).getTime() - Date.now()) / 1000))
        : null;
      // Seat accounting for the driver/ops screen: capacity, taken, how many are
      // still free (null = the trip has no known capacity) and who is queued.
      const seats = await tripSeats(c, id);
      return {
        data: {
          passengers,
          stops,
          currentStop: current,
          counts,
          countdownSeconds,
          capacity: seats.capacity,
          occupied: seats.occupied,
          remaining_seats: seats.remaining,
          waiting: seats.waiting,
        },
      };
    });
  });

  // ---- Driver: "Arrived" at a stop → starts the waiting countdown ---------
  app.post('/v1/trips/:id/stops/:stopId/arrive', { preHandler: [auth, requirePermission('trip.operate')] }, async (req) => {
    const params = parse(z.object({ id: z.string().uuid(), stopId: z.string().uuid() }), req.params);
    const b = parse(z.object({ by: z.enum(['gps', 'driver']).default('driver') }), req.body ?? {});
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const stop = (await c.query('SELECT * FROM trip_stop WHERE id=$1 AND trip_id=$2', [params.stopId, params.id])).rows[0];
      if (!stop) throw new ApiError(404, 'NOT_FOUND', 'Stop not found');
      if (stop.status === 'departed') throw new ApiError(409, 'CONFLICT', 'Stop already departed');

      // Resolve the waiting timer: route override > tenant policy > default.
      const routeWait = (await c.query('SELECT r.wait_seconds FROM trip t JOIN route r ON r.id=t.route_id WHERE t.id=$1', [params.id])).rows[0]?.wait_seconds ?? null;
      const policyWait = (await c.query('SELECT wait_seconds FROM tenant_transport_policy WHERE tenant_id=app_current_tenant()')).rows[0]?.wait_seconds ?? null;
      const wait = effectiveWaitSeconds(routeWait, policyWait);

      const updated = (
        await c.query(
          `UPDATE trip_stop
           SET status='arrived', arrived_by=$2, arrived_at=now(), wait_seconds=$3::int,
               departs_at = now() + ($3::int * interval '1 second')
           WHERE id=$1 RETURNING *`,
          [params.stopId, b.by, wait],
        )
      ).rows[0];

      // Who to notify at this stop (still awaited) — and enqueue their push.
      const notify = (
        await c.query(
          `SELECT tp.employee_id, e.full_name, e.user_id FROM trip_passenger tp JOIN employee e ON e.id=tp.employee_id
           WHERE tp.trip_id=$1 AND (tp.trip_stop_id=$2 OR tp.trip_stop_id IS NULL) AND tp.status IN ('expected','on_the_way')`,
          [params.id, params.stopId],
        )
      ).rows;
      const queued = await enqueuePush(c, notify, 'bus_arrived', params.id, {
        ar: commuteMessages.arrival('ar'),
        en: commuteMessages.arrival('en'),
      });
      return {
        data: updated,
        waitSeconds: wait,
        notify: notify.map((n) => n.employee_id),
        notificationsQueued: queued,
        message: { ar: commuteMessages.arrival('ar'), en: commuteMessages.arrival('en') },
      };
    });
  });

  // ---- Driver: board a passenger ------------------------------------------
  app.post('/v1/trips/:id/passengers/:pid/board', { preHandler: [auth, requirePermission('trip.operate')] }, async (req) => {
    const params = parse(z.object({ id: z.string().uuid(), pid: z.string().uuid() }), req.params);
    const p = getPrincipal(req);
    const res = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `UPDATE trip_passenger SET status='boarded', boarded_at=now(), updated_by=$3
         WHERE id=$1 AND trip_id=$2 AND status IN ('expected','on_the_way') RETURNING *`,
        [params.pid, params.id, p.userId],
      ),
    );
    if (res.rowCount === 0) throw new ApiError(409, 'CONFLICT', 'Passenger not found or not boardable');
    return { data: res.rows[0] };
  });

  // ---- Employee: "I'm on the way" -----------------------------------------
  app.post('/v1/trips/:id/on-the-way', { preHandler: [auth, requirePermission('trip.attend')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const emp = (await c.query('SELECT id, full_name FROM employee WHERE user_id=$1 AND deleted_at IS NULL', [p.userId])).rows[0];
      if (!emp) throw new ApiError(422, 'VALIDATION_ERROR', 'No employee is linked to your account');
      const res = await c.query(
        `UPDATE trip_passenger SET status='on_the_way', on_the_way_at=now()
         WHERE trip_id=$1 AND employee_id=$2 AND status='expected' RETURNING *`,
        [id, emp.id],
      );
      if (res.rowCount === 0) throw new ApiError(409, 'CONFLICT', 'You are not expected on this trip (or already boarded/closed)');
      // The countdown is NOT paused — the bus still leaves when the timer ends.
      return {
        data: res.rows[0],
        driverMessage: { ar: commuteMessages.onTheWay(emp.full_name, 'ar'), en: commuteMessages.onTheWay(emp.full_name, 'en') },
        note: 'countdown_not_paused',
      };
    });
  });

  // ---- Driver: depart a stop → auto No-Show the still-awaited passengers ---
  app.post('/v1/trips/:id/stops/:stopId/depart', { preHandler: [auth, requirePermission('trip.operate')] }, async (req) => {
    const params = parse(z.object({ id: z.string().uuid(), stopId: z.string().uuid() }), req.params);
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const stop = (await c.query('SELECT * FROM trip_stop WHERE id=$1 AND trip_id=$2', [params.stopId, params.id])).rows[0];
      if (!stop) throw new ApiError(404, 'NOT_FOUND', 'Stop not found');
      if (stop.status === 'departed') throw new ApiError(409, 'CONFLICT', 'Stop already departed');

      const noShow = (
        await c.query(
          `UPDATE trip_passenger tp SET status='no_show', updated_by=$3
           FROM employee e
           WHERE tp.employee_id=e.id AND tp.trip_id=$1 AND (tp.trip_stop_id=$2 OR tp.trip_stop_id IS NULL)
             AND tp.status IN ('expected','on_the_way')
           RETURNING tp.employee_id, e.user_id`,
          [params.id, params.stopId, p.userId],
        )
      ).rows;
      await c.query("UPDATE trip_stop SET status='departed', departed_at=now() WHERE id=$1", [params.stopId]);
      const queued = await enqueuePush(c, noShow, 'no_show', params.id, {
        ar: commuteMessages.noShow('ar'),
        en: commuteMessages.noShow('en'),
      });
      // Every no-show gives a seat back. Anyone still queued for a LATER stop on
      // this trip can now be promoted onto the manifest.
      await syncSeatsTaken(c, params.id);
      const promoted = await promoteWaitlist(c, params.id, p.userId);
      return {
        data: { stopId: params.stopId, status: 'departed', noShow: noShow.map((n) => n.employee_id) },
        notificationsQueued: queued,
        promotedFromWaitlist: promoted,
        message: { ar: commuteMessages.noShow('ar'), en: commuteMessages.noShow('en') },
      };
    });
  });

  // ---- Manifest status changes: excuse / on-leave / remove (ops) ----------
  app.post('/v1/trips/:id/passengers/:pid/status', { preHandler: [auth, requirePermission('manifest.manage')] }, async (req) => {
    const params = parse(z.object({ id: z.string().uuid(), pid: z.string().uuid() }), req.params);
    const b = parse(z.object({ status: z.enum(['excused', 'on_leave', 'removed', 'expected']), note: z.string().max(300).optional() }), req.body);
    const p = getPrincipal(req);
    const out = await requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const res = await c.query(
        `UPDATE trip_passenger SET status=$3, note=coalesce($4,note), updated_by=$5
         WHERE id=$1 AND trip_id=$2 AND status <> 'boarded' RETURNING *`,
        [params.pid, params.id, b.status, b.note ?? null, p.userId],
      );
      if (res.rowCount === 0) throw new ApiError(409, 'CONFLICT', 'Passenger not found or already boarded');
      await syncSeatsTaken(c, params.id);
      // Excusing / removing a passenger frees their place — hand it to whoever
      // has been waiting longest.
      const promoted =
        b.status === 'expected' ? [] : await promoteWaitlist(c, params.id, p.userId);
      return { row: res.rows[0], promoted };
    });
    return { data: out.row, promotedFromWaitlist: out.promoted };
  });
}
