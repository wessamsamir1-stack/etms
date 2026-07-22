import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Config } from '../config';
import type { EligibilityAiPort } from '../domain/eligibility/ai_port';
import type { HrDirectoryPort } from '../domain/hr/hr_directory';
import { optimizeRoutes } from '../domain/optimization/route_optimizer';
import { signCheckToken, verifyCheckToken } from '../domain/checkin/qr_token';
import { render, withinLimit, Channel } from '../domain/notifications/template';
import { buildErpExport } from '../domain/sap/erp_export';
import { ApiError, authenticate, getPrincipal, requireMfa, requirePermission } from './middleware/context';
import { registerAuthRoutes } from './routes_auth';
import { registerCrudRoutes } from './routes_crud';
import { registerEligibilityRoutes } from './routes_eligibility';
import { registerHrRoutes } from './routes_hr';
import { registerNotificationRoutes } from './routes_notifications';
import { registerRoleRoutes } from './routes_roles';
import { registerTrackingRoutes } from './routes_tracking';
import { registerTripRoutes } from './routes_trips';
import { registerUsageRoutes } from './routes_usage';
import { registerRegistrationRoutes } from './routes_registration';
import { registerDriverPlanRoutes } from './routes_driver_plan';
import { registerRideRequestRoutes } from './routes_ride_requests';
import { registerManifestRoutes } from './routes_manifest';
import { registerFeedbackRoutes } from './routes_feedback';
import { registerPlatformRoutes } from './routes_platform';
import { registerSsoRoutes } from './routes_sso';
import { registerSamlRoutes } from './routes_saml';
import type { OtpDeliveryPort, FaceMatchPort } from '../domain/registration/ports';
import { FieldCrypto } from '../util/field_crypto';
import { parse } from './validate';
import { Db } from './db/pool';

export interface Deps {
  config: Config;
  db: Db | null;
  /** Cross-tenant (BYPASSRLS) connection for the Super-Admin platform API. */
  platformDb?: Db | null;
  hrDirectory?: HrDirectoryPort;
  eligibilityAi?: EligibilityAiPort;
  otpDelivery?: OtpDeliveryPort;
  faceMatch?: FaceMatchPort;
  /** Field encryption for sensitive PII; defaults to a disabled passthrough. */
  fieldCrypto?: FieldCrypto;
}

const latLng = z.object({ lat: z.number(), lng: z.number() });

export async function registerRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { config, db } = deps;
  const auth = authenticate(config.jwtSecret);

  // ---- Health + readiness (public) -----------------------------------------
  app.get('/health', async () => ({
    status: 'ok',
    service: 'etms-backend',
    db: db ? ((await db.ping()) ? 'ok' : 'down') : 'unconfigured',
    time: new Date().toISOString(),
  }));

  // Readiness for orchestrators (k8s): 503 when a configured DB is unreachable.
  app.get('/ready', async (_req, reply) => {
    const dbOk = db ? await db.ping() : null;
    if (dbOk === false) {
      return reply.code(503).send({ ready: false, db: 'down' });
    }
    return { ready: true, db: dbOk === null ? 'unconfigured' : 'ok' };
  });

  // ---- Auth (login → JWT) + tenant-scoped CRUD resources -------------------
  await registerAuthRoutes(app, deps);
  await registerSsoRoutes(app, deps);
  await registerSamlRoutes(app, deps);
  await registerCrudRoutes(app, deps);
  await registerTripRoutes(app, deps);
  await registerTrackingRoutes(app, deps);
  await registerNotificationRoutes(app, deps);
  await registerEligibilityRoutes(app, deps);
  await registerHrRoutes(app, deps);
  await registerRoleRoutes(app, deps);
  await registerUsageRoutes(app, deps);
  await registerRegistrationRoutes(app, deps);
  await registerDriverPlanRoutes(app, deps);
  await registerRideRequestRoutes(app, deps);
  await registerManifestRoutes(app, deps);
  await registerFeedbackRoutes(app, deps);
  await registerPlatformRoutes(app, deps);

  // ---- Route Optimization Engine (pure) ------------------------------------
  app.post(
    '/v1/routes/optimize',
    { preHandler: [auth, requirePermission('route.manage')] },
    async (req) => {
      const body = parse(
        z.object({
          depot: latLng,
          capacity: z.number().int().positive(),
          stops: z
            .array(latLng.extend({ id: z.string(), demand: z.number().int().nonnegative() }))
            .min(1),
        }),
        req.body,
      );
      const routes = optimizeRoutes(body.stops, body.depot, { capacity: body.capacity });
      return { routes, vehicles: routes.length };
    },
  );

  // ---- QR Check-in / Check-out ---------------------------------------------
  app.post(
    '/v1/checkin/token',
    { preHandler: [auth, requirePermission('trip.operate')] },
    async (req) => {
      const b = parse(
        z.object({
          tripId: z.string(),
          employeeId: z.string(),
          direction: z.enum(['in', 'out']),
          ttlSeconds: z.number().int().positive().max(3600).default(300),
        }),
        req.body,
      );
      const exp = Math.floor(Date.now() / 1000) + b.ttlSeconds;
      const token = signCheckToken(
        { t: b.tripId, e: b.employeeId, k: b.direction, x: exp },
        config.qrSecret,
      );
      return { token, expiresAt: new Date(exp * 1000).toISOString() };
    },
  );

  app.post(
    '/v1/checkin/verify',
    { preHandler: [auth, requirePermission('trip.operate')] },
    async (req) => {
      const b = parse(z.object({ token: z.string(), clientEventId: z.string().optional() }), req.body);
      const res = verifyCheckToken(b.token, config.qrSecret, Math.floor(Date.now() / 1000));
      if (!res.valid) throw new ApiError(409, 'CONFLICT', `Invalid QR (${res.reason})`);

      // Record the boarding/alighting as an idempotent trip_event when a DB is
      // configured (offline replay safe via client_event_id).
      if (db) {
        const p = getPrincipal(req);
        await db.withTenant(p.tenantId, p.userId, async (c) => {
          await c.query(
            `INSERT INTO trip_event(tenant_id, trip_id, event_type, actor_user_id, employee_id, client_event_id)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (trip_id, client_event_id) DO NOTHING`,
            [
              p.tenantId,
              res.payload.t,
              res.payload.k === 'in' ? 'pickup' : 'dropoff',
              p.userId,
              res.payload.e,
              b.clientEventId ?? `${res.payload.t}:${res.payload.e}:${res.payload.k}`,
            ],
          );

          // Boarding ("in") = the employee actually used company transport. Record
          // it on the usage ledger for the LATER payroll deduction — the ride is
          // never charged now. Idempotent (offline replay safe): one usage per
          // employee/trip/direction. Direction is taken from the trip so a
          // round trip on one day still counts as one day (see V0018 view).
          if (res.payload.k === 'in') {
            await c.query(
              `INSERT INTO transport_usage
                 (tenant_id, employee_id, trip_id, service_date, direction, source, boarded_at)
               SELECT $1, $2, t.id, t.service_date, t.direction, 'qr', now()
               FROM trip t WHERE t.id = $3
               ON CONFLICT (tenant_id, trip_id, employee_id, direction) DO NOTHING`,
              [p.tenantId, res.payload.e, res.payload.t],
            );
          }
        });
      }
      return { valid: true, tripId: res.payload.t, employeeId: res.payload.e, direction: res.payload.k };
    },
  );

  // ---- Notification System (render/preview) --------------------------------
  app.post(
    '/v1/notifications/preview',
    { preHandler: [auth, requirePermission('notification.send')] },
    async (req) => {
      const b = parse(
        z.object({
          template: z.string(),
          channel: z.enum(['push', 'sms', 'email', 'whatsapp']),
          vars: z.record(z.union([z.string(), z.number()])).default({}),
        }),
        req.body,
      );
      const r = render(b.template, b.vars);
      return { text: r.text, missing: r.missing, withinLimit: withinLimit(b.channel as Channel, r.text) };
    },
  );

  // ---- SAP / ERP Integration -----------------------------------------------
  app.post(
    '/v1/exports/erp',
    { preHandler: [auth, requirePermission('erp.export'), requireMfa()] },
    async (req) => {
      const b = parse(
        z.object({
          periodStart: z.string(),
          periodEnd: z.string(),
          format: z.enum(['csv', 'sap_idoc', 'json']),
          lines: z
            .array(
              z.object({
                tripId: z.string(),
                costCenter: z.string(),
                amount: z.number(),
                currency: z.string().length(3),
                serviceDate: z.string(),
              }),
            )
            .min(1),
        }),
        req.body,
      );
      return buildErpExport(b);
    },
  );

  // ---- Dashboard (DB) ------------------------------------------------------
  app.get(
    '/v1/dashboard/kpis',
    { preHandler: [auth, requirePermission('report.operational')] },
    async (req) => {
      if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
      const p = getPrincipal(req);
      return db.withTenant(p.tenantId, p.userId, async (c) => {
        const one = async (sql: string) => Number((await c.query(sql)).rows[0]?.n ?? 0);
        return {
          employees: await one('SELECT count(*) n FROM employee WHERE deleted_at IS NULL'),
          vehicles: await one('SELECT count(*) n FROM vehicle WHERE deleted_at IS NULL'),
          drivers: await one('SELECT count(*) n FROM driver WHERE deleted_at IS NULL'),
          sites: await one('SELECT count(*) n FROM site WHERE deleted_at IS NULL'),
          openIncidents: await one("SELECT count(*) n FROM incident WHERE status = 'open'"),
        };
      });
    },
  );

  // ---- Operational dashboard metrics (daily-commute) -----------------------
  app.get(
    '/v1/dashboard/operational',
    { preHandler: [auth, requirePermission('report.operational')] },
    async (req) => {
      if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
      const q = parse(z.object({ from: z.string(), to: z.string() }), req.query);
      const p = getPrincipal(req);
      return db.withTenant(p.tenantId, p.userId, async (c) => {
        const trips = (
          await c.query(
            `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE status='completed')::int AS completed,
                    count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
                    count(*) FILTER (WHERE actual_start IS NOT NULL AND planned_start IS NOT NULL AND actual_start<=planned_start)::int AS on_time,
                    count(*) FILTER (WHERE actual_start IS NOT NULL AND planned_start IS NOT NULL)::int AS started_with_plan,
                    round(avg(EXTRACT(EPOCH FROM (actual_start-planned_start))/60.0)
                      FILTER (WHERE actual_start>planned_start),1) AS avg_delay_min
             FROM trip WHERE service_date BETWEEN $1 AND $2`,
            [q.from, q.to],
          )
        ).rows[0];
        const pax = (
          await c.query(
            `SELECT count(*) FILTER (WHERE tp.status='boarded')::int AS transported,
                    count(*) FILTER (WHERE tp.status='no_show')::int AS no_shows
             FROM trip_passenger tp JOIN trip t ON t.id=tp.trip_id
             WHERE t.service_date BETWEEN $1 AND $2`,
            [q.from, q.to],
          )
        ).rows[0];
        const wait = (
          await c.query(
            `SELECT round(avg(wait_seconds))::int AS avg_wait_seconds FROM trip_stop ts
             JOIN trip t ON t.id=ts.trip_id WHERE t.service_date BETWEEN $1 AND $2 AND ts.wait_seconds IS NOT NULL`,
            [q.from, q.to],
          )
        ).rows[0];
        const onTimePct = trips.started_with_plan ? Math.round((trips.on_time / trips.started_with_plan) * 100) : null;
        return {
          trips: trips.total, completed: trips.completed, cancelled: trips.cancelled,
          transported: pax.transported, noShows: pax.no_shows,
          onTimePct, avgDelayMin: trips.avg_delay_min, avgWaitSeconds: wait.avg_wait_seconds,
        };
      });
    },
  );

  // ---- Reports (DB) --------------------------------------------------------
  app.get(
    '/v1/reports/operational',
    { preHandler: [auth, requirePermission('report.operational')] },
    async (req) => {
      if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
      const q = parse(z.object({ from: z.string(), to: z.string() }), req.query);
      const p = getPrincipal(req);
      return db.withTenant(p.tenantId, p.userId, async (c) => {
        const { rows } = await c.query(
          `SELECT
             count(*)::int AS trips,
             count(*) FILTER (WHERE status='completed')::int AS completed,
             count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
             count(*) FILTER (WHERE actual_start IS NOT NULL AND actual_start <= planned_start)::int AS on_time
           FROM trip WHERE service_date BETWEEN $1 AND $2`,
          [q.from, q.to],
        );
        return rows[0];
      });
    },
  );
}
