-- =============================================================================
-- ETMS — V0003: Master Data (sites, zones, shifts, cost centers, employees)
-- =============================================================================

CREATE TABLE site (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  code       text,
  location   geography(Point,4326),
  geofence   geography(Polygon,4326),
  timezone   text        NOT NULL DEFAULT 'Asia/Kuwait',
  status     text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_site_code ON site(tenant_id, code)
  WHERE code IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_site_tenant   ON site(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_site_geofence ON site USING gist (geofence);
CREATE INDEX ix_site_location ON site USING gist (location);
SELECT attach_standard_triggers('site');

CREATE TABLE zone (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  site_id    uuid        NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  boundary   geography(Polygon,4326),
  centroid   geography(Point,4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX ix_zone_site     ON zone(tenant_id, site_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_zone_boundary ON zone USING gist (boundary);
CREATE INDEX ix_zone_centroid ON zone USING gist (centroid);
SELECT attach_standard_triggers('zone');

CREATE TABLE shift (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  site_id      uuid        NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  start_time   time        NOT NULL,
  end_time     time        NOT NULL,
  working_days int[]       NOT NULL DEFAULT '{0,1,2,3,4}',  -- 0=Sun .. 6=Sat
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CONSTRAINT ck_shift_days CHECK (
    working_days <@ ARRAY[0,1,2,3,4,5,6] AND array_length(working_days,1) >= 1)
);
CREATE INDEX ix_shift_site ON shift(tenant_id, site_id) WHERE deleted_at IS NULL;
SELECT attach_standard_triggers('shift');

CREATE TABLE cost_center (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  code       text        NOT NULL,
  name       text        NOT NULL,
  parent_id  uuid REFERENCES cost_center(id) ON DELETE SET NULL,  -- hierarchy
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_cost_center_code ON cost_center(tenant_id, code)
  WHERE deleted_at IS NULL;
SELECT attach_standard_triggers('cost_center');

CREATE TABLE employee (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES app_user(id) ON DELETE SET NULL,   -- rider login
  external_hr_id   text,                                              -- HRIS key
  full_name        text        NOT NULL,
  department       text,
  cost_center_id   uuid REFERENCES cost_center(id) ON DELETE SET NULL,
  default_site_id  uuid REFERENCES site(id)  ON DELETE SET NULL,
  default_shift_id uuid REFERENCES shift(id) ON DELETE SET NULL,
  home_location    geography(Point,4326),          -- field-encrypted PII at app layer
  home_zone_id     uuid REFERENCES zone(id) ON DELETE SET NULL,
  eligible         boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE UNIQUE INDEX uq_employee_hr ON employee(tenant_id, external_hr_id)
  WHERE external_hr_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_employee_tenant   ON employee(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_employee_zone     ON employee(tenant_id, home_zone_id);
CREATE INDEX ix_employee_cc       ON employee(tenant_id, cost_center_id);
CREATE INDEX ix_employee_name_trgm ON employee USING gin (full_name gin_trgm_ops);
SELECT attach_standard_triggers('employee');
