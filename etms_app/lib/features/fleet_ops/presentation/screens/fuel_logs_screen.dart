import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/router/app_routes.dart';
import '../../data/fleet_ops_models.dart';
import '../providers/fleet_ops_providers.dart';

/// Fuel fill log (GET /v1/fuel-logs) with a summary header and an add action.
class FuelLogsScreen extends ConsumerWidget {
  const FuelLogsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final async = ref.watch(fuelLogsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(ar ? 'سجل البنزين' : 'Fuel log')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push(AppRoutes.fuelAdd),
        icon: const Icon(Icons.local_gas_station),
        label: Text(ar ? 'تعبئة جديدة' : 'New fill'),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(fuelLogsProvider),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [
            const SizedBox(height: 120),
            Center(child: Text(ar ? 'تعذّر تحميل سجل البنزين' : 'Could not load fuel log')),
          ]),
          data: (logs) => logs.isEmpty
              ? ListView(children: [
                  const SizedBox(height: 120),
                  Center(child: Text(ar ? 'لا تعبئات مسجلة بعد' : 'No fills recorded yet')),
                ])
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
                  children: [
                    _Summary(logs: logs, ar: ar),
                    const SizedBox(height: 12),
                    for (final l in logs) _FuelTile(log: l, ar: ar),
                  ],
                ),
        ),
      ),
    );
  }
}

class _Summary extends StatelessWidget {
  const _Summary({required this.logs, required this.ar});
  final List<FuelLog> logs;
  final bool ar;
  @override
  Widget build(BuildContext context) {
    final liters = logs.fold<double>(0, (s, l) => s + l.liters);
    final cost = logs.fold<double>(0, (s, l) => s + l.costAmount);
    return Row(children: [
      _Stat(value: '${logs.length}', label: ar ? 'تعبئات' : 'Fills', color: Theme.of(context).colorScheme.primary),
      _Stat(value: liters.toStringAsFixed(1), label: ar ? 'لتر' : 'Liters', color: const Color(0xFF1E9E58)),
      _Stat(value: cost.toStringAsFixed(2), label: ar ? 'التكلفة' : 'Cost', color: const Color(0xFFB07708)),
    ]);
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label, required this.color});
  final String value;
  final String label;
  final Color color;
  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 4),
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: Theme.of(context).brightness == Brightness.dark
              ? const Color(0xFF17263C)
              : const Color(0xFFEEF4FB),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(children: [
          Text(value,
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w800, color: color)),
          Text(label, style: Theme.of(context).textTheme.labelSmall),
        ]),
      ),
    );
  }
}

class _FuelTile extends StatelessWidget {
  const _FuelTile({required this.log, required this.ar});
  final FuelLog log;
  final bool ar;
  @override
  Widget build(BuildContext context) {
    final d = log.filledAt;
    final date = d == null
        ? ''
        : '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    final type = switch (log.fuelType) {
      'petrol_95' => ar ? 'بنزين ٩٥' : '95',
      'diesel' => ar ? 'ديزل' : 'Diesel',
      _ => ar ? 'بنزين ٩١' : '91',
    };
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: const CircleAvatar(child: Icon(Icons.local_gas_station, size: 20)),
        title: Text('${log.plateNo} · ${log.liters.toStringAsFixed(1)} ${ar ? 'لتر' : 'L'} ($type)'),
        subtitle: Text([
          date,
          if (log.driver != null) log.driver!,
          if (log.odometerKm != null) '${log.odometerKm} ${ar ? 'كم' : 'km'}',
          if (log.station != null && log.station!.isNotEmpty) log.station!,
        ].join(' · ')),
        trailing: Text('${log.costAmount.toStringAsFixed(2)} ${log.currency}',
            style: const TextStyle(fontWeight: FontWeight.w700)),
      ),
    );
  }
}
