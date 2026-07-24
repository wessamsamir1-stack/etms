import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError, authenticate, getPrincipal, requirePermission } from './middleware/context';
import { parse } from './validate';
import type { Deps } from './routes';

const uuid = z.object({ id: z.string().uuid() });

/**
 * Dispatch + trip lifecycle (docs/etms/05 §5–6) and the sensitive driver-verify
 * action (§O-16). Business rules are enforced server-side in one transaction so
 * they hold under concurrency; every query is RLS-tenant-scoped.
 */
export async function registerTripRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  const auth = authenticate(config.jwtSecret);
  const requireDb = () => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    return db;
  };

  // Create a trip (manual; normally generated from schedules).
  app.post('/v1/trips', { preHandler: [auth, requirePermission('schedule.manage')] }, async (req, reply) => {
    const b = parse(
      z.object({
        service_date: z.string(),
        direction: z.enum(['inbound', 'outbound']),
        site_id: z.string().uuid().optional(),
        route_id: z.string().uuid().optional(),
        shift_id: z.string().uuid().optional(),
        capacity: z.number().int().nonnegative().optional(),
        seats_taken: z.number().int().nonnegative().optional(),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `INSERT INTO trip(tenant_id, service_date, direction, site_id, route_id, shift_id, capacity, seats_taken)
         VALUES ($1,$2,$3,$4,$5,$6,$7,coalesce($8,0)) RETURNING *`,
        [p.tenantId, b.service_date, b.direction, b.site_id ?? null, b.route_id ?? null, b.shift_id ?? null, b.capacity ?? null, b.seats_taken ?? null],
      ),
    );
    reply.code(201);
    return { data: rows.rows[0] };
  });

  // The driver app's "Today" screen (etms_app TripRemoteDataSource.fetchToday):
  // the trips assigned to the driver record linked to the caller.
  //
  // `date` is 'today' (the default) or an ISO YYYY-MM-DD. 'today' resolves in the
  // tenant's own timezone, not the server's, so an early/late shift still reads
  // the service date the roster was planned against.
  app.get('/v1/driver/trips', { preHandler: [auth, requirePermission('trip.read')] }, async (req) => {
    const q = parse(
      z.object({
        date: z
          .union([z.literal('today'), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')])
          .default('today'),
      }),
      req.query,
    );
    const p = getPrincipal(req);

    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      // Resolved in its own statement rather than a CASE, so the 'today' literal
      // is never fed to a ::date cast.
      let serviceDate = q.date;
      if (q.date === 'today') {
        const row = (
          await c.query(
            `SELECT to_char((now() AT TIME ZONE coalesce(default_timezone, 'UTC'))::date, 'YYYY-MM-DD') AS d
             FROM tenant WHERE id = app_current_tenant()`,
          )
        ).rows[0];
        if (!row) throw new ApiError(404, 'NOT_FOUND', 'Tenant not found');
        serviceDate = row.d;
      }

      // Matched against every driver record linked to the caller — `driver.user_id`
      // carries no unique constraint, so picking a single one would be arbitrary.
      // Unlike the driver *write* endpoints, a caller with no driver record is not
      // an error: the subquery is simply empty, and an admin or rider legitimately
      // has no trips of their own on the home screen every role lands on.
      const rows = await c.query(
        `SELECT t.id,
                to_char(t.service_date, 'YYYY-MM-DD') AS service_date,
                t.direction, t.status, t.seats_taken, t.capacity, t.planned_start,
                r.name AS route_name
         FROM trip t
         JOIN assignment a ON a.trip_id = t.id
         LEFT JOIN route r ON r.id = t.route_id
         WHERE t.service_date = $2::date
           AND a.driver_id IN (SELECT id FROM driver WHERE user_id = $1 AND deleted_at IS NULL)
         ORDER BY t.planned_start NULLS LAST, t.created_at`,
        [p.userId, serviceDate],
      );
      return { data: rows.rows };
    });
  });

  // Dispatch: assign a vehicle + driver, validating capacity and driver state.
  app.post('/v1/trips/:id/assign', { preHandler: [auth, requirePermission('trip.dispatch')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const b = parse(z.object({ vehicleId: z.string().uuid(), driverId: z.string().uuid() }), req.body);
    const p = getPrincipal(req);

    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const trip = (await c.query('SELECT * FROM trip WHERE id=$1', [id])).rows[0];
      if (!trip) throw new ApiError(404, 'NOT_FOUND', 'Trip not found');
      if (!['scheduled', 'assigned'].includes(trip.status)) {
        throw new ApiError(409, 'CONFLICT', `Trip is ${trip.status}; cannot (re)assign`);
      }
      const veh = (await c.query('SELECT * FROM vehicle WHERE id=$1 AND deleted_at IS NULL', [b.vehicleId])).rows[0];
      if (!veh) throw new ApiError(422, 'VALIDATION_ERROR', 'Vehicle not found');
      if (veh.status !== 'active') throw new ApiError(422, 'VALIDATION_ERROR', 'Vehicle is not active');
      if (veh.capacity < (trip.seats_taken ?? 0)) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Vehicle capacity is below booked seats');
      }
      const drv = (await c.query('SELECT * FROM driver WHERE id=$1 AND deleted_at IS NULL', [b.driverId])).rows[0];
      if (!drv) throw new ApiError(422, 'VALIDATION_ERROR', 'Driver not found');
      if (drv.verification_status !== 'verified') throw new ApiError(422, 'VALIDATION_ERROR', 'Driver is not verified');
      if (!['available', 'on_trip'].includes(drv.availability)) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Driver is not available');
      }

      const assignment = (
        await c.query(
          `INSERT INTO assignment(tenant_id, trip_id, vehicle_id, driver_id, assigned_by)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (trip_id) DO UPDATE
             SET vehicle_id=EXCLUDED.vehicle_id, driver_id=EXCLUDED.driver_id,
                 assigned_by=EXCLUDED.assigned_by, assigned_at=now()
           RETURNING *`,
          [p.tenantId, id, b.vehicleId, b.driverId, p.userId],
        )
      ).rows[0];
      await c.query("UPDATE trip SET status='assigned' WHERE id=$1", [id]);
      return { data: assignment };
    });
  });

  // Lifecycle transitions (driver operating the trip).
  const transition = (
    from: string[],
    to: string,
    stamp: 'actual_start' | 'actual_end',
    eventType: string,
  ) =>
    async (req: FastifyRequest) => {
      const { id } = parse(uuid, req.params);
      const p = getPrincipal(req);
      return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
        const res = await c.query(
          `UPDATE trip SET status=$2, ${stamp}=now()
           WHERE id=$1 AND status = ANY($3::text[]) RETURNING *`,
          [id, to, from],
        );
        if (res.rowCount === 0) {
          const exists = (await c.query('SELECT status FROM trip WHERE id=$1', [id])).rows[0];
          if (!exists) throw new ApiError(404, 'NOT_FOUND', 'Trip not found');
          throw new ApiError(409, 'CONFLICT', `Trip is ${exists.status}; expected one of ${from.join(', ')}`);
        }
        await c.query(
          `INSERT INTO trip_event(tenant_id, trip_id, event_type, actor_user_id, client_event_id)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (trip_id, client_event_id) DO NOTHING`,
          [p.tenantId, id, eventType, p.userId, `${id}:${eventType}`],
        );
        return { data: res.rows[0] };
      });
    };

  app.post('/v1/trips/:id/start', { preHandler: [auth, requirePermission('trip.operate')] },
    transition(['assigned'], 'started', 'actual_start', 'started'));

  app.post('/v1/trips/:id/complete', { preHandler: [auth, requirePermission('trip.operate')] },
    transition(['started', 'in_progress'], 'completed', 'actual_end', 'completed'));

  // Sensitive action: verify/reject a driver (docs/etms/04 requires MFA step-up
  // per tenant policy — enforced at the gateway/claims layer).
  app.post('/v1/drivers/:id/verify', { preHandler: [auth, requirePermission('driver.verify')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const b = parse(z.object({ status: z.enum(['verified', 'rejected']) }), req.body);
    const p = getPrincipal(req);
    const res = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        'UPDATE driver SET verification_status=$2 WHERE id=$1 AND deleted_at IS NULL RETURNING *',
        [id, b.status],
      ),
    );
    if (res.rowCount === 0) throw new ApiError(404, 'NOT_FOUND', 'Driver not found');
    return { data: res.rows[0] };
  });
}
