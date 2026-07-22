-- =============================================================================
-- ETMS — V0018: Employee transport usage ledger + payroll/HR deduction export
-- Business rule (per Wessam): a company ride is NOT charged to the employee at
-- trip time. Instead every ride the employee actually takes is *recorded* as a
-- usage row (rides + distinct days), then handed to Accounting / HR so the
-- deduction is applied later in payroll. This file adds the ledger, a per-
-- employee monthly aggregate view, and an idempotent export batch table.
-- New tenant-owned tables get RLS + standard triggers; etms_app privileges come
-- from the default-privilege grant set in V0011.
-- =============================================================================

-- ---- Per-employee ridership ledger (append-only, one row per ride taken) ----
CREATE TABLE transport_usage (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id        uuid        NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  trip_id            uuid REFERENCES trip(id) ON DELETE SET NULL,
  seat_allocation_id uuid REFERENCES seat_allocation(id) ON DELETE SET NULL,
  service_date       date        NOT NULL,
  direction          text        NOT NULL CHECK (direction IN ('inbound','outbound')),
  source             text        NOT NULL DEFAULT 'qr'
                       CHECK (source IN ('qr','manual','auto','import')),
  boarded_at         timestamptz NOT NULL DEFAULT now(),
  -- billable = counts toward the later payroll deduction. Waived rides stay on
  -- the ledger for the audit trail but are excluded from the deduction total.
  billable           boolean     NOT NULL DEFAULT true,
  deduction_status   text        NOT NULL DEFAULT 'pending'
                       CHECK (deduction_status IN ('pending','exported','deducted','waived')),
  export_id          uuid,                    -- set when included in an export batch (FK below)
  waive_reason       text,
  note               text,
  recorded_by        uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Idempotent boarding capture: one usage per employee per trip per direction,
  -- so replaying a QR check-in (offline sync) never double-counts a ride.
  CONSTRAINT uq_transport_usage_ride UNIQUE (tenant_id, trip_id, employee_id, direction)
);
CREATE INDEX ix_transport_usage_emp    ON transport_usage(tenant_id, employee_id, service_date);
CREATE INDEX ix_transport_usage_period ON transport_usage(tenant_id, service_date, deduction_status);
CREATE INDEX ix_transport_usage_export ON transport_usage(tenant_id, export_id);
SELECT attach_standard_triggers('transport_usage');

-- ---- Payroll / HR / Accounting deduction export batch (idempotent) ---------
CREATE TABLE payroll_usage_export (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  period_start    date        NOT NULL,
  period_end      date        NOT NULL,
  target          text        NOT NULL DEFAULT 'payroll'
                    CHECK (target IN ('payroll','hr','accounting','sap_successfactors')),
  format          text        NOT NULL DEFAULT 'csv'
                    CHECK (format IN ('csv','json','sap_idoc')),
  idempotency_key text        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','posted','failed')),
  rides_count     int         NOT NULL DEFAULT 0 CHECK (rides_count >= 0),
  days_count      int         NOT NULL DEFAULT 0 CHECK (days_count >= 0),
  employees_count int         NOT NULL DEFAULT 0 CHECK (employees_count >= 0),
  content         text,                        -- rendered batch document (CSV / JSON / IDoc)
  posted_at       timestamptz,
  error           text,
  created_by      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payroll_usage_export UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT ck_payroll_usage_period CHECK (period_end >= period_start)
);
CREATE INDEX ix_payroll_usage_export_status ON payroll_usage_export(tenant_id, status, created_at DESC);
SELECT attach_standard_triggers('payroll_usage_export');

-- Link a ledger row to the batch it was exported in.
ALTER TABLE transport_usage
  ADD CONSTRAINT fk_transport_usage_export
  FOREIGN KEY (export_id) REFERENCES payroll_usage_export(id) ON DELETE SET NULL;

-- ---- Per-employee monthly aggregate (what HR/payroll deducts against) -------
-- security_invoker so the querying app role's tenant RLS is enforced through
-- the view (the view is owned by the migration/admin role, which is exempt).
CREATE VIEW v_employee_transport_usage
  WITH (security_invoker = true) AS
SELECT
  tenant_id,
  employee_id,
  date_trunc('month', service_date)::date        AS period_month,
  count(*)                                        AS rides,
  count(DISTINCT service_date)                    AS days,
  count(*) FILTER (WHERE direction = 'inbound')   AS inbound_rides,
  count(*) FILTER (WHERE direction = 'outbound')  AS outbound_rides,
  count(*) FILTER (WHERE deduction_status = 'pending')  AS pending_rides,
  count(*) FILTER (WHERE deduction_status = 'exported') AS exported_rides,
  count(*) FILTER (WHERE deduction_status = 'deducted') AS deducted_rides,
  min(service_date)                               AS first_used,
  max(service_date)                               AS last_used
FROM transport_usage
WHERE billable = true
GROUP BY tenant_id, employee_id, date_trunc('month', service_date);

-- ---- RLS (tenant isolation) for the new tables -----------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['transport_usage','payroll_usage_export'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    $f$, t);
  END LOOP;
END $$;
