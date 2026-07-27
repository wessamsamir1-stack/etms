import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, authenticate, getPrincipal, requirePermission } from './middleware/context';
import { parse } from './validate';
import { scoreFuelEfficiency, type VehicleFuelUsage } from '../domain/fleet/fuel_efficiency';
import { rankInefficientTrips, type TripEfficiencyInput } from '../domain/fleet/trip_efficiency';
import type { Deps } from './routes';

const dateRange = z.object({ from: z.string(), to: z.string() });
const limit = z.coerce.number().int().min(1).max(500).default(100);

/**
 * The operational report pack (db V0033). Everything here is read-only,
 * date-ranged and RLS-tenant-scoped:
 *
 *   driver-ops             per-driver operations scorecard
 *   vehicle-ops            per-vehicle operations + utilization
 *   trip-duration          planned vs actual duration and delay
 *   inefficient-trips      detour / idling / overrun detection from the GPS trail
 *   fuel-efficiency        km per litre per bus, with an anomaly flag
 *   route-cost             cost per route, per trip and per passenger
 *   attendance-discipline  per-employee no-show record
 *   plan-adherence         did the driver drive the day they proposed
 */
export async function registerReportRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  const auth = authenticate(config.jwtSecret);
  const requireDb = () => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    return db;
  };
  const ops = { preHandler: [auth, requirePermission('report.operational')] };

  // ---- Driver operations scorecard ----------------------------------------
  app.get('/v1/reports/driver-ops', ops, async (req) => {
    const q = parse(dateRange.extend({ limit }), req.query);
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const rows = (
        await c.query(
          `SELECT d.id AS driver_id, d.full_name, d.availability,
                  count(t.id)::int                                                   AS trips,
                  count(*) FILTER (WHERE t.status='completed')::int                  AS completed,
                  count(*) FILTER (WHERE t.status='cancelled')::int                  AS cancelled,
                  count(*) FILTER (WHERE t.actual_start IS NOT NULL AND t.planned_start IS NOT NULL
                                     AND t.actual_start <= t.planned_start)::int     AS on_time,
                  count(*) FILTER (WHERE t.actual_start IS NOT NULL
                                     AND t.planned_start IS NOT NULL)::int           AS started_with_plan,
                  round(avg(EXTRACT(EPOCH FROM (t.actual_start - t.planned_start))/60.0)
                        FILTER (WHERE t.actual_start > t.planned_start), 1)          AS avg_delay_min,
                  coalesce(sum((SELECT count(*) FROM trip_passenger tp
                                 WHERE tp.trip_id=t.id AND tp.status='boarded')),0)::int AS passengers,
                  coalesce(sum((SELECT count(*) FROM trip_passenger tp
                                 WHERE tp.trip_id=t.id AND tp.status='no_show')),0)::int AS no_shows,
                  (SELECT round(avg(tr.rate_driver),2) FROM trip_rating tr
                    WHERE tr.driver_id=d.id AND tr.created_at >= $1::date
                      AND tr.created_at < ($2::date + 1))                            AS avg_rating,
                  (SELECT count(*)::int FROM traffic_violation tv
                    WHERE tv.driver_id=d.id AND tv.deleted_at IS NULL
                      AND tv.occurred_at >= $1::date AND tv.occurred_at < ($2::date + 1)) AS violations,
                  (SELECT count(*)::int FROM incident i JOIN assignment a2 ON a2.trip_id=i.trip_id
                    WHERE a2.driver_id=d.id AND i.created_at >= $1::date
                      AND i.created_at < ($2::date + 1))                             AS incidents
           FROM driver d
           LEFT JOIN assignment a ON a.driver_id = d.id
           LEFT JOIN trip t ON t.id = a.trip_id AND t.service_date BETWEEN $1 AND $2
           WHERE d.deleted_at IS NULL
           GROUP BY d.id, d.full_name, d.availability
           HAVING count(t.id) > 0
           ORDER BY trips DESC, d.full_name
           LIMIT $3`,
          [q.from, q.to, q.limit],
        )
      ).rows;
      const drivers = rows.map((r) => ({
        ...r,
        on_time_pct: r.started_with_plan > 0 ? Math.round((r.on_time / r.started_with_plan) * 100) : null,
        no_show_pct:
          r.passengers + r.no_shows > 0
            ? Math.round((r.no_shows / (r.passengers + r.no_shows)) * 100)
            : null,
      }));
      return { data: { range: { from: q.from, to: q.to }, drivers } };
    });
  });

  // ---- Vehicle operations + utilization ------------------------------------
  app.get('/v1/reports/vehicle-ops', ops, async (req) => {
    const q = parse(dateRange.extend({ limit }), req.query);
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const rows = (
        await c.query(
          `SELECT v.id AS vehicle_id, v.plate_no, v.type, v.status, v.capacity,
                  count(t.id)::int                                                   AS trips,
                  count(*) FILTER (WHERE t.status='completed')::int                  AS completed,
                  coalesce(sum((SELECT count(*) FROM trip_passenger tp
                                 WHERE tp.trip_id=t.id AND tp.status='boarded')),0)::int AS passengers,
                  round(avg((SELECT count(*) FROM trip_passenger tp
                              WHERE tp.trip_id=t.id AND tp.status='boarded')), 1)    AS avg_passengers,
                  (SELECT coalesce(sum(fl.cost_amount),0) FROM fuel_log fl
                    WHERE fl.vehicle_id=v.id AND fl.deleted_at IS NULL
                      AND fl.filled_at >= $1::date AND fl.filled_at < ($2::date + 1)) AS fuel_cost,
                  (SELECT coalesce(sum(fl.liters),0) FROM fuel_log fl
                    WHERE fl.vehicle_id=v.id AND fl.deleted_at IS NULL
                      AND fl.filled_at >= $1::date AND fl.filled_at < ($2::date + 1)) AS liters,
                  (SELECT count(*)::int FROM traffic_violation tv
                    WHERE tv.vehicle_id=v.id AND tv.deleted_at IS NULL
                      AND tv.occurred_at >= $1::date AND tv.occurred_at < ($2::date + 1)) AS violations,
                  (SELECT coalesce(sum(tt.actual_km),0) FROM v_trip_track tt
                    JOIN trip t2 ON t2.id = tt.trip_id
                    JOIN assignment a2 ON a2.trip_id = t2.id
                    WHERE a2.vehicle_id=v.id AND t2.service_date BETWEEN $1 AND $2) AS driven_km,
                  v.inspection_expiry, v.insurance_expiry
           FROM vehicle v
           LEFT JOIN assignment a ON a.vehicle_id = v.id
           LEFT JOIN trip t ON t.id = a.trip_id AND t.service_date BETWEEN $1 AND $2
           WHERE v.deleted_at IS NULL
           GROUP BY v.id, v.plate_no, v.type, v.status, v.capacity, v.inspection_expiry, v.insurance_expiry
           ORDER BY trips DESC, v.plate_no
           LIMIT $3`,
          [q.from, q.to, q.limit],
        )
      ).rows;
      const vehicles = rows.map((r) => ({
        ...r,
        // Seat-utilization: of all the seats this bus ran with, how many were used.
        utilization_pct:
          r.capacity > 0 && r.trips > 0 ? Math.round((r.passengers / (r.capacity * r.trips)) * 100) : null,
        cost_per_km:
          Number(r.driven_km) > 0 ? Math.round((Number(r.fuel_cost) / Number(r.driven_km)) * 1000) / 1000 : null,
      }));
      return { data: { range: { from: q.from, to: q.to }, vehicles } };
    });
  });

  // ---- Planned vs actual trip duration -------------------------------------
  app.get('/v1/reports/trip-duration', ops, async (req) => {
    const q = parse(
      dateRange.extend({ route_id: z.string().uuid().optional(), driver_id: z.string().uuid().optional(), limit }),
      req.query,
    );
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const trips = (
        await c.query(
          `SELECT trip_id, service_date, direction, status, route_id, route_name,
                  driver_id, driver_name, plate_no,
                  planned_start, actual_start, planned_end, actual_end,
                  planned_minutes, actual_minutes, start_delay_min, overrun_min
           FROM v_trip_duration
           WHERE service_date BETWEEN $1 AND $2
             AND ($3::uuid IS NULL OR route_id=$3)
             AND ($4::uuid IS NULL OR driver_id=$4)
           ORDER BY service_date DESC, coalesce(actual_start, planned_start) DESC
           LIMIT $5`,
          [q.from, q.to, q.route_id ?? null, q.driver_id ?? null, q.limit],
        )
      ).rows;
      const totals = (
        await c.query(
          `SELECT count(*)::int AS trips,
                  round(avg(planned_minutes), 1) AS avg_planned_minutes,
                  round(avg(actual_minutes), 1)  AS avg_actual_minutes,
                  round(avg(start_delay_min), 1) AS avg_start_delay_min,
                  round(avg(overrun_min), 1)     AS avg_overrun_min,
                  count(*) FILTER (WHERE start_delay_min > 0)::int AS late_starts
           FROM v_trip_duration
           WHERE service_date BETWEEN $1 AND $2
             AND ($3::uuid IS NULL OR route_id=$3)
             AND ($4::uuid IS NULL OR driver_id=$4)`,
          [q.from, q.to, q.route_id ?? null, q.driver_id ?? null],
        )
      ).rows[0];
      // Per route, so a consistently under-planned route stands out.
      const perRoute = (
        await c.query(
          `SELECT route_id, route_name, count(*)::int AS trips,
                  round(avg(planned_minutes), 1) AS avg_planned_minutes,
                  round(avg(actual_minutes), 1)  AS avg_actual_minutes,
                  round(avg(overrun_min), 1)     AS avg_overrun_min
           FROM v_trip_duration
           WHERE service_date BETWEEN $1 AND $2 AND route_id IS NOT NULL
           GROUP BY route_id, route_name ORDER BY avg_overrun_min DESC NULLS LAST LIMIT 50`,
          [q.from, q.to],
        )
      ).rows;
      return { data: { range: { from: q.from, to: q.to }, totals, perRoute, trips } };
    });
  });

  // ---- Inefficient trips (detour detection) --------------------------------
  app.get('/v1/reports/inefficient-trips', ops, async (req) => {
    const q = parse(
      dateRange.extend({
        detour_ratio: z.coerce.number().min(1).max(10).optional(),
        idle_share: z.coerce.number().min(0).max(1).optional(),
        overrun_pct: z.coerce.number().min(0).max(500).optional(),
        limit,
      }),
      req.query,
    );
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const rows = (
        await c.query(
          `SELECT td.trip_id, td.service_date, td.direction, td.route_id, td.route_name,
                  td.driver_id, td.driver_name, td.plate_no,
                  td.planned_minutes, td.actual_minutes,
                  tt.actual_km, tt.direct_km, tt.pings, tt.idle_pings,
                  tt.tracked_minutes, tt.avg_speed, tt.max_speed,
                  rk.planned_km
           FROM v_trip_duration td
           JOIN v_trip_track   tt ON tt.trip_id = td.trip_id
           LEFT JOIN v_route_planned_km rk ON rk.route_id = td.route_id
           WHERE td.service_date BETWEEN $1 AND $2
           ORDER BY td.service_date DESC
           LIMIT 1000`,
          [q.from, q.to],
        )
      ).rows;

      const inputs: TripEfficiencyInput[] = rows.map((r) => ({
        tripId: r.trip_id,
        actualKm: r.actual_km === null ? null : Number(r.actual_km),
        plannedKm: r.planned_km === null ? null : Number(r.planned_km),
        directKm: r.direct_km === null ? null : Number(r.direct_km),
        pings: Number(r.pings ?? 0),
        idlePings: Number(r.idle_pings ?? 0),
        plannedMinutes: r.planned_minutes === null ? null : Number(r.planned_minutes),
        actualMinutes: r.actual_minutes === null ? null : Number(r.actual_minutes),
      }));
      const thresholds = {
        ...(q.detour_ratio !== undefined ? { detourRatio: q.detour_ratio } : {}),
        ...(q.idle_share !== undefined ? { idleShare: q.idle_share } : {}),
        ...(q.overrun_pct !== undefined ? { overrunPct: q.overrun_pct } : {}),
      };
      const byId = new Map(rows.map((r) => [r.trip_id as string, r]));
      const trips = rankInefficientTrips(inputs, thresholds)
        .slice(0, q.limit)
        .map((t) => ({ ...byId.get(t.tripId), ...t }));

      return {
        data: {
          range: { from: q.from, to: q.to },
          thresholds: {
            detour_ratio: q.detour_ratio ?? 1.35,
            idle_share: q.idle_share ?? 0.4,
            overrun_pct: q.overrun_pct ?? 30,
          },
          tripsExamined: rows.length,
          flagged: trips.length,
          trips,
        },
      };
    });
  });

  // ---- Fuel efficiency, with a per-bus anomaly flag ------------------------
  app.get('/v1/reports/fuel-efficiency', ops, async (req) => {
    const q = parse(
      dateRange.extend({
        km_per_liter_floor: z.coerce.number().min(0.1).max(1).optional(),
        cost_per_km_ceiling: z.coerce.number().min(1).max(10).optional(),
      }),
      req.query,
    );
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const rows = (
        await c.query(
          `SELECT fl.vehicle_id, v.plate_no, count(*)::int AS fills,
                  sum(fl.liters) AS liters, sum(fl.cost_amount) AS cost,
                  CASE WHEN max(fl.odometer_km) > min(fl.odometer_km)
                       THEN max(fl.odometer_km) - min(fl.odometer_km) END AS km
           FROM fuel_log fl JOIN vehicle v ON v.id = fl.vehicle_id
           WHERE fl.deleted_at IS NULL
             AND fl.filled_at >= $1::date AND fl.filled_at < ($2::date + 1)
           GROUP BY fl.vehicle_id, v.plate_no
           ORDER BY v.plate_no`,
          [q.from, q.to],
        )
      ).rows;
      const usage: VehicleFuelUsage[] = rows.map((r) => ({
        vehicleId: r.vehicle_id,
        plateNo: r.plate_no,
        fills: Number(r.fills),
        liters: Number(r.liters ?? 0),
        cost: Number(r.cost ?? 0),
        km: r.km === null ? null : Number(r.km),
      }));
      const report = scoreFuelEfficiency(usage, {
        ...(q.km_per_liter_floor !== undefined ? { kmPerLiterFloor: q.km_per_liter_floor } : {}),
        ...(q.cost_per_km_ceiling !== undefined ? { costPerKmCeiling: q.cost_per_km_ceiling } : {}),
      });
      return { data: { range: { from: q.from, to: q.to }, ...report } };
    });
  });

  // ---- Cost per route -------------------------------------------------------
  app.get('/v1/reports/route-cost', ops, async (req) => {
    const q = parse(dateRange.extend({ limit }), req.query);
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const rows = (
        await c.query(
          `SELECT r.id AS route_id, r.name AS route_name, r.direction, s.name AS site_name,
                  rk.planned_km,
                  count(t.id)::int AS trips,
                  coalesce(sum((SELECT count(*) FROM trip_passenger tp
                                 WHERE tp.trip_id=t.id AND tp.status='boarded')),0)::int AS passengers,
                  coalesce(sum(tc.amount), 0)                                    AS trip_cost,
                  -- Fuel is logged per vehicle per day, not per trip, so it is
                  -- attributed to the route the bus ran that day. A bus that
                  -- served two routes on one day has that day's fill counted
                  -- against both — read this column as an indication, not a ledger.
                  coalesce(sum((SELECT coalesce(sum(fl.cost_amount),0) FROM fuel_log fl
                                 WHERE fl.vehicle_id = a.vehicle_id AND fl.deleted_at IS NULL
                                   AND fl.filled_at::date = t.service_date)), 0) AS fuel_cost,
                  coalesce(sum((SELECT coalesce(sum(tv.amount),0) FROM traffic_violation tv
                                 WHERE tv.trip_id = t.id AND tv.deleted_at IS NULL)), 0) AS violation_cost,
                  coalesce(sum(tt.actual_km), 0)                                 AS driven_km
           FROM route r
           JOIN site s ON s.id = r.site_id
           LEFT JOIN v_route_planned_km rk ON rk.route_id = r.id
           LEFT JOIN trip t       ON t.route_id = r.id AND t.service_date BETWEEN $1 AND $2
           LEFT JOIN assignment a ON a.trip_id = t.id
           LEFT JOIN trip_cost tc ON tc.trip_id = t.id
           LEFT JOIN v_trip_track tt ON tt.trip_id = t.id
           WHERE r.deleted_at IS NULL
           GROUP BY r.id, r.name, r.direction, s.name, rk.planned_km
           HAVING count(t.id) > 0
           ORDER BY (coalesce(sum(tc.amount),0)) DESC, r.name
           LIMIT $3`,
          [q.from, q.to, q.limit],
        )
      ).rows;
      const routes = rows.map((r) => {
        const total = Number(r.trip_cost) + Number(r.fuel_cost) + Number(r.violation_cost);
        const per = (x: number, by: number): number | null =>
          by > 0 ? Math.round((x / by) * 1000) / 1000 : null;
        return {
          ...r,
          total_cost: Math.round(total * 1000) / 1000,
          cost_per_trip: per(total, Number(r.trips)),
          cost_per_passenger: per(total, Number(r.passengers)),
          cost_per_km: per(total, Number(r.driven_km)),
        };
      });
      const totals = routes.reduce(
        (acc, r) => ({
          trips: acc.trips + Number(r.trips),
          passengers: acc.passengers + Number(r.passengers),
          total_cost: Math.round((acc.total_cost + r.total_cost) * 1000) / 1000,
        }),
        { trips: 0, passengers: 0, total_cost: 0 },
      );
      return { data: { range: { from: q.from, to: q.to }, totals, routes } };
    });
  });

  // ---- Attendance discipline (per employee) --------------------------------
  app.get('/v1/reports/attendance-discipline', ops, async (req) => {
    const q = parse(
      dateRange.extend({
        min_no_shows: z.coerce.number().int().min(0).max(100).default(1),
        limit,
      }),
      req.query,
    );
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const rows = (
        await c.query(
          `SELECT e.id AS employee_id, e.full_name, e.external_hr_id, e.department,
                  count(*)::int                                                  AS scheduled,
                  count(*) FILTER (WHERE tp.status='boarded')::int               AS boarded,
                  count(*) FILTER (WHERE tp.status='no_show')::int               AS no_shows,
                  count(*) FILTER (WHERE tp.status IN ('excused','on_leave'))::int AS excused,
                  count(*) FILTER (WHERE tp.on_the_way_at IS NOT NULL)::int      AS on_the_way,
                  max(t.service_date) FILTER (WHERE tp.status='no_show')         AS last_no_show
           FROM trip_passenger tp
           JOIN trip t     ON t.id = tp.trip_id
           JOIN employee e ON e.id = tp.employee_id
           WHERE t.service_date BETWEEN $1 AND $2 AND e.deleted_at IS NULL
           GROUP BY e.id, e.full_name, e.external_hr_id, e.department
           HAVING count(*) FILTER (WHERE tp.status='no_show') >= $3
           ORDER BY no_shows DESC, e.full_name
           LIMIT $4`,
          [q.from, q.to, q.min_no_shows, q.limit],
        )
      ).rows;
      const employees = rows.map((r) => {
        // Excused absences are not misses — they were declared in advance.
        const countable = Number(r.boarded) + Number(r.no_shows);
        const rate = countable > 0 ? Math.round((Number(r.no_shows) / countable) * 100) : 0;
        return {
          ...r,
          no_show_pct: rate,
          // The line ops actually acts on: repeated AND frequent.
          discipline_flag: Number(r.no_shows) >= 3 && rate >= 20,
        };
      });
      return {
        data: {
          range: { from: q.from, to: q.to },
          flagged: employees.filter((e) => e.discipline_flag).length,
          employees,
        },
      };
    });
  });

  // ---- Driver plan adherence ------------------------------------------------
  app.get('/v1/reports/plan-adherence', ops, async (req) => {
    const q = parse(
      dateRange.extend({ driver_id: z.string().uuid().optional(), limit }),
      req.query,
    );
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const rows = (
        await c.query(
          `SELECT plan_id, driver_id, driver_name, service_date, plan_status,
                  window_start, window_end, planned_zones, trips,
                  first_start, last_end, first_start_local, last_end_local,
                  total_pings, in_zone_pings, zone_adherence_pct
           FROM v_driver_plan_adherence
           WHERE service_date BETWEEN $1 AND $2
             AND ($3::uuid IS NULL OR driver_id=$3)
           ORDER BY service_date DESC, driver_name
           LIMIT $4`,
          [q.from, q.to, q.driver_id ?? null, q.limit],
        )
      ).rows;
      const plans = rows.map((r) => {
        // Did the work happen inside the window the driver proposed?
        const inWindow =
          r.first_start_local && r.last_end_local
            ? r.first_start_local >= r.window_start && r.last_end_local <= r.window_end
            : null;
        const zonePct = r.zone_adherence_pct === null ? null : Number(r.zone_adherence_pct);
        return {
          ...r,
          in_window: inWindow,
          // Approved, drove, stayed in the declared zones and inside the window.
          adherent:
            r.plan_status === 'approved' &&
            Number(r.trips) > 0 &&
            inWindow !== false &&
            (zonePct === null || zonePct >= 80),
        };
      });
      const withPct = plans.filter((x) => x.zone_adherence_pct !== null);
      return {
        data: {
          range: { from: q.from, to: q.to },
          totals: {
            plans: plans.length,
            approved: plans.filter((x) => x.plan_status === 'approved').length,
            adherent: plans.filter((x) => x.adherent).length,
            avg_zone_adherence_pct: withPct.length
              ? Math.round(withPct.reduce((s, x) => s + Number(x.zone_adherence_pct), 0) / withPct.length)
              : null,
          },
          plans,
        },
      };
    });
  });
}
