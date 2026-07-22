-- =============================================================================
-- ETMS — V0006: Booking, Dispatch, Trip lifecycle
-- =============================================================================

CREATE TABLE trip (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  route_id      uuid REFERENCES route(id) ON DELETE SET NULL,
  shift_id      uuid REFERENCES shift(id) ON DELETE SET NULL,
  site_id       uuid REFERENCES site(id)  ON DELETE SET NULL,
  service_date  date        NOT NULL,
  direction     text        NOT NULL CHECK (direction IN ('inbound','outbound')),
  planned_start timestamptz,
  planned_end   timestamptz,
  actual_start  timestamptz,
  actual_end    timestamptz,
  status        text        NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','assigned','started','in_progress',
                                    'completed','cancelled','exception')),
  capacity      int         CHECK (capacity IS NULL OR capacity >= 0),
  seats_taken   int         NOT NULL DEFAULT 0 CHECK (seats_taken >= 0),
  cancel_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_trip_capacity CHECK (capacity IS NULL OR seats_taken <= capacity),
  CONSTRAINT ck_trip_times    CHECK (actual_end IS NULL OR actual_start IS NULL
                                     OR actual_end >= actual_start)
);
CREATE INDEX ix_trip_lookup   ON trip(tenant_id, service_date, status);
CREATE INDEX ix_trip_route    ON trip(tenant_id, route_id, service_date);
CREATE INDEX ix_trip_site     ON trip(tenant_id, site_id, service_date, direction);
-- One generated trip per route/date/direction
CREATE UNIQUE INDEX uq_trip_generated
  ON trip(route_id, service_date, direction) WHERE route_id IS NOT NULL;
SELECT attach_standard_triggers('trip');

-- Dispatch: one vehicle + driver per trip
CREATE TABLE assignment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  trip_id     uuid        NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  vehicle_id  uuid REFERENCES vehicle(id) ON DELETE SET NULL,
  driver_id   uuid REFERENCES driver(id)  ON DELETE SET NULL,
  assigned_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_assignment_trip UNIQUE (trip_id)
);
CREATE INDEX ix_assignment_vehicle ON assignment(tenant_id, vehicle_id, assigned_at);
CREATE INDEX ix_assignment_driver  ON assignment(tenant_id, driver_id, assigned_at);
SELECT attach_standard_triggers('assignment');

-- Rider bookings
CREATE TABLE booking (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id    uuid        NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  service_date   date        NOT NULL,
  shift_id       uuid REFERENCES shift(id) ON DELETE SET NULL,
  direction      text        NOT NULL CHECK (direction IN ('inbound','outbound')),
  status         text        NOT NULL DEFAULT 'requested'
                   CHECK (status IN ('requested','confirmed','waitlisted',
                                     'cancelled','no_show','completed')),
  recurring_rule text,                       -- RRULE for recurring bookings
  waitlist_pos   int         CHECK (waitlist_pos IS NULL OR waitlist_pos >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- One live booking per employee/date/shift/direction
  CONSTRAINT uq_booking UNIQUE (tenant_id, employee_id, service_date, shift_id, direction)
);
CREATE INDEX ix_booking_date  ON booking(tenant_id, service_date, shift_id, status);
CREATE INDEX ix_booking_emp   ON booking(tenant_id, employee_id, service_date);
SELECT attach_standard_triggers('booking');

-- Seat allocation links a rider to a specific trip/stop
CREATE TABLE seat_allocation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  trip_id       uuid        NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  booking_id    uuid REFERENCES booking(id) ON DELETE SET NULL,
  employee_id   uuid        NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  route_stop_id uuid REFERENCES route_stop(id) ON DELETE SET NULL,
  status        text        NOT NULL DEFAULT 'allocated'
                  CHECK (status IN ('allocated','boarded','dropped','no_show','cancelled')),
  boarded_at    timestamptz,
  dropped_at    timestamptz,
  proof_type    text CHECK (proof_type IS NULL OR proof_type IN ('qr','tap','photo','manual')),
  proof_ref     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_seat_alloc UNIQUE (trip_id, employee_id)
);
CREATE INDEX ix_seat_alloc_trip ON seat_allocation(tenant_id, trip_id, status);
CREATE INDEX ix_seat_alloc_emp  ON seat_allocation(tenant_id, employee_id);
SELECT attach_standard_triggers('seat_allocation');

-- Append-only trip lifecycle event log (offline-replay idempotent)
CREATE TABLE trip_event (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  trip_id         uuid        NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  event_type      text        NOT NULL
                    CHECK (event_type IN ('started','arrived_stop','pickup','dropoff',
                                          'no_show','delay','off_route','completed','cancelled')),
  actor_user_id   uuid REFERENCES app_user(id) ON DELETE SET NULL,
  route_stop_id   uuid REFERENCES route_stop(id) ON DELETE SET NULL,
  employee_id     uuid REFERENCES employee(id) ON DELETE SET NULL,
  location        geography(Point,4326),
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  client_event_id text,                       -- idempotency key from offline client
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  received_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_trip_event_client UNIQUE (trip_id, client_event_id)
);
CREATE INDEX ix_trip_event_trip ON trip_event(tenant_id, trip_id, occurred_at);
CREATE INDEX ix_trip_event_loc  ON trip_event USING gist (location);
