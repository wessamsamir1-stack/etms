-- =============================================================================
-- ETMS — V0013: Access-resolution views for the app layer (RBAC gating)
-- The Admin Portal reads a user's effective permissions to gate navigation and
-- actions. RLS on the underlying tables keeps these views tenant-isolated.
-- =============================================================================

-- Effective permissions granted to a user through all their roles.
CREATE VIEW v_user_effective_permissions AS
SELECT DISTINCT
  ur.tenant_id,
  ur.user_id,
  p.code AS permission
FROM user_role ur
JOIN role_permission rp ON rp.role_id = ur.role_id
JOIN permission p       ON p.id = rp.permission_id;

-- A user's roles (code + name) for display.
CREATE VIEW v_user_roles AS
SELECT
  ur.tenant_id,
  ur.user_id,
  r.id AS role_id,
  r.code,
  r.name
FROM user_role ur
JOIN role r ON r.id = ur.role_id;

GRANT SELECT ON v_user_effective_permissions TO etms_app, etms_readonly;
GRANT SELECT ON v_user_roles                 TO etms_app, etms_readonly;
