import 'package:flutter/material.dart';

/// Field kinds the generic admin form can render.
enum FieldType { text, multiline, number, boolean, select, date, reference }

/// One editable field of a resource.
class FieldSpec {
  const FieldSpec({
    required this.name,
    required this.label,
    this.type = FieldType.text,
    this.required = false,
    this.options = const [],
    this.refResource,
    this.refLabel = 'name',
    this.hint,
    this.editableOnCreateOnly = false,
  });

  final String name;
  final String label;
  final FieldType type;
  final bool required;
  /// For [FieldType.select]: (value, label) pairs.
  final List<(String, String)> options;
  /// For [FieldType.reference]: the resource + display column to load options from.
  final String? refResource;
  final String refLabel;
  final String? hint;
  final bool editableOnCreateOnly;
}

/// One column of the resource's data grid.
class ColumnSpec {
  const ColumnSpec(this.label, this.value, {this.width});
  final String label;
  final String Function(Map<String, dynamic> row) value;
  final double? width;
}

/// Declarative description of an admin resource: how to list it, edit it, and
/// who may do so. The generic [CrudListPage] renders any of these.
class ResourceConfig {
  const ResourceConfig({
    required this.resource,
    required this.apiPath,
    required this.titleSingular,
    required this.titlePlural,
    required this.icon,
    required this.columns,
    required this.fields,
    required this.readPermission,
    required this.writePermission,
    this.subtitle,
    this.searchFields = const ['name'],
    this.idField = 'id',
    this.softDelete = true,
  });

  /// Logical table/entity name (display + reference).
  final String resource;

  /// Plural REST path segment on the backend, e.g. `sites` → `/v1/sites`.
  final String apiPath;
  final String titleSingular;
  final String titlePlural;
  final IconData icon;
  final String? subtitle;
  final List<ColumnSpec> columns;
  final List<FieldSpec> fields;
  final String readPermission;
  final String writePermission;
  final List<String> searchFields;
  final String idField;
  final bool softDelete;
}
