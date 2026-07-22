-- =============================================================================
-- ETMS — V0001: Tenant & Billing context
-- =============================================================================

CREATE TABLE tenant (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL,
  slug             citext      NOT NULL,
  custom_domain    citext,
  status           text        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','trial','suspended','deleted')),
  region           text        NOT NULL DEFAULT 'default',
  default_locale   text        NOT NULL DEFAULT 'ar'  CHECK (default_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  default_currency char(3)     NOT NULL DEFAULT 'KWD' CHECK (default_currency ~ '^[A-Z]{3}$'),
  default_timezone text        NOT NULL DEFAULT 'Asia/Kuwait',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT uq_tenant_slug   UNIQUE (slug),
  CONSTRAINT uq_tenant_domain UNIQUE (custom_domain)
);
CREATE TRIGGER trg_tenant_updated BEFORE UPDATE ON tenant
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- White-label branding (1:1 with tenant)
CREATE TABLE tenant_branding (
  tenant_id       uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  app_name        text,
  logo_url        text,
  primary_color   text CHECK (primary_color   IS NULL OR primary_color   ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text CHECK (secondary_color IS NULL OR secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  theme_json      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_tenant_branding_updated BEFORE UPDATE ON tenant_branding
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Per-tenant free-form settings (feature flags, provider config, policies)
CREATE TABLE tenant_setting (
  tenant_id  uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  key        text        NOT NULL,
  value      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
CREATE TRIGGER trg_tenant_setting_updated BEFORE UPDATE ON tenant_setting
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE subscription (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  plan_code      text        NOT NULL
                   CHECK (plan_code IN ('starter','business','enterprise','custom')),
  seats_limit    int         CHECK (seats_limit    IS NULL OR seats_limit    >= 0),
  vehicles_limit int         CHECK (vehicles_limit IS NULL OR vehicles_limit >= 0),
  sites_limit    int         CHECK (sites_limit    IS NULL OR sites_limit    >= 0),
  status         text        NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','past_due','cancelled','expired')),
  started_at     timestamptz NOT NULL DEFAULT now(),
  ends_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_sub_period CHECK (ends_at IS NULL OR ends_at > started_at)
);
CREATE INDEX ix_subscription_tenant ON subscription(tenant_id, status);
-- Only one active subscription per tenant at a time
CREATE UNIQUE INDEX uq_subscription_active
  ON subscription(tenant_id) WHERE status = 'active';
SELECT attach_standard_triggers('subscription');

CREATE TABLE usage_record (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  metric      text        NOT NULL
                CHECK (metric IN ('trips','active_riders','sms','whatsapp','email','storage_gb','api_calls')),
  quantity    numeric(14,2) NOT NULL CHECK (quantity >= 0),
  period      date        NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_usage UNIQUE (tenant_id, metric, period)
);
CREATE INDEX ix_usage_tenant_period ON usage_record(tenant_id, period);
