import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/admin/crud_controller.dart';
import '../../core/localization/l10n_extensions.dart';
import 'resource_config.dart';

/// Builds a create/edit form from a [ResourceConfig]'s fields and returns the
/// payload map on save (or null on cancel). Handles text/number/bool/select/
/// date/reference fields with per-field required validation.
class ResourceFormDialog extends ConsumerStatefulWidget {
  const ResourceFormDialog({super.key, required this.config, this.existing});
  final ResourceConfig config;
  final Map<String, dynamic>? existing;

  static Future<Map<String, dynamic>?> show(
    BuildContext context, {
    required ResourceConfig config,
    Map<String, dynamic>? existing,
  }) =>
      showDialog<Map<String, dynamic>>(
        context: context,
        builder: (_) => ResourceFormDialog(config: config, existing: existing),
      );

  @override
  ConsumerState<ResourceFormDialog> createState() => _ResourceFormDialogState();
}

class _ResourceFormDialogState extends ConsumerState<ResourceFormDialog> {
  final _formKey = GlobalKey<FormState>();
  final _text = <String, TextEditingController>{};
  final _values = <String, Object?>{};

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    for (final f in widget.config.fields) {
      final current = widget.existing?[f.name];
      switch (f.type) {
        case FieldType.text:
        case FieldType.multiline:
        case FieldType.number:
          _text[f.name] = TextEditingController(text: current?.toString() ?? '');
        case FieldType.boolean:
          _values[f.name] = current as bool? ?? false;
        case FieldType.select:
        case FieldType.reference:
        case FieldType.date:
          _values[f.name] = current;
      }
    }
  }

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  Map<String, dynamic> _buildPayload() {
    final payload = <String, dynamic>{};
    for (final f in widget.config.fields) {
      if (_isEdit && f.editableOnCreateOnly) continue;
      switch (f.type) {
        case FieldType.number:
          final raw = _text[f.name]!.text.trim();
          payload[f.name] = raw.isEmpty ? null : num.tryParse(raw);
        case FieldType.text:
        case FieldType.multiline:
          final raw = _text[f.name]!.text.trim();
          payload[f.name] = raw.isEmpty ? null : raw;
        case FieldType.boolean:
          payload[f.name] = _values[f.name] as bool? ?? false;
        case FieldType.date:
          final d = _values[f.name] as DateTime?;
          payload[f.name] =
              d?.toIso8601String().split('T').first;
        case FieldType.select:
        case FieldType.reference:
          payload[f.name] = _values[f.name];
      }
    }
    return payload;
  }

  String? _validateRequired(FieldSpec f, String? v) {
    if (f.required && (v == null || v.trim().isEmpty)) return '${f.label} *';
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final cfg = widget.config;
    return AlertDialog(
      title: Text(_isEdit ? cfg.titleSingular : '${cfg.titleSingular} +'),
      content: SizedBox(
        width: 460,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final f in cfg.fields)
                  if (!(_isEdit && f.editableOnCreateOnly))
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: _field(f),
                    ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(context.l10n.commonCancel),
        ),
        FilledButton(
          onPressed: () {
            if (_formKey.currentState?.validate() ?? false) {
              Navigator.pop(context, _buildPayload());
            }
          },
          child: Text(context.l10n.commonSave),
        ),
      ],
    );
  }

  Widget _field(FieldSpec f) {
    switch (f.type) {
      case FieldType.boolean:
        return SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(f.label),
          value: _values[f.name] as bool? ?? false,
          onChanged: (v) => setState(() => _values[f.name] = v),
        );
      case FieldType.select:
        return DropdownButtonFormField<String>(
          initialValue: _values[f.name] as String?,
          decoration: InputDecoration(labelText: f.label),
          items: [
            for (final (val, label) in f.options)
              DropdownMenuItem(value: val, child: Text(label)),
          ],
          validator: (v) => _validateRequired(f, v),
          onChanged: (v) => setState(() => _values[f.name] = v),
        );
      case FieldType.reference:
        final opts = ref.watch(referenceOptionsProvider(
            (path: f.refResource!, label: f.refLabel),),);
        return DropdownButtonFormField<String>(
          initialValue: _values[f.name] as String?,
          decoration: InputDecoration(
            labelText: f.label,
            suffixIcon: opts.isLoading
                ? const SizedBox(
                    width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2),)
                : null,
          ),
          items: [
            for (final (id, label) in opts.valueOrNull ?? const <(String, String)>[])
              DropdownMenuItem(value: id, child: Text(label)),
          ],
          validator: (v) => _validateRequired(f, v),
          onChanged: (v) => setState(() => _values[f.name] = v),
        );
      case FieldType.date:
        final d = _values[f.name] is String
            ? DateTime.tryParse(_values[f.name] as String)
            : _values[f.name] as DateTime?;
        return InkWell(
          onTap: () async {
            final picked = await showDatePicker(
              context: context,
              initialDate: d ?? DateTime.now(),
              firstDate: DateTime(2000),
              lastDate: DateTime(2100),
            );
            if (picked != null) setState(() => _values[f.name] = picked);
          },
          child: InputDecorator(
            decoration: InputDecoration(labelText: f.label),
            child: Text(d == null
                ? '—'
                : d.toIso8601String().split('T').first,),
          ),
        );
      case FieldType.number:
      case FieldType.text:
      case FieldType.multiline:
        return TextFormField(
          controller: _text[f.name],
          keyboardType:
              f.type == FieldType.number ? TextInputType.number : null,
          maxLines: f.type == FieldType.multiline ? 3 : 1,
          decoration: InputDecoration(labelText: f.label, hintText: f.hint),
          validator: (v) => _validateRequired(f, v),
        );
    }
  }
}
