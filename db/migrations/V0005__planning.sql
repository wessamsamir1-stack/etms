-- =============================================================================
-- ETMS — V0005: Planning (routes, stops, schedules)
-- =============================================================================

CREATE TABLE route (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  site_id    uuid        NOT NULL REFERENCES site(id)  ON DELETE CASCADE,
  shift_id   uuid REFERENCES shift(id) ON DELETE SET NULL,
  name       text        NOT NULL,
  direction  text        NOT NULL CHECK (direction IN ('inbound','outbound')),
  status     text        NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX ix_route_site  ON route(tenant_id, site_id, shift_id) WHERE deleted_at IS NULL;
SELECT attach_standard_triggers('route');

CREATE TABLE route_stop (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  route_id          uuid        NOT NULL REFERENCES route(id) ON DELETE CASCADE,
  seq               int         NOT NULL CHECK (seq >= 0),
  zone_id           uuid REFERENCES zone(id) ON DELETE SET NULL,
  name              text,
  location          geography(Point,4326),
  planned_offset_min int        CHECK (planned_offset_min IS NULL OR planned_offset_min >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_route_stop_seq UNIQUE (route_id, seq)
);
CREATE INDEX ix_route_stop_route ON route_stop(tenant_id, route_id);
CREATE INDEX ix_route_stop_loc   ON route_stop USING gist (location);
SELECT attach_standard_triggers('route_stop');

CREATE TABLE schedule (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  route_id   uuid        NOT NULL REFERENCES route(id) ON DELETE CASCADE,
  rrule      text        NOT NULL,                 -- iCalendar RRULE
  start_date date        NOT NULL,
  end_date   date,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_schedule_period CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX ix_schedule_route ON schedule(tenant_id, route_id) WHERE active;
SELECT attach_standard_triggers('schedule');

-- Holiday calendar suppresses trip generation for a site/tenant
CREATE TABLE holiday (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  site_id    uuid REFERENCES site(id) ON DELETE CASCADE,   -- NULL => all sites
  holiday_date date      NOT NULL,
  name       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_holiday UNIQUE (tenant_id, site_id, holiday_date)
);
CREATE INDEX ix_holiday_lookup ON holiday(tenant_id, holiday_date);
