-- =============================================================================
-- ETMS — V0022: Multi-brand org structure + Transport/Branch admin roles.
-- Hierarchy: Company (tenant) → Brand → Branch (site) → Employees. Adds the
-- `brand` entity and brand_id on site/employee, plus the transport_admin and
-- branch_admin roles (super_admin already exists as the platform operator).
-- Branch scoping uses the existing user_role.scope_site_ids.
-- =============================================================================

-- ---- New permissions -------------------------------------------------------
INSERT INTO permission(code, description) VALUES
  ('brand.read',   'View brands'),
  ('brand.manage', 'Manage brands')
ON CONFLICT (code) DO NOTHING;

-- ---- Brand (between the company/tenant and its branches) --------------------
CREATE TABLE brand (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  code       text,
  status     text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_brand_code ON brand(tenant_id, code)
  WHERE code IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_brand_tenant ON brand(tenant_id) WHERE deleted_at IS NULL;
SELECT attach_standard_triggers('brand');

ALTER TABLE brand ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brand
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- A branch (site) and an employee each belong to a brand.
ALTER TABLE site     ADD COLUMN brand_id uuid REFERENCES brand(id) ON DELETE SET NULL;
ALTER TABLE employee ADD COLUMN brand_id uuid REFERENCES brand(id) ON DELETE SET NULL;
CREATE INDEX ix_site_brand     ON site(tenant_id, brand_id);
CREATE INDEX ix_employee_brand ON employee(tenant_id, brand_id);

-- ---- New tenant roles ------------------------------------------------------
INSERT INTO role(code, name, description, is_system) VALUES
  ('transport_admin','Transport Admin','Runs transport operations: fleet, drivers, routes, dispatch', true),
  ('branch_admin','Branch Admin','Manages a single branch (scoped to its sites)', true)
ON CONFLICT (code) WHERE tenant_id IS NULL DO NOTHING;

-- brand.* to the company admin (re-seed clones into each tenant admin role) + reads.
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY['brand.read','brand.manage'])
WHERE r.code='company_admin' AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code='brand.read'
WHERE r.code IN ('ops_manager','dispatcher','hr_admin') AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

-- Transport Admin: fleet + drivers + routes + dispatch + live ops.
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY[
  'vehicle.read','vehicle.manage','driver.read','driver.manage','driver.verify',
  'route.read','route.manage','schedule.read','schedule.manage',
  'trip.read','trip.dispatch','trip.reassign','trip.cancel',
  'booking.read','booking.manage_any','ride_request.read','ride_request.manage_any',
  'manifest.manage','route_plan.read','route_plan.approve',
  'tracking.read','incident.read','incident.resolve','report.operational',
  'employee.read','site.read','shift.read','brand.read','location.read','vendor.read'])
WHERE r.code='transport_admin' AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;

-- Branch Admin: read/manage its branch's employees + trips (scoped via scope_site_ids).
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON p.code = ANY (ARRAY[
  'employee.read','employee.manage','booking.read','trip.read','tracking.read',
  'report.operational','brand.read','site.read'])
WHERE r.code='branch_admin' AND r.tenant_id IS NULL ON CONFLICT DO NOTHING;
