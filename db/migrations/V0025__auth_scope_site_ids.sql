-- =============================================================================
-- ETMS — V0025: Effective branch scope for a user (Branch Admin ABAC).
--
-- A role can be limited to specific branches via user_role.scope_site_ids
-- (uuid[], V0002; default '{}' = unscoped). This SECURITY DEFINER function
-- resolves a user's EFFECTIVE branch scope across all their role assignments,
-- so login can mint it into the JWT (like auth_permissions). The API then
-- filters branch-scoped reads/writes to these sites.
--
-- Semantics (most-permissive wins): an UNSCOPED assignment (empty array) grants
-- tenant-wide visibility, so it returns NULL = "all sites". Otherwise the union
-- of the scoped site ids limits the user to exactly those branches.
-- =============================================================================

CREATE OR REPLACE FUNCTION auth_scope_site_ids(p_user_id uuid)
  RETURNS uuid[]
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT CASE
      WHEN count(*) = 0 THEN NULL                                  -- no roles → unscoped
      WHEN bool_or(cardinality(ur.scope_site_ids) = 0) THEN NULL   -- an unscoped role wins
      ELSE (
        SELECT array_agg(DISTINCT s)
        FROM user_role u2, unnest(u2.scope_site_ids) AS s
        WHERE u2.user_id = p_user_id
      )
    END
    FROM user_role ur
    WHERE ur.user_id = p_user_id;
  $$;

REVOKE ALL ON FUNCTION auth_scope_site_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_scope_site_ids(uuid) TO etms_app;
