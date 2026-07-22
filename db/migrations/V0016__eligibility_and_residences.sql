-- =============================================================================
-- ETMS — V0016: AI-assisted eligibility approvals + company residences
-- (design: docs/etms/11). New tenant-owned tables get RLS + standard triggers;
-- etms_app privileges come from the default-privilege grant set in V0011.
-- =============================================================================

-- ---- Company residences (weighted-priority pickup points) ------------------
CREATE TABLE residence (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  code            text,
  location        geography(Point,4326),
  geofence        geography(Polygon,4326),
  capacity        int         CHECK (capacity IS NULL OR capacity >= 0),
  priority_weight numeric(4,2) NOT NULL DEFAULT 1.0 CHECK (priority_weight >= 0),
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE UNIQUE INDEX uq_residence_code ON residence(tenant_id, code)
  WHERE code IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_residence_loc ON residence USING gist (location);
SELECT attach_standard_triggers('residence');

ALTER TABLE employee ADD COLUMN residence_id uuid REFERENCES residence(id) ON DELETE SET NULL;
CREATE INDEX ix_employee_residence ON employee(tenant_id, residence_id);

-- ---- HR violations (synced from SAP SuccessFactors) ------------------------
CREATE TABLE hr_violation (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id  uuid        NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  external_ref text,                       -- HR system record id
  type         text        NOT NULL,       -- transport_block | employment_ended (blocking); others minor
  severity     text        NOT NULL CHECK (severity IN ('minor','major','blocking')),
  status       text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','cleared')),
  effective_from date, effective_to date,
  synced_at    timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hr_violation UNIQUE (tenant_id, external_ref)
);
CREATE INDEX ix_violation_emp ON hr_violation(tenant_id, employee_id, status);

-- ---- Per-tenant eligibility policy -----------------------------------------
CREATE TABLE eligibility_policy (
  tenant_id         uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  service_radius_km numeric(6,2) NOT NULL DEFAULT 40,
  weights           jsonb        NOT NULL DEFAULT '{}'::jsonb,
  green_max         int          NOT NULL DEFAULT 20,
  amber_max         int          NOT NULL DEFAULT 60,
  auto_approve_mode text         NOT NULL DEFAULT 'shadow'
                      CHECK (auto_approve_mode IN ('shadow','live')),
  ai_enabled        boolean      NOT NULL DEFAULT false,
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_policy_bands CHECK (green_max < amber_max)
);
-- PK is tenant_id (no `id` column) → attach only updated_at, not the generic
-- audit trigger (which references NEW.id). Policy changes are audited at the app layer.
CREATE TRIGGER trg_eligibility_policy_updated BEFORE UPDATE ON eligibility_policy
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- Eligibility decisions (audit-grade) -----------------------------------
CREATE TABLE eligibility_decision (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id       uuid        NOT NULL REFERENCES employee(id),
  outcome           text        NOT NULL CHECK (outcome IN ('approved','rejected','needs_review')),
  band              text        NOT NULL CHECK (band IN ('green','amber','red')),
  decision_source   text        NOT NULL CHECK (decision_source IN ('auto_rules','human','ai_assisted')),
  risk_score        int,
  hard_gate_results jsonb       NOT NULL,
  risk_breakdown    jsonb       NOT NULL,
  ai_findings       jsonb,
  ai_model_version  text,
  decided_by        uuid REFERENCES app_user(id),   -- null when auto
  reviewed_by       uuid REFERENCES app_user(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_decision_emp ON eligibility_decision(tenant_id, employee_id, created_at DESC);
CREATE INDEX ix_decision_band ON eligibility_decision(tenant_id, band, created_at DESC);

-- ---- RLS (tenant isolation) for the new tables -----------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['residence','hr_violation','eligibility_policy','eligibility_decision'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    $f$, t);
  END LOOP;
END $$;
