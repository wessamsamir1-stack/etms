-- =============================================================================
-- ETMS — V0032: Zone matching for ride requests. A driver only wants the
-- requests that fall on the route they already plan to drive that day, so a
-- request's pickup point is tested with ST_Covers against the boundaries of the
-- zones on the driver's APPROVED route plan for the request's service date
-- (docs/etms/14 §driver-routes, docs/etms/16). When the request carries no
-- pickup point we fall back to the employee's registered home zone.
-- =============================================================================

-- Persisted lat/lng for a saved pickup: V0020 declared the column but nothing
-- ever wrote it. `pickup_location` on ride_request already exists too — both are
-- now populated by POST /v1/ride-requests and PUT /v1/my-pickup.
CREATE INDEX IF NOT EXISTS ix_ride_request_pickup_loc ON ride_request USING gist (pickup_location);
CREATE INDEX IF NOT EXISTS ix_employee_pickup_loc     ON employee_pickup USING gist (location);

-- Does the driver have an approved plan for that day at all? Without one there
-- is no route to match against, and "matches_route" is unknown rather than false.
CREATE FUNCTION app_driver_has_route_plan(p_driver uuid, p_date date) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM driver_route_plan pl
    WHERE pl.driver_id = p_driver AND pl.service_date = p_date AND pl.status = 'approved'
  );
$$;

-- Is this request's pickup inside one of the zones of that plan?
-- ST_Covers (not ST_Within) so a pickup exactly on the zone border counts.
-- Not SECURITY DEFINER: it runs as the caller, so RLS keeps it tenant-scoped.
CREATE FUNCTION app_ride_request_in_driver_route(p_request uuid, p_driver uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM ride_request rr
    JOIN driver_route_plan pl
      ON pl.driver_id    = p_driver
     AND pl.service_date = rr.service_date
     AND pl.status       = 'approved'
    JOIN driver_route_plan_zone pz ON pz.plan_id = pl.id
    JOIN zone z ON z.id = pz.zone_id AND z.deleted_at IS NULL
    LEFT JOIN employee e ON e.id = rr.employee_id
    WHERE rr.id = p_request
      AND (
        -- Geographic match on the request's own pickup point …
        (rr.pickup_location IS NOT NULL AND z.boundary IS NOT NULL
         AND ST_Covers(z.boundary, rr.pickup_location))
        -- … else the employee's registered home zone.
        OR (rr.pickup_location IS NULL AND e.home_zone_id = z.id)
      )
  );
$$;

-- NULL = unknown (no approved plan for that date), true/false = matched or not.
CREATE FUNCTION app_ride_request_route_match(p_request uuid, p_driver uuid, p_date date)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN app_driver_has_route_plan(p_driver, p_date)
              THEN app_ride_request_in_driver_route(p_request, p_driver) END;
$$;
