-- =============================================================================
-- ETMS — V0011: Row-Level Security (tenant isolation) + database roles/grants
-- Defense-in-depth: even a buggy query cannot cross tenant boundaries.
-- =============================================================================

-- ---- Application database role (the API connects as this, NOT as owner) ----
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'etms_app') THEN
    CREATE ROLE etms_app NOLOGIN;
  END IF;
  -- Read-only reporting role
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'etms_readonly') THEN
    CREATE ROLE etms_readonly NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO etms_app, etms_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO etms_app;
GRANT SELECT                         ON ALL TABLES    IN SCHEMA public TO etms_readonly;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO etms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO etms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO etms_readonly;

-- ---- Standard tenant-isolation policy applied to every tenant-owned table --
-- Every listed table has a `tenant_id uuid` column checked against the session.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'tenant_branding','tenant_setting','subscription','usage_record',
    'app_user','user_role','user_session','user_mfa_factor','user_identity',
    'site','zone','shift','cost_center','employee',
    'vendor','vehicle','driver','vehicle_document','driver_document','rate_card',
    'route','route_stop','schedule','holiday',
    'trip','assignment','booking','seat_allocation','trip_event',
    'vehicle_ping','vehicle_last_position','incident','geofence_event',
    'trip_cost','trip_cost_allocation','vendor_invoice','invoice_line','erp_export',
    'notification_template','notification','device_token',
    'webhook_subscription','webhook_delivery'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    $f$, t);
  END LOOP;
END $$;

-- ---- tenant table: row is visible when it IS the current tenant -------------
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenant
  USING (id = app_current_tenant())
  WITH CHECK (id = app_current_tenant());

-- ---- role table: current tenant's roles + read-only system templates -------
ALTER TABLE role ENABLE ROW LEVEL SECURITY;
ALTER TABLE role FORCE  ROW LEVEL SECURITY;
CREATE POLICY role_read  ON role FOR SELECT
  USING (tenant_id = app_current_tenant() OR tenant_id IS NULL);
CREATE POLICY role_write ON role FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ---- audit_entry: SELECT own tenant, INSERT only; UPDATE/DELETE denied -----
ALTER TABLE audit_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_entry FORCE  ROW LEVEL SECURITY;
CREATE POLICY audit_read   ON audit_entry FOR SELECT
  USING (tenant_id = app_current_tenant());
CREATE POLICY audit_insert ON audit_entry FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant() OR tenant_id IS NULL);
-- No UPDATE/DELETE policy => those commands are denied under RLS (immutable).
REVOKE UPDATE, DELETE ON audit_entry FROM etms_app;

-- trip_event is append-only too: deny mutation at the privilege level
REVOKE UPDATE, DELETE ON trip_event    FROM etms_app;
REVOKE UPDATE, DELETE ON geofence_event FROM etms_app;

-- ---- Platform super-admin role bypasses RLS (tenant provisioning, support) --
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'etms_platform') THEN
    CREATE ROLE etms_platform NOLOGIN BYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO etms_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO etms_platform;

-- NOTE: `permission` and `role_permission` are global catalog data (non-PII):
-- left without RLS and granted SELECT to all app roles.
