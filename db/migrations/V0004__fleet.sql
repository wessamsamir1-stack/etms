-- =============================================================================
-- ETMS — V0004: Fleet (vendors, vehicles, drivers, documents, rate cards)
-- =============================================================================

CREATE TABLE vendor (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  contact    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status     text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX ix_vendor_tenant ON vendor(tenant_id) WHERE deleted_at IS NULL;
SELECT attach_standard_triggers('vendor');

CREATE TABLE vehicle (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  vendor_id         uuid REFERENCES vendor(id) ON DELETE SET NULL,
  plate_no          text        NOT NULL,
  type              text        CHECK (type IS NULL OR type IN ('bus','minibus','van','sedan','suv')),
  capacity          int         NOT NULL CHECK (capacity > 0),
  status            text        NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','maintenance','retired')),
  inspection_expiry date,
  insurance_expiry  date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE UNIQUE INDEX uq_vehicle_plate ON vehicle(tenant_id, plate_no)
  WHERE deleted_at IS NULL;
CREATE INDEX ix_vehicle_tenant ON vehicle(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX ix_vehicle_vendor ON vehicle(tenant_id, vendor_id);
CREATE INDEX ix_vehicle_plate_trgm ON vehicle USING gin (plate_no gin_trgm_ops);
SELECT attach_standard_triggers('vehicle');

CREATE TABLE driver (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  vendor_id           uuid REFERENCES vendor(id) ON DELETE SET NULL,
  user_id             uuid REFERENCES app_user(id) ON DELETE SET NULL,  -- driver app login
  full_name           text        NOT NULL,
  phone               text        CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{6,15}$'),
  license_no          text,
  license_expiry      date,
  verification_status text        NOT NULL DEFAULT 'pending'
                        CHECK (verification_status IN ('pending','verified','rejected')),
  availability        text        NOT NULL DEFAULT 'available'
                        CHECK (availability IN ('available','on_trip','off_duty','suspended')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
CREATE INDEX ix_driver_tenant ON driver(tenant_id, verification_status, availability)
  WHERE deleted_at IS NULL;
CREATE INDEX ix_driver_vendor ON driver(tenant_id, vendor_id);
CREATE INDEX ix_driver_name_trgm ON driver USING gin (full_name gin_trgm_ops);
SELECT attach_standard_triggers('driver');

CREATE TABLE vehicle_document (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  vehicle_id uuid        NOT NULL REFERENCES vehicle(id) ON DELETE CASCADE,
  doc_type   text        NOT NULL,   -- registration|insurance|inspection|permit
  file_url   text,
  issued_at  date,
  expires_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_vehicle_doc_expiry ON vehicle_document(tenant_id, expires_at);
CREATE INDEX ix_vehicle_doc_vehicle ON vehicle_document(vehicle_id);
SELECT attach_standard_triggers('vehicle_document');

CREATE TABLE driver_document (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  driver_id  uuid        NOT NULL REFERENCES driver(id) ON DELETE CASCADE,
  doc_type   text        NOT NULL,   -- license|id|medical|police_clearance
  file_url   text,
  issued_at  date,
  expires_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_driver_doc_expiry ON driver_document(tenant_id, expires_at);
CREATE INDEX ix_driver_doc_driver ON driver_document(driver_id);
SELECT attach_standard_triggers('driver_document');

CREATE TABLE rate_card (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  vendor_id      uuid REFERENCES vendor(id) ON DELETE CASCADE,
  name           text        NOT NULL,
  model          text        NOT NULL
                   CHECK (model IN ('per_km','per_trip','per_seat','fixed_monthly')),
  rate           numeric(14,4) NOT NULL CHECK (rate >= 0),
  currency_code  char(3)     NOT NULL DEFAULT 'KWD' CHECK (currency_code ~ '^[A-Z]{3}$'),
  min_charge     numeric(14,4) CHECK (min_charge IS NULL OR min_charge >= 0),
  effective_from date        NOT NULL,
  effective_to   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT ck_ratecard_period CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX ix_ratecard_vendor ON rate_card(tenant_id, vendor_id, effective_from);
-- Prevent overlapping active rate cards of the same model per vendor
CREATE INDEX ix_ratecard_lookup ON rate_card(tenant_id, vendor_id, model)
  WHERE deleted_at IS NULL;
SELECT attach_standard_triggers('rate_card');
