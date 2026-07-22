-- =============================================================================
-- ETMS — V0021: Daily-commute model. Removes seat-reservation semantics in
-- favour of a per-trip passenger MANIFEST with attendance statuses, plus stop
-- arrival + admin-configurable waiting timer + no-show, "I'm on the way",
-- trip rating, and lost & found. (Booking/seat_allocation stay for now but are
-- superseded by the manifest — see docs/etms/17.)
-- =============================================================================

-- ---- New permissions -------------------------------------------------------
INSERT INTO permission(code, description) VALUES
  ('trip.attend',      'Employee marks themselves on-the-way / views own manifest entry'),
  ('manifest.manage',  'Manage a trip passenger manifest (excuse / remove / mark leave)'),
  ('rating.create',    'Employee rates a completed trip'),
  ('rating.read',      'View trip ratings'),
  ('lost_item.create', 'Report a lost item'),
  ('lost_item.read',   'View / manage lost item reports')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY[
  'trip.attend','manifest.manage','rating.create','rating.read','lost_item.create','lost_item.read'])
WHERE r.code='company_admin' AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY[
  'trip.attend','rating.create','lost_item.create'])
WHERE r.code='rider' AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY['lost_item.read'])
WHERE r.code='driver' AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY[
  'manifest.manage','rating.read','lost_item.read'])
WHERE r.code IN ('ops_manager','dispatcher','hr_admin') AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

-- ---- Per-tenant transport policy (admin-configurable waiting timer) ---------
CREATE TABLE tenant_transport_policy (
  tenant_id         uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  wait_seconds      int   NOT NULL DEFAULT 120 CHECK (wait_seconds BETWEEN 0 AND 3600),
  notify_before_min int[] NOT NULL DEFAULT '{10,3}',        -- pre-arrival pushes
  allow_driver_skip boolean NOT NULL DEFAULT true,          -- "move to next stop" button
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_tenant_transport_policy_updated BEFORE UPDATE ON tenant_transport_policy
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Optional per-route override of the waiting timer.
ALTER TABLE route ADD COLUMN wait_seconds int CHECK (wait_seconds IS NULL OR wait_seconds BETWEEN 0 AND 3600);

-- ---- Trip stops (arrival + waiting timer per pickup point) ------------------
CREATE TABLE trip_stop (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  trip_id        uuid        NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  route_stop_id  uuid REFERENCES route_stop(id) ON DELETE SET NULL,
  seq            int         NOT NULL DEFAULT 0,
  name           text,                                    -- area name shown to driver
  status         text        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','arrived','departed','skipped')),
  arrived_by     text        CHECK (arrived_by IS NULL OR arrived_by IN ('gps','driver')),
  arrived_at     timestamptz,
  wait_seconds   int         CHECK (wait_seconds IS NULL OR wait_seconds >= 0),
  departs_at     timestamptz,                             -- arrived_at + wait_seconds
  departed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_trip_stop_seq UNIQUE (trip_id, seq)
);
CREATE INDEX ix_trip_stop_trip ON trip_stop(tenant_id, trip_id, seq);
SELECT attach_standard_triggers('trip_stop');

-- ---- Passenger manifest (replaces seat reservation) ------------------------
CREATE TABLE trip_passenger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  trip_id       uuid        NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  trip_stop_id  uuid REFERENCES trip_stop(id) ON DELETE SET NULL,
  employee_id   uuid        NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  -- daily-commute attendance, NOT a reserved seat:
  status        text        NOT NULL DEFAULT 'expected'
                   CHECK (status IN ('expected','on_the_way','boarded','no_show','excused','on_leave','removed')),
  on_the_way_at timestamptz,
  boarded_at    timestamptz,
  note          text,
  updated_by    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_trip_passenger UNIQUE (trip_id, employee_id)
);
CREATE INDEX ix_trip_passenger_trip ON trip_passenger(tenant_id, trip_id, status);
CREATE INDEX ix_trip_passenger_emp  ON trip_passenger(tenant_id, employee_id);
SELECT attach_standard_triggers('trip_passenger');

-- ---- Trip rating (driver / cleanliness / A-C / punctuality) ----------------
CREATE TABLE trip_rating (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  trip_id           uuid        NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  employee_id       uuid        NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  driver_id         uuid REFERENCES driver(id) ON DELETE SET NULL,
  rate_driver       int CHECK (rate_driver      IS NULL OR rate_driver      BETWEEN 1 AND 5),
  rate_cleanliness  int CHECK (rate_cleanliness IS NULL OR rate_cleanliness BETWEEN 1 AND 5),
  rate_ac           int CHECK (rate_ac          IS NULL OR rate_ac          BETWEEN 1 AND 5),
  rate_punctuality  int CHECK (rate_punctuality IS NULL OR rate_punctuality BETWEEN 1 AND 5),
  comment           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_trip_rating UNIQUE (trip_id, employee_id)
);
CREATE INDEX ix_trip_rating_driver ON trip_rating(tenant_id, driver_id);

-- ---- Lost & found ----------------------------------------------------------
CREATE TABLE lost_item (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  trip_id      uuid REFERENCES trip(id) ON DELETE SET NULL,
  employee_id  uuid        NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  driver_id    uuid REFERENCES driver(id) ON DELETE SET NULL,
  description  text        NOT NULL,
  status       text        NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','found','returned','closed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_lost_item_status ON lost_item(tenant_id, status, created_at DESC);
SELECT attach_standard_triggers('lost_item');

-- ---- Reporting views -------------------------------------------------------
CREATE VIEW v_employee_trip_stats WITH (security_invoker = true) AS
SELECT tp.tenant_id, tp.employee_id, e.full_name,
       count(*)::int                                          AS trips,
       count(*) FILTER (WHERE tp.status='boarded')::int       AS boarded,
       count(*) FILTER (WHERE tp.status='no_show')::int       AS no_shows,
       count(*) FILTER (WHERE tp.status IN ('excused','on_leave'))::int AS excused,
       max(t.service_date)                                    AS last_trip
FROM trip_passenger tp
JOIN employee e ON e.id = tp.employee_id
JOIN trip t     ON t.id = tp.trip_id
GROUP BY tp.tenant_id, tp.employee_id, e.full_name;

CREATE VIEW v_vehicle_stats WITH (security_invoker = true) AS
SELECT v.tenant_id, v.id AS vehicle_id, v.plate_no, v.status,
       count(DISTINCT a.trip_id)::int                                   AS trips,
       count(*) FILTER (WHERE tp.status='boarded')::int                 AS passengers,
       max(t.service_date)                                              AS last_used
FROM vehicle v
LEFT JOIN assignment a ON a.vehicle_id = v.id
LEFT JOIN trip t       ON t.id = a.trip_id
LEFT JOIN trip_passenger tp ON tp.trip_id = t.id
GROUP BY v.tenant_id, v.id, v.plate_no, v.status;

-- ---- RLS (tenant isolation) ------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_transport_policy','trip_stop','trip_passenger','trip_rating','lost_item'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    $f$, t);
  END LOOP;
END $$;
