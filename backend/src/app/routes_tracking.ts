import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError, authenticate, getPrincipal, requirePermission } from './middleware/context';
import { verifyJwt } from '../util/jwt';
import { isFeatureDisabled } from './feature_flags';
import { parse } from './validate';
import { TrackingHub, TRACK_CHANNEL, PositionEvent } from './tracking_hub';
import type { Deps } from './routes';

const uuid = z.object({ id: z.string().uuid() });

/**
 * Live tracking + incidents (docs/etms/05 §7). GPS pings land in the partitioned
 * vehicle_ping table and update vehicle_last_position (hot cache); SOS/incidents
 * are raised and resolved via the control tower. All RLS-tenant-scoped.
 */
export async function registerTrackingRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  const auth = authenticate(config.jwtSecret);
  const requireDb = () => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    return db;
  };

  // Batch GPS ingest (driver app streams these; offline-buffered upstream).
  app.post('/v1/tracking/pings', { preHandler: [auth, requirePermission('trip.operate')] }, async (req, reply) => {
    const b = parse(
      z.object({
        pings: z
          .array(
            z.object({
              vehicleId: z.string().uuid(),
              tripId: z.string().uuid().optional(),
              lat: z.number(),
              lng: z.number(),
              speed: z.number().optional(),
              heading: z.number().min(0).max(360).optional(),
              recordedAt: z.string(),
            }),
          )
          .min(1)
          .max(200),
      }),
      req.body,
    );
    const p = getPrincipal(req);

    await requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      for (const g of b.pings) {
        await c.query(
          `INSERT INTO vehicle_ping(tenant_id, trip_id, vehicle_id, location, speed, heading, recorded_at)
           VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint($4,$5),4326)::geography, $6,$7,$8)`,
          [p.tenantId, g.tripId ?? null, g.vehicleId, g.lng, g.lat, g.speed ?? null, g.heading ?? null, g.recordedAt],
        );
        await c.query(
          `INSERT INTO vehicle_last_position(tenant_id, vehicle_id, trip_id, location, speed, heading, recorded_at)
           VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint($4,$5),4326)::geography, $6,$7,$8)
           ON CONFLICT (tenant_id, vehicle_id) DO UPDATE
             SET trip_id=EXCLUDED.trip_id, location=EXCLUDED.location, speed=EXCLUDED.speed,
                 heading=EXCLUDED.heading, recorded_at=EXCLUDED.recorded_at
           WHERE vehicle_last_position.recorded_at <= EXCLUDED.recorded_at`,
          [p.tenantId, g.vehicleId, g.tripId ?? null, g.lng, g.lat, g.speed ?? null, g.heading ?? null, g.recordedAt],
        );
        // Publish the position for realtime subscribers (SSE). Tenant-scoped
        // fan-out happens in the hub; the payload carries tenant_id for filtering.
        await c.query('SELECT pg_notify($1, $2)', [
          TRACK_CHANNEL,
          JSON.stringify({
            tenantId: p.tenantId, vehicleId: g.vehicleId, tripId: g.tripId ?? null,
            lat: g.lat, lng: g.lng, speed: g.speed ?? null, heading: g.heading ?? null,
            recordedAt: g.recordedAt,
          } satisfies PositionEvent),
        ]);
      }
    });
    reply.code(202);
    return { accepted: b.pings.length };
  });

  // Realtime vehicle positions over Server-Sent Events. A driver app streams GPS
  // to /v1/tracking/pings; control-tower / rider clients subscribe here and get
  // each position pushed the moment it lands (Postgres LISTEN/NOTIFY → hub → SSE)
  // — no polling. Optional ?tripId= / ?vehicleId= narrows the stream. Because the
  // browser EventSource API cannot set headers, the token may be passed as
  // ?access_token= in addition to the Authorization header.
  const hub = db ? new TrackingHub(db) : null;
  if (hub) app.addHook('onClose', () => hub.close());

  app.get('/v1/tracking/stream', async (req, reply) => {
    if (!db || !hub) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    const q = parse(
      z.object({
        access_token: z.string().optional(),
        tripId: z.string().uuid().optional(),
        vehicleId: z.string().uuid().optional(),
      }),
      req.query,
    );
    const hdr = req.headers.authorization;
    const token = hdr?.startsWith('Bearer ') ? hdr.slice(7) : q.access_token;
    if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Missing token');
    const res = verifyJwt(token, config.jwtSecret, Math.floor(Date.now() / 1000));
    if (!res.valid) throw new ApiError(401, 'UNAUTHENTICATED', `Invalid token (${res.reason})`);
    if (!(res.claims.permissions ?? []).includes('tracking.read')) {
      throw new ApiError(403, 'FORBIDDEN', 'Requires tracking.read');
    }
    const tenantId = res.claims.tenant_id;
    if (await isFeatureDisabled(db, tenantId, res.claims.sub, 'live_tracking')) {
      throw new ApiError(403, 'FEATURE_DISABLED', "The 'live_tracking' feature is not enabled for your company");
    }

    // Take over the socket and stream SSE frames.
    reply.hijack();
    const raw = reply.raw;
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    };
    if (config.corsOrigin) {
      headers['Access-Control-Allow-Origin'] = config.corsOrigin;
      headers['Vary'] = 'origin';
    }
    raw.writeHead(200, headers);
    raw.write('retry: 3000\n');
    raw.write(': connected\n\n');

    const send = (e: PositionEvent): void => {
      raw.write(`event: position\ndata: ${JSON.stringify(e)}\n\n`);
    };
    let unsub: (() => void) | null = null;
    try {
      unsub = await hub.subscribe({ tenantId, tripId: q.tripId, vehicleId: q.vehicleId, send });
    } catch {
      raw.write(': subscribe-failed\n\n');
      raw.end();
      return;
    }
    const hb = setInterval(() => {
      try { raw.write(': hb\n\n'); } catch { /* closed */ }
    }, 25000);
    const cleanup = (): void => {
      clearInterval(hb);
      unsub?.();
      try { raw.end(); } catch { /* already closed */ }
    };
    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
  });

  // Control-tower fleet view: last-known position per vehicle.
  app.get('/v1/tracking/vehicles', { preHandler: [auth, requirePermission('tracking.read')] }, async (req) => {
    const p = getPrincipal(req);
    const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `SELECT vehicle_id, trip_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
                speed, heading, recorded_at
         FROM vehicle_last_position ORDER BY recorded_at DESC`,
      ),
    );
    return { data: rows.rows };
  });

  // Raise an incident / SOS.
  app.post('/v1/incidents', { preHandler: [auth, requirePermission('sos.raise')] }, async (req, reply) => {
    const b = parse(
      z.object({
        type: z.enum(['sos', 'off_route', 'delay', 'breakdown', 'accident', 'other']),
        severity: z.enum(['low', 'medium', 'high', 'critical']).default('high'),
        tripId: z.string().uuid().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        description: z.string().optional(),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    const hasLoc = b.lat != null && b.lng != null;
    const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `INSERT INTO incident(tenant_id, trip_id, type, severity, raised_by, description, location)
         VALUES ($1,$2,$3,$4,$5,$6, ${hasLoc ? 'ST_SetSRID(ST_MakePoint($7,$8),4326)::geography' : 'NULL'})
         RETURNING id, type, severity, status, created_at`,
        hasLoc
          ? [p.tenantId, b.tripId ?? null, b.type, b.severity, p.userId, b.description ?? null, b.lng, b.lat]
          : [p.tenantId, b.tripId ?? null, b.type, b.severity, p.userId, b.description ?? null],
      ),
    );
    reply.code(201);
    return { data: rows.rows[0] };
  });

  app.get('/v1/incidents', { preHandler: [auth, requirePermission('incident.read')] }, async (req) => {
    const q = parse(z.object({ status: z.string().optional() }), req.query);
    const p = getPrincipal(req);
    const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `SELECT id, trip_id, type, severity, status, created_at, resolved_at
         FROM incident ${q.status ? 'WHERE status=$1' : ''}
         ORDER BY created_at DESC LIMIT 200`,
        q.status ? [q.status] : [],
      ),
    );
    return { data: rows.rows };
  });

  const setStatus = (to: 'acknowledged' | 'resolved', stampCol: string) =>
    async (req: FastifyRequest) => {
      const { id } = parse(uuid, req.params);
      const p = getPrincipal(req);
      const res = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
        c.query(
          `UPDATE incident SET status=$2, ${stampCol}=now(), ${to}_by=$3
           WHERE id=$1 AND status <> 'resolved' RETURNING id, status`,
          [id, to, p.userId],
        ),
      );
      if (res.rowCount === 0) throw new ApiError(404, 'NOT_FOUND', 'Open incident not found');
      return { data: res.rows[0] };
    };

  app.post('/v1/incidents/:id/acknowledge', { preHandler: [auth, requirePermission('incident.resolve')] },
    setStatus('acknowledged', 'acknowledged_at'));
  app.post('/v1/incidents/:id/resolve', { preHandler: [auth, requirePermission('incident.resolve')] },
    setStatus('resolved', 'resolved_at'));
}
