import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/access/permissions.dart';
import '../../core/admin/crud_controller.dart';
import '../../core/localization/l10n_extensions.dart';
import '../widgets/state_views.dart';
import 'confirm_dialog.dart';
import 'data_table_view.dart';
import 'resource_config.dart';
import 'resource_form.dart';

/// Generic admin resource page: toolbar (search + New) + responsive grid + form
/// dialogs + delete confirm, driven entirely by a [ResourceConfig]. Handles all
/// global states (loading / empty-new / empty-filtered / error) and RBAC gating.
class CrudListPage extends ConsumerStatefulWidget {
  const CrudListPage({super.key, required this.config});
  final ResourceConfig config;

  @override
  ConsumerState<CrudListPage> createState() => _CrudListPageState();
}

class _CrudListPageState extends ConsumerState<CrudListPage> {
  String _search = '';

  ResourceConfig get cfg => widget.config;

  bool _matches(Map<String, dynamic> row) {
    if (_search.isEmpty) return true;
    final q = _search.toLowerCase();
    return cfg.searchFields.any(
      (f) => (row[f]?.toString().toLowerCase() ?? '').contains(q),
    );
  }

  Future<void> _create() async {
    final data = await ResourceFormDialog.show(context, config: cfg);
    if (data == null) return;
    final res = await ref.read(crudListProvider(cfg.apiPath).notifier).create(data);
    _report(res.fold((f) => f.message, (_) => null));
  }

  Future<void> _edit(Map<String, dynamic> row) async {
    final data =
        await ResourceFormDialog.show(context, config: cfg, existing: row);
    if (data == null) return;
    final res = await ref
        .read(crudListProvider(cfg.apiPath).notifier)
        .edit(row[cfg.idField] as String, data);
    _report(res.fold((f) => f.message, (_) => null));
  }

  Future<void> _delete(Map<String, dynamic> row) async {
    final ok = await confirm(
      context,
      title: 'Delete ${cfg.titleSingular}',
      message: 'This ${cfg.softDelete ? 'archives' : 'permanently deletes'} the record.',
    );
    if (!ok) return;
    final res = await ref
        .read(crudListProvider(cfg.apiPath).notifier)
        .remove(row[cfg.idField] as String);
    _report(res.fold((f) => f.message, (_) => null));
  }

  void _report(String? error) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(error ?? '${cfg.titleSingular} saved')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final canWrite = ref.can(cfg.writePermission);
    final async = ref.watch(crudListProvider(cfg.apiPath));

    return Scaffold(
      appBar: AppBar(
        title: Text(cfg.titlePlural),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(56),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.search),
                      hintText: 'Search',
                      isDense: true,
                    ),
                    onChanged: (v) => setState(() => _search = v),
                  ),
                ),
                const SizedBox(width: 12),
                FilledButton.icon(
                  onPressed: canWrite ? _create : null,
                  icon: const Icon(Icons.add),
                  label: Text(cfg.titleSingular),
                ),
              ],
            ),
          ),
        ),
      ),
      body: async.when(
        loading: () => const LoadingIndicator(),
        error: (e, _) => ErrorView(
          message: context.l10n.errorGeneric,
          onRetry: () =>
              ref.read(crudListProvider(cfg.apiPath).notifier).reload(),
        ),
        data: (rows) {
          final filtered = rows.where(_matches).toList();
          if (rows.isEmpty) {
            return EmptyState(
              icon: cfg.icon,
              title: 'No ${cfg.titlePlural.toLowerCase()} yet',
              action: canWrite
                  ? FilledButton.icon(
                      onPressed: _create,
                      icon: const Icon(Icons.add),
                      label: Text(cfg.titleSingular),
                    )
                  : null,
            );
          }
          if (filtered.isEmpty) {
            return EmptyState(
              icon: Icons.search_off,
              title: 'No matches',
              action: OutlinedButton(
                onPressed: () => setState(() => _search = ''),
                child: const Text('Clear'),
              ),
            );
          }
          return Padding(
            padding: const EdgeInsets.all(12),
            child: DataTableView(
              columns: cfg.columns,
              rows: filtered,
              canWrite: canWrite,
              onEdit: _edit,
              onDelete: _delete,
            ),
          );
        },
      ),
    );
  }
}
