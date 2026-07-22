-- =============================================================================
-- ETMS — V0019: Self-registration by employee number (+ selfie + OTP + review),
-- unified company locations (branches / shops) with codes, and driver daily
-- route plans (zones + time window). New tenant tables get RLS + triggers;
-- new permissions are granted to the system role templates (incl. company_admin).
-- =============================================================================

-- ---- New permissions -------------------------------------------------------
INSERT INTO permission(code, description) VALUES
  ('roster.manage',       'Upload / manage the HR roster used for self-registration'),
  ('registration.review', 'Review & approve/reject self-registration requests'),
  ('location.read',       'View company locations (branches / shops)'),
  ('location.manage',     'Manage company locations (branches / shops)'),
  ('route_plan.read',     'View driver daily route plans'),
  ('route_plan.propose',  'Driver proposes their own daily route plan'),
  ('route_plan.approve',  'Approve / reject driver daily route plans')
ON CONFLICT (code) DO NOTHING;

-- Grant to system role templates (tenant_id IS NULL). company_admin gets all new
-- ones so a re-seed clones them into each tenant's admin role.
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY[
  'roster.manage','registration.review','location.read','location.manage',
  'route_plan.read','route_plan.propose','route_plan.approve'])
WHERE r.code = 'company_admin' AND r.tenant_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY[
  'roster.manage','registration.review','location.read','location.manage','route_plan.read'])
WHERE r.code = 'hr_admin' AND r.tenant_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY[
  'registration.review','location.read','location.manage','route_plan.read','route_plan.approve'])
WHERE r.code = 'ops_manager' AND r.tenant_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY[
  'location.read','route_plan.read','route_plan.approve'])
WHERE r.code = 'dispatcher' AND r.tenant_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY[
  'route_plan.read','route_plan.propose','location.read'])
WHERE r.code = 'driver' AND r.tenant_id IS NULL
ON CONFLICT DO NOTHING;

-- ---- HR roster (identity source for self-registration) ---------------------
-- HR uploads this file; a person self-registers by matching their employee_no.
CREATE TABLE hr_roster (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_no        text        NOT NULL,
  full_name          text        NOT NULL,
  kind               text        NOT NULL CHECK (kind IN ('driver','staff','rider')),
  phone              text        CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{6,15}$'),
  email              citext,
  photo_ref          text,                     -- reference selfie from HR (for AI match later)
  department         text,
  status             text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  registered_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,  -- set once claimed
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hr_roster UNIQUE (tenant_id, employee_no),
  CONSTRAINT ck_hr_roster_contact CHECK (phone IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX ix_hr_roster_lookup ON hr_roster(tenant_id, employee_no) WHERE status='active';
SELECT attach_standard_triggers('hr_roster');

-- ---- Self-registration requests --------------------------------------------
CREATE TABLE registration_request (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  roster_id        uuid REFERENCES hr_roster(id) ON DELETE SET NULL,
  employee_no      text        NOT NULL,
  channel          text        CHECK (channel IN ('sms','email')),
  contact          text,                       -- destination the OTP was sent to
  photo_ref        text,                       -- submitted selfie reference (verification)
  password_hash    text,                       -- the password the registrant chose (scrypt); moved to app_user on approval
  otp_hash         text,                       -- HMAC of the code (never store plaintext)
  otp_expires_at   timestamptz,
  otp_attempts     int         NOT NULL DEFAULT 0 CHECK (otp_attempts >= 0),
  otp_verified_at  timestamptz,
  face_match_score numeric(4,3),               -- from FaceMatchPort when enabled (else null)
  status           text        NOT NULL DEFAULT 'pending_otp'
                     CHECK (status IN ('pending_otp','pending_review','approved','rejected','expired')),
  review_note      text,
  reviewed_by      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_user_id  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_registration_status ON registration_request(tenant_id, status, created_at DESC);
CREATE INDEX ix_registration_emp    ON registration_request(tenant_id, employee_no);
-- One live (not-yet-terminal) request per employee_no.
CREATE UNIQUE INDEX uq_registration_live ON registration_request(tenant_id, employee_no)
  WHERE status IN ('pending_otp','pending_review');
SELECT attach_standard_triggers('registration_request');

-- ---- Unified company locations (branches / shops) with codes ---------------
-- Residences already live in `residence` (V0016, weighted routing). This registry
-- covers the company's branches (أفرع) and shops (محلات) with their codes.
CREATE TABLE company_location (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  kind            text        NOT NULL CHECK (kind IN ('branch','shop')),
  code            text,
  name            text        NOT NULL,
  address         text,
  location        geography(Point,4326),
  geofence        geography(Polygon,4326),
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE UNIQUE INDEX uq_company_location_code ON company_location(tenant_id, kind, code)
  WHERE code IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_company_location_loc ON company_location USING gist (location);
SELECT attach_standard_triggers('company_location');

-- ---- Driver daily route plans (zones + time window) ------------------------
CREATE TABLE driver_route_plan (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  driver_id     uuid        NOT NULL REFERENCES driver(id) ON DELETE CASCADE,
  service_date  date        NOT NULL,
  window_start  time        NOT NULL,
  window_end    time        NOT NULL,
  status        text        NOT NULL DEFAULT 'proposed'
                  CHECK (status IN ('proposed','approved','rejected','cancelled')),
  note          text,
  reviewed_by   uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_driver_plan   UNIQUE (tenant_id, driver_id, service_date),
  CONSTRAINT ck_plan_window   CHECK (window_end > window_start)
);
CREATE INDEX ix_driver_plan_date ON driver_route_plan(tenant_id, service_date, status);
SELECT attach_standard_triggers('driver_route_plan');

-- Zones (areas) the driver picked for that day — child of the plan.
CREATE TABLE driver_route_plan_zone (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  plan_id     uuid NOT NULL REFERENCES driver_route_plan(id) ON DELETE CASCADE,
  zone_id     uuid NOT NULL REFERENCES zone(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_plan_zone UNIQUE (plan_id, zone_id)
);
CREATE INDEX ix_plan_zone_plan ON driver_route_plan_zone(tenant_id, plan_id);

-- ---- RLS (tenant isolation) for all new tables -----------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hr_roster','registration_request','company_location',
                           'driver_route_plan','driver_route_plan_zone'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    $f$, t);
  END LOOP;
END $$;

-- ---- Pre-auth tenant resolver (self-registration runs before login) --------
-- SECURITY DEFINER so the RLS-bound app role can turn a public tenant slug into
-- an id before any tenant context exists (mirrors the auth_* functions, V0014).
CREATE OR REPLACE FUNCTION reg_tenant_id(p_slug text) RETURNS uuid
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT id FROM tenant WHERE slug = p_slug AND status <> 'deleted'
$$;
REVOKE ALL ON FUNCTION reg_tenant_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reg_tenant_id(text) TO etms_app;
