import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/providers.dart';
import '../../../core/localization/l10n_extensions.dart';
import '../../../shared/widgets/state_views.dart';

class _Kpi {
  const _Kpi(this.key, this.label, this.icon);
  final String key;
  final String label;
  final IconData icon;
}

const _kpis = <_Kpi>[
  _Kpi('employees', 'Employees', Icons.badge_outlined),
  _Kpi('vehicles', 'Vehicles', Icons.directions_bus_outlined),
  _Kpi('drivers', 'Drivers', Icons.person_pin_circle_outlined),
  _Kpi('sites', 'Sites', Icons.location_city_outlined),
  _Kpi('openIncidents', 'Open incidents', Icons.warning_amber_outlined),
];

/// Live KPI counts from the backend (RLS-scoped): GET /v1/dashboard/kpis.
final dashboardKpisProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return ref.watch(apiClientProvider).get<Map<String, dynamic>>('/dashboard/kpis');
});

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final kpis = ref.watch(dashboardKpisProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(context.l10n.navHome),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(dashboardKpisProvider),
          ),
        ],
      ),
      body: kpis.when(
        loading: () => const LoadingIndicator(),
        error: (e, _) => ErrorView(
          message: context.l10n.errorGeneric,
          onRetry: () => ref.invalidate(dashboardKpisProvider),
        ),
        data: (data) => _TileGrid(
          children: [
            for (final k in _kpis)
              _KpiTile(kpi: k, value: (data[k.key] as num?)?.toInt() ?? 0),
          ],
        ),
      ),
    );
  }
}

class _TileGrid extends StatelessWidget {
  const _TileGrid({required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width;
    final cols = w >= 1200 ? 4 : (w >= 720 ? 2 : 1);
    return GridView.count(
      padding: const EdgeInsets.all(16),
      crossAxisCount: cols,
      childAspectRatio: 2.4,
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      children: children,
    );
  }
}

class _KpiTile extends StatelessWidget {
  const _KpiTile({required this.kpi, required this.value});
  final _Kpi kpi;
  final int value;
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: scheme.primaryContainer,
              child: Icon(kpi.icon, color: scheme.onPrimaryContainer),
            ),
            const SizedBox(width: 16),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text('$value', style: Theme.of(context).textTheme.headlineMedium),
                Text(kpi.label, style: TextStyle(color: scheme.onSurfaceVariant)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
