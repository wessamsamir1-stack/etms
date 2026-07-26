import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/fleet_ops_models.dart';
import '../providers/fleet_ops_providers.dart';
import 'violations_screen.dart' show typeLabel;

/// Fuel + violations reports over a selectable date range
/// (GET /v1/reports/fuel, GET /v1/reports/violations).
class FleetReportsScreen extends ConsumerWidget {
  const FleetReportsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final range = ref.watch(reportRangeProvider);
    final fuel = ref.watch(fuelReportProvider);
    final violations = ref.watch(violationsReportProvider);

    String d(DateTime x) =>
        '${x.year}-${x.month.toString().padLeft(2, '0')}-${x.day.toString().padLeft(2, '0')}';

    return Scaffold(
      appBar: AppBar(title: Text(ar ? 'تقارير الأسطول' : 'Fleet reports')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(fuelReportProvider);
          ref.invalidate(violationsReportProvider);
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            OutlinedButton.icon(
              icon: const Icon(Icons.date_range),
              label: Text('${d(range.from)} ← ${d(range.to)}'),
              onPressed: () async {
                final picked = await showDateRangePicker(
                  context: context,
                  firstDate: DateTime(2024),
                  lastDate: DateTime.now().add(const Duration(days: 1)),
                  initialDateRange: DateTimeRange(start: range.from, end: range.to),
                );
                if (picked != null) {
                  ref.read(reportRangeProvider.notifier).state =
                      (from: picked.start, to: picked.end);
                }
              },
            ),
            const SizedBox(height: 16),
            Text(ar ? 'البنزين' : 'Fuel',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),),
            const SizedBox(height: 8),
            fuel.when(
              loading: () => const Padding(
                  padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()),),
              error: (e, _) =>
                  Text(ar ? 'تعذّر تحميل تقرير البنزين' : 'Could not load the fuel report'),
              data: (r) => _FuelSection(report: r, ar: ar),
            ),
            const SizedBox(height: 24),
            Text(ar ? 'المخالفات' : 'Violations',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),),
            const SizedBox(height: 8),
            violations.when(
              loading: () => const Padding(
                  padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()),),
              error: (e, _) => Text(
                  ar ? 'تعذّر تحميل تقرير المخالفات' : 'Could not load the violations report',),
              data: (r) => _ViolationsSection(report: r, ar: ar),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatBox extends StatelessWidget {
  const _StatBox({required this.value, required this.label, required this.color});
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
                  ?.copyWith(fontWeight: FontWeight.w800, color: color),),
          Text(label, style: Theme.of(context).textTheme.labelSmall, textAlign: TextAlign.center),
        ],),
      ),
    );
  }
}

class _FuelSection extends StatelessWidget {
  const _FuelSection({required this.report, required this.ar});
  final FuelReport report;
  final bool ar;
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(children: [
          _StatBox(
              value: '${report.fills}',
              label: ar ? 'تعبئات' : 'Fills',
              color: Theme.of(context).colorScheme.primary,),
          _StatBox(
              value: report.liters.toStringAsFixed(1),
              label: ar ? 'لتر' : 'Liters',
              color: const Color(0xFF1E9E58),),
          _StatBox(
              value: report.cost.toStringAsFixed(2),
              label: ar ? 'التكلفة' : 'Cost',
              color: const Color(0xFFB07708),),
        ],),
        const SizedBox(height: 8),
        if (report.perVehicle.isEmpty)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Center(child: Text(ar ? 'لا بيانات في الفترة' : 'No data in this period')),
          )
        else
          for (final v in report.perVehicle)
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                dense: true,
                title: Text(v.plateNo, style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text([
                  '${v.fills} ${ar ? 'تعبئة' : 'fills'}',
                  '${v.liters.toStringAsFixed(1)} ${ar ? 'لتر' : 'L'}',
                  if (v.km != null) '${v.km} ${ar ? 'كم' : 'km'}',
                  if (v.kmPerLiter != null) '${v.kmPerLiter} ${ar ? 'كم/لتر' : 'km/L'}',
                ].join(' · '),),
                trailing: Text(v.cost.toStringAsFixed(2),
                    style: const TextStyle(fontWeight: FontWeight.w700),),
              ),
            ),
      ],
    );
  }
}

class _ViolationsSection extends StatelessWidget {
  const _ViolationsSection({required this.report, required this.ar});
  final ViolationsReport report;
  final bool ar;
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(children: [
          _StatBox(
              value: '${report.violations}',
              label: ar ? 'مخالفات' : 'Total',
              color: Theme.of(context).colorScheme.primary,),
          _StatBox(
              value: '${report.pending}',
              label: ar ? 'قيد السداد' : 'Pending',
              color: const Color(0xFFE1554E),),
          _StatBox(
              value: report.unpaidAmount.toStringAsFixed(2),
              label: ar ? 'غير مدفوع' : 'Unpaid',
              color: const Color(0xFFB07708),),
        ],),
        const SizedBox(height: 8),
        if (report.byType.isNotEmpty) ...[
          Text(ar ? 'حسب النوع' : 'By type',
              style: Theme.of(context).textTheme.labelLarge,),
          const SizedBox(height: 4),
          for (final t in report.byType)
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text(typeLabel(t.type, ar)),
              trailing: Text('${t.violations} · ${t.amount.toStringAsFixed(2)}'),
            ),
        ],
        if (report.perDriver.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(ar ? 'حسب السائق' : 'By driver',
              style: Theme.of(context).textTheme.labelLarge,),
          const SizedBox(height: 4),
          for (final d in report.perDriver)
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text(d.driver),
              trailing: Text('${d.violations} · ${d.amount.toStringAsFixed(2)}'),
            ),
        ],
        if (report.byType.isEmpty && report.perDriver.isEmpty)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Center(child: Text(ar ? 'لا بيانات في الفترة' : 'No data in this period')),
          ),
      ],
    );
  }
}
