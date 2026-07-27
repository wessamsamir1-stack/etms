import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/access/permissions.dart';
import '../core/localization/l10n_extensions.dart';
import '../core/localization/locale_controller.dart';
import '../core/router/app_routes.dart';
import '../features/auth/presentation/controllers/auth_controller.dart';
import '../features/trips/presentation/screens/trips_screen.dart';
import '../shared/widgets/primary_button.dart';

/// Bottom-nav shell hosting the role's primary destinations. In a full build,
/// tabs are chosen from the signed-in user's roles (rider vs driver vs ops).
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});
  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final pages = [
      const TripsScreen(),
      _Placeholder(title: l10n.navBookings, icon: Icons.event_seat_outlined),
      const _ProfileTab(),
    ];
    return Scaffold(
      body: pages[_index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          NavigationDestination(
              icon: const Icon(Icons.directions_bus_outlined), label: l10n.navTrips,),
          NavigationDestination(
              icon: const Icon(Icons.event_seat_outlined), label: l10n.navBookings,),
          NavigationDestination(
              icon: const Icon(Icons.person_outline), label: l10n.navProfile,),
        ],
      ),
    );
  }
}

class _Placeholder extends StatelessWidget {
  const _Placeholder({required this.title, required this.icon});
  final String title;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(title)),
        body: Center(child: Icon(icon, size: 64)),
      );
}

class _ProfileTab extends ConsumerWidget {
  const _ProfileTab();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.navProfile)),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            ListTile(
              leading: const Icon(Icons.language),
              title: const Text('العربية / English'),
              onTap: () => ref.read(localeControllerProvider.notifier).toggle(),
            ),
            if (ref.can('fuel.read'))
              ListTile(
                leading: const Icon(Icons.local_gas_station_outlined),
                title: Text(l10n.localeName == 'ar' ? 'سجل البنزين' : 'Fuel log'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(AppRoutes.fuelLogs),
              ),
            if (ref.can('violation.read'))
              ListTile(
                leading: const Icon(Icons.receipt_long_outlined),
                title: Text(l10n.localeName == 'ar' ? 'المخالفات' : 'Violations'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(AppRoutes.violations),
              ),
            if (ref.can('ride_request.claim'))
              ListTile(
                leading: const Icon(Icons.hail_outlined),
                title: Text(l10n.localeName == 'ar' ? 'طلبات التوصيل' : 'Ride requests'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(AppRoutes.rideRequests),
              ),
            if (ref.can('report.operational'))
              ListTile(
                leading: const Icon(Icons.insert_chart_outlined),
                title: Text(l10n.localeName == 'ar' ? 'تقارير الأسطول' : 'Fleet reports'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(AppRoutes.fleetReports),
              ),
            if (ref.can('report.operational'))
              ListTile(
                leading: const Icon(Icons.query_stats_outlined),
                title: Text(
                  l10n.localeName == 'ar' ? 'التقارير التشغيلية' : 'Operational reports',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(AppRoutes.opsReports),
              ),
            if (ref.watch(isAdminUserProvider))
              ListTile(
                leading: const Icon(Icons.admin_panel_settings_outlined),
                title: const Text('Admin Portal'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.go(AppRoutes.admin),
              ),
            const Spacer(),
            PrimaryButton(
              label: l10n.logout,
              icon: Icons.logout,
              onPressed: () =>
                  ref.read(authControllerProvider.notifier).logout(),
            ),
          ],
        ),
      ),
    );
  }
}
