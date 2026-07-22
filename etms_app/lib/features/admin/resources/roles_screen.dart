import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/access/permissions.dart';
import '../../../core/admin/crud_controller.dart';
import '../../../core/di/providers.dart';
import '../../../shared/widgets/state_views.dart';

/// Full permission catalog (id + code) from the backend.
final permissionCatalogProvider =
    FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final res = await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/permissions');
  return (res['data'] as List? ?? const []).cast<Map<String, dynamic>>();
});

/// Permission ids currently granted to a role.
final rolePermissionIdsProvider =
    FutureProvider.family<Set<String>, String>((ref, roleId) async {
  final res = await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/roles/$roleId/permissions');
  return (res['data'] as List? ?? const []).map((e) => '$e').toSet();
});

/// Roles & permission matrix (O-30) via the backend REST API. Toggling grants/
/// revokes `role_permission`. These writes require `role.manage` + **MFA step-up**
/// (backend enforces it); without a step-up token the API returns 403.
class RolesScreen extends ConsumerStatefulWidget {
  const RolesScreen({super.key});
  @override
  ConsumerState<RolesScreen> createState() => _RolesScreenState();
}

class _RolesScreenState extends ConsumerState<RolesScreen> {
  String? _selectedRoleId;

  Future<void> _toggle(String roleId, String permId, bool grant) async {
    final api = ref.read(apiClientProvider);
    try {
      if (grant) {
        await api.post<Map<String, dynamic>>('/roles/$roleId/permissions', body: {'permissionId': permId});
      } else {
        await api.delete<dynamic>('/roles/$roleId/permissions/$permId');
      }
      ref.invalidate(rolePermissionIdsProvider(roleId));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Update failed — MFA step-up may be required')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final canWrite = ref.can('role.manage');
    final roles = ref.watch(crudListProvider('roles'));
    final wide = MediaQuery.sizeOf(context).width >= 900;

    return Scaffold(
      appBar: AppBar(title: const Text('Roles & Permissions')),
      body: roles.when(
        loading: () => const LoadingIndicator(),
        error: (e, _) => ErrorView(
          message: 'Failed to load roles',
          onRetry: () => ref.invalidate(crudListProvider('roles')),
        ),
        data: (list) {
          if (list.isEmpty) {
            return const EmptyState(icon: Icons.shield_outlined, title: 'No roles');
          }
          _selectedRoleId ??= list.first['id'] as String;
          final master = _RoleList(
            roles: list,
            selectedId: _selectedRoleId,
            onSelect: (id) => setState(() => _selectedRoleId = id),
          );
          final detail = _PermissionMatrix(
            roleId: _selectedRoleId!,
            canWrite: canWrite,
            onToggle: _toggle,
          );
          return wide
              ? Row(children: [
                  SizedBox(width: 280, child: master),
                  const VerticalDivider(width: 1),
                  Expanded(child: detail),
                ])
              : detail;
        },
      ),
    );
  }
}

class _RoleList extends StatelessWidget {
  const _RoleList({required this.roles, required this.selectedId, required this.onSelect});
  final List<Map<String, dynamic>> roles;
  final String? selectedId;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) => ListView(
        children: [
          for (final r in roles)
            ListTile(
              selected: r['id'] == selectedId,
              title: Text(r['name']?.toString() ?? r['code'].toString()),
              subtitle: Text(r['code'].toString()),
              onTap: () => onSelect(r['id'] as String),
            ),
        ],
      );
}

class _PermissionMatrix extends ConsumerWidget {
  const _PermissionMatrix({required this.roleId, required this.canWrite, required this.onToggle});
  final String roleId;
  final bool canWrite;
  final Future<void> Function(String roleId, String permId, bool grant) onToggle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final catalog = ref.watch(permissionCatalogProvider);
    final granted = ref.watch(rolePermissionIdsProvider(roleId));

    return catalog.when(
      loading: () => const LoadingIndicator(),
      error: (e, _) => const ErrorView(message: 'Failed to load permissions'),
      data: (perms) {
        final grantedIds = granted.valueOrNull ?? const <String>{};
        final groups = <String, List<Map<String, dynamic>>>{};
        for (final p in perms) {
          final code = p['code'] as String;
          groups.putIfAbsent(code.split('.').first, () => []).add(p);
        }
        final keys = groups.keys.toList()..sort();
        return ListView(
          padding: const EdgeInsets.all(8),
          children: [
            for (final g in keys)
              Card(
                child: ExpansionTile(
                  title: Text(g, style: const TextStyle(fontWeight: FontWeight.w600)),
                  children: [
                    for (final p in groups[g]!)
                      CheckboxListTile(
                        dense: true,
                        title: Text(p['code'] as String),
                        subtitle: p['description'] != null ? Text(p['description'] as String) : null,
                        value: grantedIds.contains(p['id']),
                        onChanged: canWrite
                            ? (v) => onToggle(roleId, p['id'] as String, v ?? false)
                            : null,
                      ),
                  ],
                ),
              ),
          ],
        );
      },
    );
  }
}
