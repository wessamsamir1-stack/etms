import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/access/permissions.dart';
import '../../../shared/admin/crud_list_page.dart';
import '../../auth/presentation/controllers/auth_controller.dart';
import '../../eligibility/presentation/screens/approvals_screen.dart';
import '../dashboard/dashboard_screen.dart';
import '../resources/resource_configs.dart';
import '../resources/roles_screen.dart';
import '../settings/branding_screen.dart';
import '../settings/transport_policy_screen.dart';

class _Destination {
  const _Destination(this.label, this.icon, this.permission, this.builder);
  final String label;
  final IconData icon;
  final String permission;
  final WidgetBuilder builder;
}

/// The Admin Portal shell: RBAC-gated destinations rendered as a NavigationRail
/// on wide screens and a NavigationBar on compact. Each destination is only
/// shown if the user holds its permission (see core/access/permissions).
class AdminShell extends ConsumerStatefulWidget {
  const AdminShell({super.key});
  @override
  ConsumerState<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends ConsumerState<AdminShell> {
  int _index = 0;

  static final _all = <_Destination>[
    _Destination('Dashboard', Icons.dashboard_outlined, 'report.operational',
        (_) => const DashboardScreen(),),
    _Destination('Sites', Icons.location_city_outlined, 'site.read',
        (_) => CrudListPage(config: AdminResources.site),),
    _Destination('Vehicles', Icons.directions_bus_outlined, 'vehicle.read',
        (_) => CrudListPage(config: AdminResources.vehicle),),
    _Destination('Employees', Icons.badge_outlined, 'employee.read',
        (_) => CrudListPage(config: AdminResources.employee),),
    _Destination('Approvals', Icons.verified_user_outlined, 'employee.manage',
        (_) => const ApprovalsScreen(),),
    _Destination('Users', Icons.people_outline, 'user.read',
        (_) => CrudListPage(config: AdminResources.user),),
    _Destination('Roles', Icons.shield_outlined, 'role.read',
        (_) => const RolesScreen(),),
    _Destination('Waiting timer', Icons.timer_outlined, 'tenant.manage',
        (_) => const TransportPolicyScreen(),),
    _Destination('Branding', Icons.palette_outlined, 'branding.manage',
        (_) => const BrandingScreen(),),
  ];

  @override
  Widget build(BuildContext context) {
    // Only destinations the user is permitted to see.
    final permitted = _all.where((d) => ref.can(d.permission)).toList();
    if (permitted.isEmpty) {
      return const Scaffold(
        body: Center(child: Text("You don't have access to the admin portal.")),
      );
    }
    final index = _index.clamp(0, permitted.length - 1);
    final page = permitted[index].builder(context);
    final wide = MediaQuery.sizeOf(context).width >= 840;

    if (wide) {
      return Scaffold(
        body: Row(
          children: [
            NavigationRail(
              extended: MediaQuery.sizeOf(context).width >= 1100,
              selectedIndex: index,
              onDestinationSelected: (i) => setState(() => _index = i),
              leading: _RailLeading(onSignOut: _signOut),
              destinations: [
                for (final d in permitted)
                  NavigationRailDestination(
                    icon: Icon(d.icon),
                    label: Text(d.label),
                  ),
              ],
            ),
            const VerticalDivider(width: 1),
            Expanded(child: page),
          ],
        ),
      );
    }

    return Scaffold(
      body: page,
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          for (final d in permitted)
            NavigationDestination(icon: Icon(d.icon), label: d.label),
        ],
      ),
    );
  }

  Future<void> _signOut() =>
      ref.read(authControllerProvider.notifier).logout();
}

class _RailLeading extends StatelessWidget {
  const _RailLeading({required this.onSignOut});
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Column(
        children: [
          const CircleAvatar(child: Icon(Icons.admin_panel_settings_outlined)),
          const SizedBox(height: 8),
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: onSignOut,
          ),
        ],
      ),
    );
  }
}
