-- =============================================================================
-- ETMS — V0029: Fuel & traffic violations. Per-vehicle fuel fill log (liters,
-- cost, odometer) and a traffic-violation register (fine amount, status,
-- optional driver deduction), plus reporting views for the fuel/violations
-- report screens.
-- =============================================================================

-- ---- New permissions -------------------------------------------------------
INSERT INTO permission(code, description) VALUES
  ('fuel.create',      'Record a fuel fill (driver or ops)'),
  ('fuel.read',        'View fuel logs'),
  ('fuel.manage',      'Edit / delete fuel logs'),
  ('violation.create', 'Register a traffic violation'),
  ('violation.read',   'View traffic violations'),
  ('violation.manage', 'Update / resolve traffic violations')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY[
  'fuel.create','fuel.read','fuel.manage','violation.create','violation.read','violation.manage'])
WHERE r.code='company_admin' AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY[
  'fuel.create','fuel.read','fuel.manage','violation.create','violation.read','violation.manage'])
WHERE r.code IN ('ops_manager','dispatcher') AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

-- Drivers record their own fills and can see their own violations.
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY['fuel.create','violation.read'])
WHERE r.code='driver' AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

-- ---- Fuel log ---------------------------------------------------------------
CREATE TABLE fuel_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  vehicle_id    uuid        NOT NULL REFERENCES vehicle(id) ON DELETE CASCADE,
  driver_id     uuid REFERENCES driver(id) ON DELETE SET NULL,
  filled_at     timestamptz NOT NULL DEFAULT now(),
  fuel_type     text        NOT NULL DEFAULT 'petrol_91'
                  CHECK (fuel_type IN ('petrol_91','petrol_95','diesel')),
  liters        numeric(10,3)  NOT NULL CHECK (liters > 0),
  cost_amount   numeric(14,3)  NOT NULL CHECK (cost_amount >= 0),
  currency_code char(3)     NOT NULL DEFAULT 'KWD' CHECK (currency_code ~ '^[A-Z]{3}$'),
  odometer_km   int         CHECK (odometer_km IS NULL OR odometer_km >= 0),
  station       text,
  receipt_url   text,
  notes         text,
  created_by    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX ix_fuel_log_vehicle ON fuel_log(tenant_id, vehicle_id, filled_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_fuel_log_driver  ON fuel_log(tenant_id, driver_id,  filled_at DESC) WHERE deleted_at IS NULL;
SELECT attach_standard_triggers('fuel_log');

-- ---- Traffic violations -----------------------------------------------------
CREATE TABLE traffic_violation (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  vehicle_id     uuid        NOT NULL REFERENCES vehicle(id) ON DELETE CASCADE,
  driver_id      uuid REFERENCES driver(id) ON DELETE SET NULL,
  trip_id        uuid REFERENCES trip(id)   ON DELETE SET NULL,
  violation_no   text,                                     -- MOI ticket / reference number
  violation_type text        NOT NULL DEFAULT 'other'
                   CHECK (violation_type IN ('speeding','parking','red_light','phone_use',
                                             'seat_belt','lane','overload','documents','other')),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  location       text,
  amount         numeric(14,3) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency_code  char(3)     NOT NULL DEFAULT 'KWD' CHECK (currency_code ~ '^[A-Z]{3}$'),
  status         text        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','paid','disputed','waived','deducted')),
  paid_at        timestamptz,
  deduct_from_driver boolean NOT NULL DEFAULT false,       -- charge back to the driver
  notes          text,
  created_by     uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
-- The same MOI ticket number cannot be registered twice within a tenant.
CREATE UNIQUE INDEX uq_violation_no ON traffic_violation(tenant_id, violation_no)
  WHERE violation_no IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_violation_vehicle ON traffic_violation(tenant_id, vehicle_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_violation_driver  ON traffic_violation(tenant_id, driver_id,  occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_violation_status  ON traffic_violation(tenant_id, status) WHERE deleted_at IS NULL;
SELECT attach_standard_triggers('traffic_violation');

-- ---- Reporting views -------------------------------------------------------
-- Monthly fuel per vehicle: fills, liters, cost, km driven (odometer span) and
-- km per liter for the consumption report.
CREATE VIEW v_fuel_monthly WITH (security_invoker = true) AS
SELECT fl.tenant_id,
       date_trunc('month', fl.filled_at)::date              AS month,
       fl.vehicle_id, v.plate_no,
       count(*)::int                                        AS fills,
       sum(fl.liters)                                       AS liters,
       sum(fl.cost_amount)                                  AS cost,
       max(fl.odometer_km) - min(fl.odometer_km)            AS km,
       CASE WHEN sum(fl.liters) > 0 AND max(fl.odometer_km) > min(fl.odometer_km)
            THEN round((max(fl.odometer_km) - min(fl.odometer_km)) / sum(fl.liters), 2)
       END                                                  AS km_per_liter
FROM fuel_log fl
JOIN vehicle v ON v.id = fl.vehicle_id
WHERE fl.deleted_at IS NULL
GROUP BY fl.tenant_id, date_trunc('month', fl.filled_at), fl.vehicle_id, v.plate_no;

-- Violations per driver for the violations report and driver history.
CREATE VIEW v_violation_driver_stats WITH (security_invoker = true) AS
SELECT tv.tenant_id, tv.driver_id, d.full_name,
       count(*)::int                                               AS violations,
       count(*) FILTER (WHERE tv.status = 'pending')::int          AS pending,
       sum(tv.amount)                                              AS total_amount,
       sum(tv.amount) FILTER (WHERE tv.status IN ('pending','disputed')) AS unpaid_amount,
       max(tv.occurred_at)                                         AS last_violation
FROM traffic_violation tv
JOIN driver d ON d.id = tv.driver_id
WHERE tv.deleted_at IS NULL
GROUP BY tv.tenant_id, tv.driver_id, d.full_name;

-- ---- RLS (tenant isolation) ------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fuel_log','traffic_violation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    $f$, t);
  END LOOP;
END $$;
