-- =============================================================================
-- ETMS — V0007: Tracking (partitioned GPS pings) + Incidents + Geofence events
-- =============================================================================

-- High-volume GPS stream. Range-partitioned by day; PK includes partition key.
CREATE TABLE vehicle_ping (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id   uuid        NOT NULL,
  trip_id     uuid,
  vehicle_id  uuid,
  driver_id   uuid,
  location    geography(Point,4326) NOT NULL,
  speed       numeric(6,2),
  heading     numeric(5,2) CHECK (heading IS NULL OR (heading >= 0 AND heading < 360)),
  accuracy_m  numeric(6,2),
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE INDEX ix_ping_trip    ON vehicle_ping(tenant_id, trip_id, recorded_at DESC);
CREATE INDEX ix_ping_vehicle ON vehicle_ping(tenant_id, vehicle_id, recorded_at DESC);
CREATE INDEX ix_ping_loc     ON vehicle_ping USING gist (location);

-- Bootstrap partitions (production: automate with pg_partman / a nightly job)
CREATE TABLE vehicle_ping_default PARTITION OF vehicle_ping DEFAULT;
CREATE TABLE vehicle_ping_2026_07 PARTITION OF vehicle_ping
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE vehicle_ping_2026_08 PARTITION OF vehicle_ping
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- Latest-known position per vehicle (hot cache; upserted from stream)
CREATE TABLE vehicle_last_position (
  tenant_id   uuid NOT NULL,
  vehicle_id  uuid NOT NULL,
  trip_id     uuid,
  location    geography(Point,4326) NOT NULL,
  speed       numeric(6,2),
  heading     numeric(5,2),
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, vehicle_id)
);
CREATE INDEX ix_last_pos_loc ON vehicle_last_position USING gist (location);

CREATE TABLE incident (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  trip_id     uuid REFERENCES trip(id) ON DELETE SET NULL,
  type        text        NOT NULL
                CHECK (type IN ('sos','off_route','delay','breakdown','accident','other')),
  severity    text        NOT NULL DEFAULT 'high'
                CHECK (severity IN ('low','medium','high','critical')),
  raised_by   uuid REFERENCES app_user(id) ON DELETE SET NULL,
  location    geography(Point,4326),
  description text,
  status      text        NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','acknowledged','resolved','cancelled')),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_incident_open ON incident(tenant_id, status, severity, created_at DESC);
CREATE INDEX ix_incident_trip ON incident(tenant_id, trip_id);
CREATE INDEX ix_incident_loc  ON incident USING gist (location);
SELECT attach_standard_triggers('incident');

-- Geofence entry/exit events (site/zone) used for auto status updates
CREATE TABLE geofence_event (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  trip_id     uuid REFERENCES trip(id) ON DELETE CASCADE,
  vehicle_id  uuid,
  fence_type  text        NOT NULL CHECK (fence_type IN ('site','zone')),
  fence_id    uuid        NOT NULL,
  event       text        NOT NULL CHECK (event IN ('enter','exit')),
  location    geography(Point,4326),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_geofence_trip ON geofence_event(tenant_id, trip_id, occurred_at);
