-- =============================================================================
-- ETMS — V0023: Super-Admin platform layer (cross-tenant).
--
-- Super-Admin duties — provisioning companies, managing subscriptions/plans, and
-- toggling per-tenant feature flags — are CROSS-TENANT and therefore live OUTSIDE
-- the per-request tenant RLS context the rest of the API uses. The platform API
-- connects as the `etms_platform` role (NOLOGIN, BYPASSRLS — created in V0011)
-- via a dedicated LOGIN role, kept separate from the tenant app role for safety.
--
-- This migration adds the platform's own tables:
--   * platform_admin  — the platform operators (NOT tenant users); deliberately
--                       hidden from the tenant app role (`etms_app`).
--   * tenant_feature  — per-tenant feature flags (tenant-scoped, RLS: a company
--                       may read its own; only the platform writes across all).
--   * platform_event  — an append-only audit of platform actions.
-- =============================================================================

-- ---- Platform operators (cross-tenant; NOT tenant users) -------------------
-- No tenant_id and no RLS: these rows are not owned by any company. They are
-- reachable only through the platform DB role; the tenant app role is denied.
CREATE TABLE platform_admin (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext      NOT NULL UNIQUE,
  full_name     text        NOT NULL,
  password_hash text,
  status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  mfa_enabled   boolean     NOT NULL DEFAULT false,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Only the updated_at trigger — the generic audit trigger requires a tenant_id
-- column (see audit_row), which platform_admin deliberately does not have.
CREATE TRIGGER trg_platform_admin_updated BEFORE UPDATE ON platform_admin
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- Per-tenant feature flags ----------------------------------------------
-- Tenant-scoped so a company can read its own flags through the normal API, but
-- only the platform (BYPASSRLS) may write them across companies.
CREATE TABLE tenant_feature (
  tenant_id  uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  feature    text        NOT NULL,
  enabled    boolean     NOT NULL DEFAULT true,
  config     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, feature)
);
CREATE TRIGGER trg_tenant_feature_updated BEFORE UPDATE ON tenant_feature
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE tenant_feature ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_feature FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_feature
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ---- Append-only platform audit --------------------------------------------
-- Records who did what to which company (create / suspend / activate /
-- subscription / feature). No RLS: platform-only, never exposed to tenants.
CREATE TABLE platform_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid        REFERENCES platform_admin(id) ON DELETE SET NULL,
  action      text        NOT NULL,
  tenant_id   uuid        REFERENCES tenant(id) ON DELETE SET NULL,
  detail      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_platform_event_tenant ON platform_event(tenant_id, created_at DESC);

-- ---- Grants ----------------------------------------------------------------
-- The platform DB role owns these tables operationally.
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_admin, tenant_feature, platform_event
  TO etms_platform;

-- tenant_feature is a tenant-scoped table: the tenant app role reads/writes its
-- own rows under RLS (e.g. the API checking whether a feature is enabled).
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_feature TO etms_app;
GRANT SELECT ON tenant_feature TO etms_readonly;

-- The platform operator table (password hashes of platform staff) must NOT be
-- reachable by the tenant app role, even though it has no tenant_id. New tables
-- inherit ALTER DEFAULT PRIVILEGES grants to etms_app (V0011), so revoke here.
REVOKE ALL ON platform_admin, platform_event FROM etms_app, etms_readonly;
