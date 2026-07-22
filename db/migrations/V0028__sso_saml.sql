-- =============================================================================
-- ETMS — V0028: Per-tenant SSO via SAML 2.0 (SP-initiated, HTTP-POST binding).
--
-- Complements OIDC (V0027) for enterprises that federate with SAML (ADFS, older
-- Okta/Entra SAML apps, Shibboleth). We act as the Service Provider: build an
-- AuthnRequest, and validate the signed SAMLResponse the IdP posts back — the
-- XML-DSig signature verification is done by the vetted @node-saml/node-saml
-- library (never hand-rolled). On success the assertion's email is matched to an
-- existing user and our normal session is minted.
-- =============================================================================

CREATE TABLE tenant_saml (
  tenant_id             uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  sp_entity_id          text        NOT NULL,           -- our SP entity id (issuer + audience)
  idp_entry_point       text        NOT NULL,           -- IdP SSO URL (where AuthnRequest goes)
  idp_cert              text        NOT NULL,           -- IdP signing certificate (PEM, base64 body)
  callback_url          text        NOT NULL,           -- our ACS URL, registered at the IdP
  idp_issuer            text,                            -- expected <Issuer> in the response (optional)
  enabled               boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_tenant_saml_updated BEFORE UPDATE ON tenant_saml
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE tenant_saml ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_saml FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_saml
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Pre-auth config lookup (login/ACS run before a tenant context — like auth_lookup).
CREATE OR REPLACE FUNCTION saml_config(p_slug citext)
  RETURNS TABLE(tenant_id uuid, sp_entity_id text, idp_entry_point text, idp_cert text,
                callback_url text, idp_issuer text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT s.tenant_id, s.sp_entity_id, s.idp_entry_point, s.idp_cert, s.callback_url, s.idp_issuer
    FROM tenant_saml s
    JOIN tenant t ON t.id = s.tenant_id
    WHERE t.slug = p_slug AND s.enabled AND t.status = 'active'
    LIMIT 1;
  $$;
REVOKE ALL ON FUNCTION saml_config(citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION saml_config(citext) TO etms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_saml TO etms_app;
