-- =============================================================================
-- ETMS — V0002: Identity, Access, RBAC + ABAC
-- =============================================================================

CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  email         citext,
  phone         text        CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{6,15}$'),
  full_name     text        NOT NULL,
  status        text        NOT NULL DEFAULT 'invited'
                  CHECK (status IN ('invited','active','disabled')),
  mfa_enabled   boolean     NOT NULL DEFAULT false,
  password_hash text,                                  -- NULL when SSO-only (Argon2id)
  locale        text        NOT NULL DEFAULT 'ar',
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT ck_user_contact CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
-- Case-insensitive uniqueness, ignoring soft-deleted rows
CREATE UNIQUE INDEX uq_user_email ON app_user(tenant_id, email)
  WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_user_phone ON app_user(tenant_id, phone)
  WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_user_name_trgm ON app_user USING gin (full_name gin_trgm_ops);
SELECT attach_standard_triggers('app_user');

-- Roles: tenant_id NULL => system template role, cloneable by tenants.
CREATE TABLE role (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid REFERENCES tenant(id) ON DELETE CASCADE,   -- NULL = system
  code       text        NOT NULL,
  name       text        NOT NULL,
  description text,
  is_system  boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Unique per tenant; system roles unique globally (tenant_id IS NULL)
CREATE UNIQUE INDEX uq_role_tenant_code ON role(tenant_id, code)
  WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX uq_role_system_code ON role(code)
  WHERE tenant_id IS NULL;
CREATE TRIGGER trg_role_updated BEFORE UPDATE ON role
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Global permission catalog (resource.action)
CREATE TABLE permission (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+(\.[a-z_*]+)+$'),
  description text
);

CREATE TABLE role_permission (
  role_id       uuid NOT NULL REFERENCES role(id)       ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX ix_role_permission_perm ON role_permission(permission_id);

-- User ↔ Role with ABAC scope (empty arrays => tenant-wide)
CREATE TABLE user_role (
  tenant_id             uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id               uuid NOT NULL REFERENCES role(id)     ON DELETE CASCADE,
  scope_site_ids        uuid[] NOT NULL DEFAULT '{}',
  scope_cost_center_ids uuid[] NOT NULL DEFAULT '{}',
  granted_by            uuid REFERENCES app_user(id),
  granted_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX ix_user_role_tenant ON user_role(tenant_id);
CREATE INDEX ix_user_role_role   ON user_role(role_id);

-- Sessions / refresh tokens (device management + revocation)
CREATE TABLE user_session (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  device_id          text,
  device_name        text,
  refresh_token_hash text        NOT NULL,
  ip                 inet,
  user_agent         text,
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz
);
CREATE INDEX ix_session_user   ON user_session(user_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_session_expiry ON user_session(expires_at);

-- MFA / OTP factors
CREATE TABLE user_mfa_factor (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('totp','sms','email')),
  secret_enc  text,                      -- KMS-encrypted
  confirmed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_mfa_user ON user_mfa_factor(user_id);

-- Federated identities (SSO / OIDC / SAML) for JIT provisioning
CREATE TABLE user_identity (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  provider     text NOT NULL,            -- 'azure-ad','okta','google',...
  subject      text NOT NULL,            -- IdP 'sub'
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_identity UNIQUE (tenant_id, provider, subject)
);
