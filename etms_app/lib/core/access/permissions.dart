import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/presentation/providers/auth_providers.dart';

/// Effective permissions for the signed-in user, taken from the backend JWT
/// claims (hydrated by the auth repository). Drives RBAC gating of the Admin
/// Portal's navigation and actions.
final permissionsProvider = Provider<Set<String>>((ref) {
  final user = ref.watch(currentUserProvider);
  return user?.permissions.toSet() ?? const <String>{};
});

extension PermissionCheck on WidgetRef {
  Set<String> get permissions => watch(permissionsProvider);
  bool can(String permission) => permissions.contains(permission);
  bool canAny(Iterable<String> perms) => perms.any(permissions.contains);
}

bool hasPermission(Ref ref, String permission) =>
    ref.watch(permissionsProvider).contains(permission);

/// Permissions that grant entry to the Admin Portal.
const kAdminEntryPermissions = <String>{
  'site.read', 'site.manage', 'shift.manage', 'route.manage', 'schedule.manage',
  'trip.dispatch', 'booking.manage_any', 'vehicle.manage', 'driver.manage',
  'vendor.manage', 'employee.manage', 'cost.read', 'invoice.read',
  'ratecard.manage', 'report.operational', 'report.financial',
  'user.manage', 'role.manage', 'branding.manage', 'tenant.manage', 'audit.read',
};

final isAdminUserProvider = Provider<bool>((ref) {
  final perms = ref.watch(permissionsProvider);
  return perms.any(kAdminEntryPermissions.contains);
});
