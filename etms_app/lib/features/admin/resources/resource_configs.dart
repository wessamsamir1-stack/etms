import 'package:flutter/material.dart';

import '../../../shared/admin/resource_config.dart';

/// Declarative configs for the admin resources built in this pass. Each one is
/// rendered by the generic CrudListPage — add a resource by adding a config.
abstract final class AdminResources {
  static String _s(Map<String, dynamic> r, String k) => (r[k] ?? '—').toString();
  static String _yn(Map<String, dynamic> r, String k) =>
      (r[k] == true) ? 'Yes' : 'No';

  static const _statusSite = [('active', 'Active'), ('inactive', 'Inactive')];
  static const _statusVehicle = [
    ('active', 'Active'),
    ('maintenance', 'Maintenance'),
    ('retired', 'Retired'),
  ];
  static const _vehicleTypes = [
    ('bus', 'Bus'),
    ('minibus', 'Minibus'),
    ('van', 'Van'),
    ('sedan', 'Sedan'),
    ('suv', 'SUV'),
  ];
  static const _userStatus = [
    ('invited', 'Invited'),
    ('active', 'Active'),
    ('disabled', 'Disabled'),
  ];
  static const _locales = [('ar', 'العربية'), ('en', 'English')];

  static final site = ResourceConfig(
    resource: 'site',
    apiPath: 'sites',
    titleSingular: 'Site',
    titlePlural: 'Sites',
    icon: Icons.location_city_outlined,
    readPermission: 'site.read',
    writePermission: 'site.manage',
    searchFields: const ['name', 'code'],
    columns: [
      ColumnSpec('Name', (r) => _s(r, 'name')),
      ColumnSpec('Code', (r) => _s(r, 'code')),
      ColumnSpec('Timezone', (r) => _s(r, 'timezone')),
      ColumnSpec('Status', (r) => _s(r, 'status')),
    ],
    fields: const [
      FieldSpec(name: 'name', label: 'Name', required: true),
      FieldSpec(name: 'code', label: 'Code'),
      FieldSpec(name: 'timezone', label: 'Timezone', hint: 'e.g. Asia/Kuwait'),
      FieldSpec(
          name: 'status', label: 'Status', type: FieldType.select, options: _statusSite),
    ],
  );

  static final vehicle = ResourceConfig(
    resource: 'vehicle',
    apiPath: 'vehicles',
    titleSingular: 'Vehicle',
    titlePlural: 'Vehicles',
    icon: Icons.directions_bus_outlined,
    readPermission: 'vehicle.read',
    writePermission: 'vehicle.manage',
    searchFields: const ['plate_no'],
    columns: [
      ColumnSpec('Plate', (r) => _s(r, 'plate_no')),
      ColumnSpec('Type', (r) => _s(r, 'type')),
      ColumnSpec('Capacity', (r) => _s(r, 'capacity')),
      ColumnSpec('Status', (r) => _s(r, 'status')),
    ],
    fields: const [
      FieldSpec(name: 'plate_no', label: 'Plate No.', required: true),
      FieldSpec(
          name: 'type', label: 'Type', type: FieldType.select, options: _vehicleTypes),
      FieldSpec(
          name: 'capacity', label: 'Capacity', type: FieldType.number, required: true),
      FieldSpec(
          name: 'status', label: 'Status', type: FieldType.select, options: _statusVehicle),
      FieldSpec(
          name: 'vendor_id',
          label: 'Vendor',
          type: FieldType.reference,
          refResource: 'vendors'),
      FieldSpec(
          name: 'inspection_expiry', label: 'Inspection expiry', type: FieldType.date),
      FieldSpec(
          name: 'insurance_expiry', label: 'Insurance expiry', type: FieldType.date),
    ],
  );

  static final employee = ResourceConfig(
    resource: 'employee',
    apiPath: 'employees',
    titleSingular: 'Employee',
    titlePlural: 'Employees',
    icon: Icons.badge_outlined,
    readPermission: 'employee.read',
    writePermission: 'employee.manage',
    searchFields: const ['full_name', 'external_hr_id'],
    columns: [
      ColumnSpec('Name', (r) => _s(r, 'full_name')),
      ColumnSpec('Department', (r) => _s(r, 'department')),
      ColumnSpec('HR ID', (r) => _s(r, 'external_hr_id')),
      ColumnSpec('Eligible', (r) => _yn(r, 'eligible')),
    ],
    fields: const [
      FieldSpec(name: 'full_name', label: 'Full name', required: true),
      FieldSpec(name: 'external_hr_id', label: 'HR ID'),
      FieldSpec(name: 'department', label: 'Department'),
      FieldSpec(name: 'eligible', label: 'Eligible', type: FieldType.boolean),
      FieldSpec(
          name: 'cost_center_id',
          label: 'Cost center',
          type: FieldType.reference,
          refResource: 'cost-centers'),
      FieldSpec(
          name: 'default_site_id',
          label: 'Default site',
          type: FieldType.reference,
          refResource: 'sites'),
    ],
  );

  static final user = ResourceConfig(
    resource: 'app_user',
    apiPath: 'users',
    titleSingular: 'User',
    titlePlural: 'Users',
    icon: Icons.people_outline,
    readPermission: 'user.read',
    writePermission: 'user.manage',
    searchFields: const ['full_name', 'email'],
    columns: [
      ColumnSpec('Name', (r) => _s(r, 'full_name')),
      ColumnSpec('Email', (r) => _s(r, 'email')),
      ColumnSpec('Status', (r) => _s(r, 'status')),
    ],
    fields: const [
      FieldSpec(name: 'full_name', label: 'Full name', required: true),
      FieldSpec(name: 'email', label: 'Email'),
      FieldSpec(name: 'phone', label: 'Phone'),
      FieldSpec(
          name: 'status', label: 'Status', type: FieldType.select, options: _userStatus),
      FieldSpec(
          name: 'locale', label: 'Language', type: FieldType.select, options: _locales),
    ],
  );
}
