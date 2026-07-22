-- =============================================================================
-- ETMS — V0014: SECURITY DEFINER auth helpers
-- Login is the one flow that must read a user BEFORE a tenant context exists.
-- These functions run as the (owner) definer so the RLS-bound application role
-- (etms_app) can perform the auth lookup without being able to read the tables
-- directly. Each returns only the single matching principal — no broad access.
-- =============================================================================

CREATE OR REPLACE FUNCTION auth_lookup(p_email citext, p_slug citext)
  RETURNS TABLE(user_id uuid, tenant_id uuid, password_hash text, status text, full_name text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT u.id, u.tenant_id, u.password_hash, u.status, u.full_name
    FROM app_user u
    JOIN tenant t ON t.id = u.tenant_id
    WHERE t.slug = p_slug
      AND u.email = p_email
      AND u.deleted_at IS NULL
      AND t.status = 'active'
    LIMIT 1;
  $$;

CREATE OR REPLACE FUNCTION auth_permissions(p_user_id uuid)
  RETURNS SETOF text
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT DISTINCT p.code
    FROM user_role ur
    JOIN role_permission rp ON rp.role_id = ur.role_id
    JOIN permission p ON p.id = rp.permission_id
    WHERE ur.user_id = p_user_id;
  $$;

-- Only the app role may call them; never PUBLIC.
REVOKE ALL ON FUNCTION auth_lookup(citext, citext) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_permissions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup(citext, citext) TO etms_app;
GRANT EXECUTE ON FUNCTION auth_permissions(uuid) TO etms_app;
