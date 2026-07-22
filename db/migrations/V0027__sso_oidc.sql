-- =============================================================================
-- ETMS — V0027: Per-tenant SSO (OIDC Authorization Code + PKCE).
--
-- Each company can federate login to its own OpenID Connect IdP (Azure AD /
-- Entra, Okta, Google Workspace, Keycloak, …). The API drives the standard
-- Authorization-Code-with-PKCE flow, verifies the returned id_token against the
-- IdP's JWKS, matches the email to an existing `app_user` in that tenant, and
-- mints our own session tokens. SAML is a separate future provider.
-- =============================================================================

-- ---- Per-tenant OIDC configuration -----------------------------------------
CREATE TABLE tenant_sso (
  tenant_id     uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  provider      text        NOT NULL DEFAULT 'oidc' CHECK (provider IN ('oidc')),
  issuer        text        NOT NULL,
  client_id     text        NOT NULL,
  client_secret text,                         -- confidential client (prod: KMS/vault)
  authorize_url text        NOT NULL,
  token_url     text        NOT NULL,
  jwks_url      text        NOT NULL,
  redirect_uri  text        NOT NULL,          -- our callback, registered at the IdP
  enabled       boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_tenant_sso_updated BEFORE UPDATE ON tenant_sso
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE tenant_sso ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sso FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_sso
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ---- Transient auth state (PKCE verifier + nonce), single-use --------------
-- Keyed by an unguessable `state`; no RLS (it is written and consumed BEFORE a
-- tenant/session context exists, exactly like the login bootstrap). Rows are
-- one-time (consumed on callback) and expire quickly.
CREATE TABLE sso_auth_state (
  state         text        PRIMARY KEY,
  tenant_id     uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  code_verifier text        NOT NULL,
  nonce         text        NOT NULL,
  redirect_to   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX ix_sso_state_expiry ON sso_auth_state(expires_at);

-- ---- Pre-auth config lookup (SECURITY DEFINER, like auth_lookup) -----------
-- The /authorize and /callback endpoints run before any tenant context, so they
-- read the config through this definer function rather than under RLS.
CREATE OR REPLACE FUNCTION sso_config(p_slug citext)
  RETURNS TABLE(tenant_id uuid, issuer text, client_id text, client_secret text,
                authorize_url text, token_url text, jwks_url text, redirect_uri text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT s.tenant_id, s.issuer, s.client_id, s.client_secret,
           s.authorize_url, s.token_url, s.jwks_url, s.redirect_uri
    FROM tenant_sso s
    JOIN tenant t ON t.id = s.tenant_id
    WHERE t.slug = p_slug AND s.enabled AND t.status = 'active'
    LIMIT 1;
  $$;
REVOKE ALL ON FUNCTION sso_config(citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sso_config(citext) TO etms_app;

-- New tables inherit the etms_app default grants (V0011); make it explicit.
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_sso, sso_auth_state TO etms_app;
