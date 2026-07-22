-- =============================================================================
-- ETMS — V0020: Ride requests (staff pickup → offer to driver(s) → claim → seat).
-- Staff set a pickup (fixed / temporary / per-request), leave a request for a
-- specific driver or broadcast it to all available drivers; the first driver to
-- claim it gets the rider added to that trip's seats. RLS + triggers as usual.
-- =============================================================================

-- ---- New permissions -------------------------------------------------------
INSERT INTO permission(code, description) VALUES
  ('ride_request.create',     'Create a ride request (rider / staff)'),
  ('ride_request.read',       'View ride requests'),
  ('ride_request.claim',      'Driver claims an offered ride request'),
  ('ride_request.manage_any', 'Assign / cancel any ride request')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY[
  'ride_request.create','ride_request.read','ride_request.claim','ride_request.manage_any'])
WHERE r.code = 'company_admin' AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY['ride_request.create','ride_request.read'])
WHERE r.code = 'rider' AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY['ride_request.read','ride_request.claim'])
WHERE r.code = 'driver' AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY['ride_request.read','ride_request.manage_any'])
WHERE r.code IN ('dispatcher','ops_manager') AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

-- ---- Staff saved pickup (fixed / temporary) --------------------------------
CREATE TABLE employee_pickup (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id uuid        NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  mode        text        NOT NULL CHECK (mode IN ('fixed','temporary')),
  label       text,
  address     text,
  location    geography(Point,4326),
  valid_until date,                          -- for 'temporary'
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_employee_pickup UNIQUE (tenant_id, employee_id)
);
SELECT attach_standard_triggers('employee_pickup');

-- ---- Ride requests ---------------------------------------------------------
CREATE TABLE ride_request (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id          uuid        NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  direction            text        NOT NULL CHECK (direction IN ('inbound','outbound')),
  service_date         date        NOT NULL,
  requested_time       time,
  pickup_mode          text        NOT NULL CHECK (pickup_mode IN ('fixed','temporary','per_request')),
  pickup_label         text,
  pickup_address       text,
  pickup_location      geography(Point,4326),
  target_driver_id     uuid REFERENCES driver(id) ON DELETE SET NULL,  -- NULL = broadcast to all
  status               text        NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','assigned','cancelled','expired')),
  claimed_by_driver_id uuid REFERENCES driver(id) ON DELETE SET NULL,
  trip_id              uuid REFERENCES trip(id) ON DELETE SET NULL,
  seat_allocation_id   uuid REFERENCES seat_allocation(id) ON DELETE SET NULL,
  claimed_at           timestamptz,
  created_by           uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ride_request_open   ON ride_request(tenant_id, service_date, status);
CREATE INDEX ix_ride_request_emp    ON ride_request(tenant_id, employee_id, service_date);
CREATE INDEX ix_ride_request_driver ON ride_request(tenant_id, claimed_by_driver_id);
SELECT attach_standard_triggers('ride_request');

-- ---- Which drivers a request was offered to (broadcast or targeted) ---------
CREATE TABLE ride_request_offer (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  request_id  uuid        NOT NULL REFERENCES ride_request(id) ON DELETE CASCADE,
  driver_id   uuid        NOT NULL REFERENCES driver(id) ON DELETE CASCADE,
  notified_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ride_offer UNIQUE (request_id, driver_id)
);
CREATE INDEX ix_ride_offer_driver ON ride_request_offer(tenant_id, driver_id);

-- ---- RLS (tenant isolation) ------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employee_pickup','ride_request','ride_request_offer'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    $f$, t);
  END LOOP;
END $$;
