-- =============================================================================
-- ETMS — V0015: SECURITY DEFINER refresh-session lookup
-- Refresh tokens are opaque and carry no tenant, so the lookup (by token hash)
-- must run before a tenant context exists — same pattern as V0014. Returns only
-- the single matching session; rotation/revocation then runs tenant-scoped.
-- =============================================================================

CREATE OR REPLACE FUNCTION auth_session_lookup(p_hash text)
  RETURNS TABLE(
    session_id  uuid,
    user_id     uuid,
    tenant_id   uuid,
    expires_at  timestamptz,
    revoked_at  timestamptz,
    user_status text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT s.id, s.user_id, s.tenant_id, s.expires_at, s.revoked_at, u.status
    FROM user_session s
    JOIN app_user u ON u.id = s.user_id
    WHERE s.refresh_token_hash = p_hash
    LIMIT 1;
  $$;

REVOKE ALL ON FUNCTION auth_session_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_session_lookup(text) TO etms_app;
