-- =============================================================================
-- ETMS — V0012: Seed data — permission catalog + system role templates
-- System roles have tenant_id = NULL and is_system = true; tenants clone them.
-- Idempotent (ON CONFLICT DO NOTHING) so it is safe to re-run.
-- =============================================================================

-- ---- Permission catalog ----------------------------------------------------
INSERT INTO permission(code, description) VALUES
  ('tenant.read','View tenant settings'),
  ('tenant.manage','Manage tenant configuration'),
  ('branding.manage','Manage white-label branding'),
  ('billing.manage','Manage subscription & billing'),
  ('user.read','View users'),
  ('user.manage','Create/update/disable users'),
  ('role.read','View roles'),
  ('role.manage','Create/update roles & assignments'),
  ('permission.read','View permission catalog'),
  ('site.read','View sites'),        ('site.manage','Manage sites/zones'),
  ('shift.read','View shifts'),       ('shift.manage','Manage shifts'),
  ('costcenter.read','View cost centers'),('costcenter.manage','Manage cost centers'),
  ('employee.read','View employees'), ('employee.manage','Manage employees'),
  ('employee.import','Bulk import / HRIS sync employees'),
  ('vehicle.read','View vehicles'),   ('vehicle.manage','Manage vehicles'),
  ('driver.read','View drivers'),     ('driver.manage','Manage drivers'),
  ('driver.verify','Verify drivers'),
  ('vendor.read','View vendors'),     ('vendor.manage','Manage vendors'),
  ('document.read','View documents'), ('document.manage','Manage documents'),
  ('route.read','View routes'),       ('route.manage','Manage routes & stops'),
  ('schedule.read','View schedules'), ('schedule.manage','Manage schedules & generation'),
  ('booking.read','View bookings'),   ('booking.create','Create own booking'),
  ('booking.cancel','Cancel own booking'),('booking.manage_any','Manage any booking'),
  ('trip.read','View trips'),         ('trip.dispatch','Assign vehicle/driver'),
  ('trip.reassign','Reassign trips'), ('trip.cancel','Cancel trips'),
  ('trip.operate','Operate assigned trip (driver)'),
  ('tracking.read','View live tracking'),
  ('incident.read','View incidents'), ('incident.resolve','Acknowledge/resolve incidents'),
  ('sos.raise','Raise SOS/panic'),
  ('ratecard.read','View rate cards'),('ratecard.manage','Manage rate cards'),
  ('cost.read','View trip costs'),
  ('invoice.read','View vendor invoices'),('invoice.reconcile','Reconcile invoices'),
  ('erp.export','Export/post to ERP'),
  ('notification.template.manage','Manage notification templates'),
  ('notification.send','Send notifications'),
  ('report.operational','View operational reports'),
  ('report.financial','View financial reports'),
  ('report.safety','View safety/compliance reports'),
  ('audit.read','View audit log')
ON CONFLICT (code) DO NOTHING;

-- ---- System role templates -------------------------------------------------
INSERT INTO role(code, name, description, is_system) VALUES
  ('super_admin','Super Admin','Platform operator', true),
  ('company_admin','Company Admin','Tenant owner/administrator', true),
  ('ops_manager','Operations Manager','Plans routes & oversees operations', true),
  ('dispatcher','Dispatcher','Assigns vehicles & drivers', true),
  ('hr_admin','HR / Admin','Manages employees & master data', true),
  ('finance','Finance / Controller','Costing & invoice reconciliation', true),
  ('vendor_manager','Vendor Manager','Manages own fleet', true),
  ('driver','Driver','Operates assigned trips', true),
  ('rider','Rider','Employee commuter', true),
  ('auditor','Auditor','Read-only + audit access', true)
ON CONFLICT (code) WHERE tenant_id IS NULL DO NOTHING;

-- ---- Helper to grant a set of permission codes to a system role -----------
-- company_admin: ALL permissions
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id
FROM role r CROSS JOIN permission p
WHERE r.code = 'company_admin' AND r.tenant_id IS NULL
ON CONFLICT DO NOTHING;

-- super_admin: platform-level only (no tenant business PII)
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p
  ON p.code IN ('tenant.read','tenant.manage','billing.manage','branding.manage','audit.read')
WHERE r.code = 'super_admin' AND r.tenant_id IS NULL
ON CONFLICT DO NOTHING;

-- ops_manager
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p
  ON p.code IN ('site.read','site.manage','shift.read','shift.manage',
    'costcenter.read','employee.read','vehicle.read','driver.read','driver.verify',
    'vendor.read','document.read','route.read','route.manage','schedule.read',
    'schedule.manage','booking.read','booking.manage_any','trip.read','trip.dispatch',
    'trip.reassign','trip.cancel','tracking.read','incident.read','incident.resolve',
    'cost.read','notification.template.manage','notification.send',
    'report.operational','report.safety','audit.read','user.read','role.read')
WHERE r.code = 'ops_manager' AND r.tenant_id IS NULL
ON CONFLICT DO NOTHING;

-- dispatcher
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p
  ON p.code IN ('site.read','shift.read','employee.read','vehicle.read','driver.read',
    'vendor.read','route.read','schedule.read','booking.read','booking.manage_any',
    'trip.read','trip.dispatch','trip.reassign','trip.cancel','tracking.read',
    'incident.read','incident.resolve','report.operational')
WHERE r.code = 'dispatcher' AND r.tenant_id IS NULL
ON CONFLICT DO NOTHING;

-- hr_admin
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p
  ON p.code IN ('site.read','site.manage','shift.read','shift.manage','costcenter.read',
    'costcenter.manage','employee.read','employee.manage','employee.import',
    'booking.read','trip.read','tracking.read','report.operational','user.read')
WHERE r.code = 'hr_admin' AND r.tenant_id IS NULL
ON CONFLICT DO NOTHING;

-- finance
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p
  ON p.code IN ('vendor.read','ratecard.read','ratecard.manage','cost.read',
    'invoice.read','invoice.reconcile','erp.export','costcenter.read',
    'report.financial','audit.read')
WHERE r.code = 'finance' AND r.tenant_id IS NULL
ON CONFLICT DO NOTHING;

-- vendor_manager (own fleet; ABAC + ownership scope enforced in app layer)
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p
  ON p.code IN ('vehicle.read','vehicle.manage','driver.read','driver.manage',
    'document.read','document.manage','ratecard.read','trip.read','tracking.read',
    'cost.read','report.operational')
WHERE r.code = 'vendor_manager' AND r.tenant_id IS NULL
ON CONFLICT DO NOTHING;

-- driver (own trips)
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p
  ON p.code IN ('trip.read','trip.operate','tracking.read','incident.read','sos.raise')
WHERE r.code = 'driver' AND r.tenant_id IS NULL
ON CONFLICT DO NOTHING;

-- rider (self)
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p
  ON p.code IN ('booking.read','booking.create','booking.cancel','trip.read',
    'tracking.read','sos.raise')
WHERE r.code = 'rider' AND r.tenant_id IS NULL
ON CONFLICT DO NOTHING;

-- auditor (read everything + audit)
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p
  ON p.code LIKE '%.read' OR p.code IN ('audit.read','report.operational',
    'report.financial','report.safety')
WHERE r.code = 'auditor' AND r.tenant_id IS NULL
ON CONFLICT DO NOTHING;
