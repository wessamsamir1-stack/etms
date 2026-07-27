-- =============================================================================
-- ETMS — V0033: Views behind the operational report pack (driver-ops,
-- vehicle-ops, trip-duration, inefficient-trips, fuel-efficiency, route-cost,
-- attendance-discipline, plan-adherence). Only the expensive, geometry-heavy
-- parts live here — the reports themselves add the date range and the ranking.
-- Every view is security_invoker so RLS still scopes it to the caller's tenant.
-- =============================================================================

-- ---- Planned vs actual duration, per trip ----------------------------------
CREATE VIEW v_trip_duration WITH (security_invoker = true) AS
SELECT t.tenant_id, t.id AS trip_id, t.service_date, t.direction, t.status,
       t.route_id, r.name AS route_name,
       a.driver_id, d.full_name AS driver_name,
       a.vehicle_id, v.plate_no,
       t.planned_start, t.planned_end, t.actual_start, t.actual_end,
       round(EXTRACT(EPOCH FROM (t.planned_end - t.planned_start)) / 60.0)::int  AS planned_minutes,
       round(EXTRACT(EPOCH FROM (t.actual_end  - t.actual_start))  / 60.0)::int  AS actual_minutes,
       round(EXTRACT(EPOCH FROM (t.actual_start - t.planned_start)) / 60.0)::int AS start_delay_min,
       round(EXTRACT(EPOCH FROM ((t.actual_end - t.actual_start)
                               - (t.planned_end - t.planned_start))) / 60.0)::int AS overrun_min
FROM trip t
LEFT JOIN assignment a ON a.trip_id  = t.id
LEFT JOIN driver     d ON d.id       = a.driver_id
LEFT JOIN vehicle    v ON v.id       = a.vehicle_id
LEFT JOIN route      r ON r.id       = t.route_id;

-- ---- What the GPS trail says the trip actually did --------------------------
-- actual_km is the driven path; direct_km the straight line from first to last
-- ping. The ratio of driven distance to the PLANNED route length is what the
-- inefficient-trips report flags as a detour (a lap around the block).
CREATE VIEW v_trip_track WITH (security_invoker = true) AS
SELECT g.tenant_id, g.trip_id, g.pings, g.first_ping, g.last_ping,
       g.moving_pings, g.idle_pings, g.max_speed, g.avg_speed,
       CASE WHEN ST_NumPoints(g.path) >= 2
            THEN round((ST_Length(g.path::geography) / 1000.0)::numeric, 2) END AS actual_km,
       CASE WHEN ST_NumPoints(g.path) >= 2
            THEN round((ST_Distance(ST_StartPoint(g.path)::geography,
                                    ST_EndPoint(g.path)::geography) / 1000.0)::numeric, 2) END AS direct_km,
       round(EXTRACT(EPOCH FROM (g.last_ping - g.first_ping)) / 60.0, 1) AS tracked_minutes
FROM (
  SELECT vp.tenant_id, vp.trip_id,
         count(*)::int                                        AS pings,
         min(vp.recorded_at)                                  AS first_ping,
         max(vp.recorded_at)                                  AS last_ping,
         ST_MakeLine(vp.location::geometry ORDER BY vp.recorded_at) AS path,
         count(*) FILTER (WHERE coalesce(vp.speed, 0) >= 5)::int AS moving_pings,
         count(*) FILTER (WHERE coalesce(vp.speed, 0) <  5)::int AS idle_pings,
         max(vp.speed)                                        AS max_speed,
         round(avg(vp.speed), 1)                              AS avg_speed
  FROM vehicle_ping vp
  WHERE vp.trip_id IS NOT NULL
  GROUP BY vp.tenant_id, vp.trip_id
) g;

-- ---- Planned length of a route (sum of its stop-to-stop legs) --------------
CREATE VIEW v_route_planned_km WITH (security_invoker = true) AS
SELECT rs.tenant_id, rs.route_id,
       count(*)::int AS stops,
       CASE WHEN count(*) >= 2
            THEN round((ST_Length(ST_MakeLine(rs.location::geometry ORDER BY rs.seq)::geography)
                        / 1000.0)::numeric, 2) END AS planned_km
FROM route_stop rs
WHERE rs.location IS NOT NULL
GROUP BY rs.tenant_id, rs.route_id;

-- ---- Did the driver drive the day they proposed? ---------------------------
-- Zone adherence = share of the day's GPS pings that fall inside one of the
-- zones on the approved plan (ST_Covers, so a border ping counts as inside).
CREATE VIEW v_driver_plan_adherence WITH (security_invoker = true) AS
SELECT pl.tenant_id, pl.id AS plan_id, pl.driver_id, d.full_name AS driver_name,
       pl.service_date, pl.status AS plan_status, pl.window_start, pl.window_end,
       (SELECT count(*)::int FROM driver_route_plan_zone pz WHERE pz.plan_id = pl.id) AS planned_zones,
       tr.trips, tr.first_start, tr.last_end,
       CASE WHEN tr.first_start IS NOT NULL THEN (tr.first_start AT TIME ZONE tz.tz)::time END AS first_start_local,
       CASE WHEN tr.last_end    IS NOT NULL THEN (tr.last_end    AT TIME ZONE tz.tz)::time END AS last_end_local,
       gp.total_pings, gp.in_zone_pings,
       CASE WHEN gp.total_pings > 0
            THEN round(100.0 * gp.in_zone_pings / gp.total_pings)::int END AS zone_adherence_pct
FROM driver_route_plan pl
JOIN driver d ON d.id = pl.driver_id
LEFT JOIN LATERAL (
  SELECT coalesce((SELECT t2.default_timezone FROM tenant t2 WHERE t2.id = pl.tenant_id), 'UTC') AS tz
) tz ON true
LEFT JOIN LATERAL (
  SELECT count(*)::int AS trips, min(t.actual_start) AS first_start, max(t.actual_end) AS last_end
  FROM trip t JOIN assignment a ON a.trip_id = t.id
  WHERE a.driver_id = pl.driver_id AND t.service_date = pl.service_date
) tr ON true
LEFT JOIN LATERAL (
  SELECT count(*)::int AS total_pings,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM driver_route_plan_zone pz
           JOIN zone z ON z.id = pz.zone_id AND z.deleted_at IS NULL
           WHERE pz.plan_id = pl.id AND z.boundary IS NOT NULL
             AND ST_Covers(z.boundary, vp.location)
         ))::int AS in_zone_pings
  FROM vehicle_ping vp
  WHERE vp.driver_id  = pl.driver_id
    AND vp.recorded_at >= pl.service_date::timestamptz
    AND vp.recorded_at <  (pl.service_date + 1)::timestamptz
) gp ON true;
