-- =============================================================================
-- ETMS — V0008: Costing & Finance (trip cost, vendor invoices, reconciliation)
-- =============================================================================

CREATE TABLE trip_cost (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  trip_id        uuid        NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  rate_card_id   uuid REFERENCES rate_card(id) ON DELETE SET NULL,
  vendor_id      uuid REFERENCES vendor(id) ON DELETE SET NULL,
  distance_km    numeric(10,2) CHECK (distance_km IS NULL OR distance_km >= 0),
  seats          int         CHECK (seats IS NULL OR seats >= 0),
  amount         numeric(14,4) NOT NULL CHECK (amount >= 0),
  currency_code  char(3)     NOT NULL DEFAULT 'KWD' CHECK (currency_code ~ '^[A-Z]{3}$'),
  cost_center_id uuid REFERENCES cost_center(id) ON DELETE SET NULL,
  breakdown      jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- reproducible calc inputs
  computed_at    timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_trip_cost UNIQUE (trip_id)
);
CREATE INDEX ix_trip_cost_period ON trip_cost(tenant_id, computed_at);
CREATE INDEX ix_trip_cost_cc     ON trip_cost(tenant_id, cost_center_id);
CREATE INDEX ix_trip_cost_vendor ON trip_cost(tenant_id, vendor_id);
SELECT attach_standard_triggers('trip_cost');

-- Split a trip cost across multiple cost-centers when riders differ
CREATE TABLE trip_cost_allocation (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  trip_cost_id   uuid        NOT NULL REFERENCES trip_cost(id) ON DELETE CASCADE,
  cost_center_id uuid REFERENCES cost_center(id) ON DELETE SET NULL,
  amount         numeric(14,4) NOT NULL CHECK (amount >= 0),
  weight         numeric(6,4)  CHECK (weight IS NULL OR (weight >= 0 AND weight <= 1)),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_cost_alloc_cc ON trip_cost_allocation(tenant_id, cost_center_id);

CREATE TABLE vendor_invoice (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  vendor_id     uuid        NOT NULL REFERENCES vendor(id) ON DELETE CASCADE,
  invoice_no    text        NOT NULL,
  period_start  date,
  period_end    date,
  total_amount  numeric(14,4) CHECK (total_amount IS NULL OR total_amount >= 0),
  currency_code char(3)     NOT NULL DEFAULT 'KWD' CHECK (currency_code ~ '^[A-Z]{3}$'),
  status        text        NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received','reconciled','disputed','approved','paid')),
  file_url      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_vendor_invoice UNIQUE (tenant_id, vendor_id, invoice_no),
  CONSTRAINT ck_invoice_period CHECK (period_end IS NULL OR period_start IS NULL
                                      OR period_end >= period_start)
);
CREATE INDEX ix_vendor_invoice_status ON vendor_invoice(tenant_id, status, created_at DESC);
SELECT attach_standard_triggers('vendor_invoice');

CREATE TABLE invoice_line (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  invoice_id   uuid        NOT NULL REFERENCES vendor_invoice(id) ON DELETE CASCADE,
  trip_cost_id uuid REFERENCES trip_cost(id) ON DELETE SET NULL,
  description  text,
  amount       numeric(14,4) NOT NULL CHECK (amount >= 0),
  recon_status text        NOT NULL DEFAULT 'unmatched'
                 CHECK (recon_status IN ('matched','variance','unmatched','disputed')),
  variance     numeric(14,4),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_invoice_line_invoice ON invoice_line(tenant_id, invoice_id);
CREATE INDEX ix_invoice_line_recon   ON invoice_line(tenant_id, recon_status);
SELECT attach_standard_triggers('invoice_line');

-- Outbound ERP/SAP postings (idempotent, retried)
CREATE TABLE erp_export (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  period_start   date        NOT NULL,
  period_end     date        NOT NULL,
  format         text        NOT NULL CHECK (format IN ('sap_idoc','csv','xlsx','json')),
  idempotency_key text       NOT NULL,
  status         text        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','posted','failed')),
  posted_at      timestamptz,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_erp_export UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX ix_erp_export_status ON erp_export(tenant_id, status);
SELECT attach_standard_triggers('erp_export');
