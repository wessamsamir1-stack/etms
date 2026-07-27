-- =============================================================================
-- ETMS — V0031: Trip waitlist + capacity helpers. When a bus is full the
-- employee joins a per-trip waiting queue instead of being rejected; as soon as
-- a seat frees (removal / excuse / leave / cancelled ride request) the head of
-- the queue is promoted onto the manifest automatically (promoteWaitlist).
-- Capacity itself is resolved here once — trip.capacity when set, else the
-- assigned vehicle's capacity — so the API, the views and the guard all agree.
-- =============================================================================

-- ---- New permissions -------------------------------------------------------
INSERT INTO permission(code, description) VALUES
  ('waitlist.read',   'View a trip waiting list'),
  ('waitlist.manage', 'Add / remove / promote waiting-list entries')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY['waitlist.read','waitlist.manage'])
WHERE r.code='company_admin' AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY['waitlist.read','waitlist.manage'])
WHERE r.code IN ('ops_manager','dispatcher') AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

-- The driver sees who is still waiting for a seat on their own trip.
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY['waitlist.read'])
WHERE r.code IN ('driver','rider') AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

-- ---- Waiting list ----------------------------------------------------------
CREATE TABLE trip_waitlist (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  trip_id           uuid        NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  employee_id       uuid        NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  trip_stop_id      uuid REFERENCES trip_stop(id) ON DELETE SET NULL,
  -- 1-based queue order within the trip; promotion always takes the lowest.
  position          int         NOT NULL CHECK (position > 0),
  status            text        NOT NULL DEFAULT 'waiting'
                      CHECK (status IN ('waiting','promoted','cancelled','expired')),
  -- Where the entry came from, so a cancelled ride request can retract it.
  source            text        NOT NULL DEFAULT 'manifest'
                      CHECK (source IN ('manifest','ride_request')),
  ride_request_id   uuid REFERENCES ride_request(id) ON DELETE SET NULL,
  -- Set when the entry is promoted onto the manifest.
  trip_passenger_id uuid REFERENCES trip_passenger(id) ON DELETE SET NULL,
  promoted_at       timestamptz,
  note              text,
  created_by        uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- One live queue entry per employee per trip (a promoted/cancelled one may repeat).
CREATE UNIQUE INDEX uq_trip_waitlist_waiting ON trip_waitlist(trip_id, employee_id)
  WHERE status = 'waiting';
CREATE INDEX ix_trip_waitlist_queue ON trip_waitlist(tenant_id, trip_id, status, position);
CREATE INDEX ix_trip_waitlist_emp   ON trip_waitlist(tenant_id, employee_id, status);
SELECT attach_standard_triggers('trip_waitlist');

-- ---- Capacity helpers ------------------------------------------------------
-- Not SECURITY DEFINER on purpose: they run as the caller, so RLS still applies
-- and a function can never read another tenant's trip.

-- Seats the bus actually has: the trip's own override, else the assigned
-- vehicle's capacity. NULL means "uncapped" (no capacity is known).
CREATE FUNCTION app_trip_capacity(p_trip uuid) RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT coalesce(t.capacity, v.capacity)
  FROM trip t
  LEFT JOIN assignment a ON a.trip_id = t.id
  LEFT JOIN vehicle    v ON v.id = a.vehicle_id AND v.deleted_at IS NULL
  WHERE t.id = p_trip;
$$;

-- Seats currently taken = the ACTIVE manifest (daily-commute model: a no-show /
-- excused / removed passenger frees their place).
CREATE FUNCTION app_trip_occupied(p_trip uuid) RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM trip_passenger
  WHERE trip_id = p_trip AND status IN ('expected','on_the_way','boarded');
$$;

-- Free seats, or NULL when the capacity is unknown (never negative).
CREATE FUNCTION app_trip_remaining_seats(p_trip uuid) RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN app_trip_capacity(p_trip) IS NULL THEN NULL
              ELSE greatest(app_trip_capacity(p_trip) - app_trip_occupied(p_trip), 0) END;
$$;

-- ---- Reporting view --------------------------------------------------------
CREATE VIEW v_trip_seats WITH (security_invoker = true) AS
SELECT t.tenant_id, t.id AS trip_id, t.service_date, t.direction, t.status,
       app_trip_capacity(t.id)        AS capacity,
       app_trip_occupied(t.id)        AS occupied,
       app_trip_remaining_seats(t.id) AS remaining_seats,
       (SELECT count(*)::int FROM trip_waitlist w
         WHERE w.trip_id = t.id AND w.status = 'waiting') AS waiting
FROM trip t;

-- ---- RLS (tenant isolation) ------------------------------------------------
ALTER TABLE trip_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_waitlist FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON trip_waitlist
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
