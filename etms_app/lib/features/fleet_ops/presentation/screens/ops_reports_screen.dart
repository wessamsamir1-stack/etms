import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/ops_reports_models.dart';
import '../providers/fleet_ops_providers.dart' show reportRangeProvider;
import '../providers/ops_reports_providers.dart';

/// The operational report pack (db V0033): driver and vehicle scorecards, trip
/// duration, detour detection, fuel anomalies, route cost, attendance and plan
/// adherence — one report at a time over a selectable date range.
class OpsReportsScreen extends ConsumerWidget {
  const OpsReportsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final range = ref.watch(reportRangeProvider);
    final selected = ref.watch(selectedOpsReportProvider);

    String d(DateTime x) =>
        '${x.year}-${x.month.toString().padLeft(2, '0')}-${x.day.toString().padLeft(2, '0')}';

    return Scaffold(
      appBar: AppBar(title: Text(ar ? 'التقارير التشغيلية' : 'Operational reports')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Column(
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
                const SizedBox(height: 8),
                DropdownButtonFormField<OpsReport>(
                  initialValue: selected,
                  decoration: InputDecoration(
                    labelText: ar ? 'التقرير' : 'Report',
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  items: [
                    for (final r in OpsReport.values)
                      DropdownMenuItem(value: r, child: Text(r.label(ar))),
                  ],
                  onChanged: (v) {
                    if (v != null) ref.read(selectedOpsReportProvider.notifier).state = v;
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: switch (selected) {
                OpsReport.driverOps => _DriverOps(ar: ar),
                OpsReport.vehicleOps => _VehicleOps(ar: ar),
                OpsReport.tripDuration => _TripDuration(ar: ar),
                OpsReport.inefficientTrips => _InefficientTrips(ar: ar),
                OpsReport.fuelEfficiency => _FuelEfficiency(ar: ar),
                OpsReport.routeCost => _RouteCost(ar: ar),
                OpsReport.attendance => _Attendance(ar: ar),
                OpsReport.planAdherence => _PlanAdherence(ar: ar),
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Shared loading / error / empty handling so each report body stays readable.
class _AsyncList<T> extends StatelessWidget {
  const _AsyncList({
    required this.async,
    required this.ar,
    required this.itemBuilder,
  });

  final AsyncValue<List<T>> async;
  final bool ar;
  final Widget Function(T item) itemBuilder;

  @override
  Widget build(BuildContext context) {
    return async.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(
        child: Text(ar ? 'تعذّر تحميل التقرير' : 'Could not load the report'),
      ),
      data: (items) => items.isEmpty
          ? Center(child: Text(ar ? 'لا بيانات في الفترة' : 'No data in this period'))
          : ListView(
              children: [
                for (final i in items) itemBuilder(i),
                const SizedBox(height: 24),
              ],
            ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.title, required this.subtitle, this.trailing, this.badge});
  final String title;
  final String subtitle;
  final String? trailing;
  final Widget? badge;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        dense: true,
        title: Row(
          children: [
            Expanded(
              child: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
            ),
            if (badge != null) badge!,
          ],
        ),
        subtitle: Text(subtitle),
        trailing: trailing == null
            ? null
            : Text(trailing!, style: const TextStyle(fontWeight: FontWeight.w700)),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.label, required this.color});
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: Theme.of(context)
            .textTheme
            .labelSmall
            ?.copyWith(color: color, fontWeight: FontWeight.w700),
      ),
    );
  }
}

const _red = Color(0xFFE1554E);
const _amber = Color(0xFFC9871A);
const _green = Color(0xFF1E9E58);

class _DriverOps extends ConsumerWidget {
  const _DriverOps({required this.ar});
  final bool ar;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _AsyncList<DriverOpsRow>(
      async: ref.watch(driverOpsProvider),
      ar: ar,
      itemBuilder: (r) => _Row(
        title: r.fullName,
        subtitle: [
          '${r.trips} ${ar ? 'رحلة' : 'trips'}',
          '${r.passengers} ${ar ? 'راكب' : 'pax'}',
          if (r.noShows > 0) '${r.noShows} ${ar ? 'لم يحضروا' : 'no-shows'}',
          if (r.violations > 0) '${r.violations} ${ar ? 'مخالفة' : 'violations'}',
          if (r.avgRating != null) '★ ${r.avgRating!.toStringAsFixed(1)}',
        ].join(' · '),
        trailing: r.onTimePct == null
            ? null
            : '${r.onTimePct}% ${ar ? 'بالوقت' : 'on time'}',
      ),
    );
  }
}

class _VehicleOps extends ConsumerWidget {
  const _VehicleOps({required this.ar});
  final bool ar;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _AsyncList<VehicleOpsRow>(
      async: ref.watch(vehicleOpsProvider),
      ar: ar,
      itemBuilder: (v) => _Row(
        title: v.plateNo,
        subtitle: [
          '${v.trips} ${ar ? 'رحلة' : 'trips'}',
          '${v.passengers} ${ar ? 'راكب' : 'pax'}',
          if (v.drivenKm != null && v.drivenKm! > 0)
            '${v.drivenKm!.toStringAsFixed(0)} ${ar ? 'كم' : 'km'}',
          if (v.fuelCost != null && v.fuelCost! > 0)
            '${v.fuelCost!.toStringAsFixed(2)} ${ar ? 'بنزين' : 'fuel'}',
        ].join(' · '),
        trailing: v.utilizationPct == null
            ? null
            : '${v.utilizationPct}% ${ar ? 'إشغال' : 'used'}',
      ),
    );
  }
}

class _TripDuration extends ConsumerWidget {
  const _TripDuration({required this.ar});
  final bool ar;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(tripDurationProvider);
    return async.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(
        child: Text(ar ? 'تعذّر تحميل التقرير' : 'Could not load the report'),
      ),
      data: (r) => ListView(
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    ar ? '${r.trips} رحلة' : '${r.trips} trips',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 4),
                  Text([
                    if (r.avgPlannedMinutes != null)
                      '${ar ? 'مخطط' : 'planned'} ${r.avgPlannedMinutes!.toStringAsFixed(0)}${ar ? ' د' : 'm'}',
                    if (r.avgActualMinutes != null)
                      '${ar ? 'فعلي' : 'actual'} ${r.avgActualMinutes!.toStringAsFixed(0)}${ar ? ' د' : 'm'}',
                    if (r.avgStartDelayMin != null)
                      '${ar ? 'تأخير البداية' : 'start delay'} ${r.avgStartDelayMin!.toStringAsFixed(1)}${ar ? ' د' : 'm'}',
                    '${r.lateStarts} ${ar ? 'بداية متأخرة' : 'late starts'}',
                  ].join(' · '),),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          if (r.perRoute.isEmpty)
            Center(child: Text(ar ? 'لا مسارات في الفترة' : 'No routes in this period'))
          else
            for (final x in r.perRoute)
              _Row(
                title: x.routeName,
                subtitle: [
                  '${x.trips} ${ar ? 'رحلة' : 'trips'}',
                  if (x.avgPlannedMinutes != null)
                    '${ar ? 'مخطط' : 'planned'} ${x.avgPlannedMinutes!.toStringAsFixed(0)}',
                  if (x.avgActualMinutes != null)
                    '${ar ? 'فعلي' : 'actual'} ${x.avgActualMinutes!.toStringAsFixed(0)}',
                ].join(' · '),
                trailing: x.avgOverrunMin == null
                    ? null
                    : '${x.avgOverrunMin! > 0 ? '+' : ''}${x.avgOverrunMin!.toStringAsFixed(0)}${ar ? ' د' : 'm'}',
              ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _InefficientTrips extends ConsumerWidget {
  const _InefficientTrips({required this.ar});
  final bool ar;

  String _flagLabel(String f) => switch (f) {
        'detour' => ar ? 'لفّ' : 'detour',
        'idling' => ar ? 'وقوف' : 'idling',
        'overrun' => ar ? 'تأخير' : 'overrun',
        _ => f,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _AsyncList<InefficientTripRow>(
      async: ref.watch(inefficientTripsProvider),
      ar: ar,
      itemBuilder: (t) => _Row(
        title: [
          if (t.routeName.isNotEmpty) t.routeName,
          if (t.driverName.isNotEmpty) t.driverName,
          if (t.plateNo.isNotEmpty) t.plateNo,
        ].join(' — '),
        subtitle: [
          if (t.actualKm != null && t.referenceKm != null)
            '${t.actualKm!.toStringAsFixed(1)} / ${t.referenceKm!.toStringAsFixed(1)} ${ar ? 'كم' : 'km'}',
          if (t.idleShare != null) '${(t.idleShare! * 100).toStringAsFixed(0)}% ${ar ? 'وقوف' : 'idle'}',
          if (t.overrunPct != null) '${t.overrunPct!.toStringAsFixed(0)}% ${ar ? 'زيادة' : 'over'}',
          t.flags.map(_flagLabel).join(' + '),
        ].join(' · '),
        trailing: t.detourRatio == null ? null : '×${t.detourRatio!.toStringAsFixed(2)}',
        badge: _Badge(label: '${t.flags.length}', color: t.flags.length > 1 ? _red : _amber),
      ),
    );
  }
}

class _FuelEfficiency extends ConsumerWidget {
  const _FuelEfficiency({required this.ar});
  final bool ar;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(fuelEfficiencyProvider);
    return async.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(
        child: Text(ar ? 'تعذّر تحميل التقرير' : 'Could not load the report'),
      ),
      data: (r) => r.vehicles.isEmpty
          ? Center(child: Text(ar ? 'لا بيانات في الفترة' : 'No data in this period'))
          : ListView(
              children: [
                Card(
                  child: ListTile(
                    dense: true,
                    title: Text(
                      r.fleetMedianKmPerLiter == null
                          ? (ar ? 'لا وسيط للأسطول' : 'No fleet median')
                          : (ar
                              ? 'وسيط الأسطول ${r.fleetMedianKmPerLiter!.toStringAsFixed(2)} كم/لتر'
                              : 'Fleet median ${r.fleetMedianKmPerLiter!.toStringAsFixed(2)} km/L'),
                    ),
                    subtitle: Text(
                      ar
                          ? 'كل باص بيتقارن بالوسيط مش بهدف ثابت — ${r.anomalies} باص خارج المعدّل'
                          : 'Each bus is judged against the median, not a fixed target — ${r.anomalies} flagged',
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                for (final v in r.vehicles)
                  _Row(
                    title: v.plateNo,
                    subtitle: [
                      '${v.fills} ${ar ? 'تعبئة' : 'fills'}',
                      if (v.costPerKm != null)
                        '${v.costPerKm!.toStringAsFixed(3)} ${ar ? 'لكل كم' : 'per km'}',
                      if (v.insufficientData) (ar ? 'بيانات غير كافية' : 'insufficient data'),
                      if (v.deviationPct != null && !v.insufficientData)
                        '${v.deviationPct! > 0 ? '+' : ''}${v.deviationPct!.toStringAsFixed(0)}% ${ar ? 'عن الوسيط' : 'vs median'}',
                    ].join(' · '),
                    trailing: v.kmPerLiter == null
                        ? '—'
                        : '${v.kmPerLiter!.toStringAsFixed(2)} ${ar ? 'كم/لتر' : 'km/L'}',
                    badge: v.anomaly
                        ? _Badge(label: ar ? 'شاذ' : 'anomaly', color: _red)
                        : null,
                  ),
                const SizedBox(height: 24),
              ],
            ),
    );
  }
}

class _RouteCost extends ConsumerWidget {
  const _RouteCost({required this.ar});
  final bool ar;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _AsyncList<RouteCostRow>(
      async: ref.watch(routeCostProvider),
      ar: ar,
      itemBuilder: (r) => _Row(
        title: r.routeName,
        subtitle: [
          '${r.trips} ${ar ? 'رحلة' : 'trips'}',
          '${r.passengers} ${ar ? 'راكب' : 'pax'}',
          if (r.costPerPassenger != null)
            '${r.costPerPassenger!.toStringAsFixed(3)} ${ar ? 'للراكب' : 'per pax'}',
          if (r.costPerKm != null)
            '${r.costPerKm!.toStringAsFixed(3)} ${ar ? 'للكم' : 'per km'}',
        ].join(' · '),
        trailing: r.totalCost.toStringAsFixed(2),
      ),
    );
  }
}

class _Attendance extends ConsumerWidget {
  const _Attendance({required this.ar});
  final bool ar;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _AsyncList<AttendanceRow>(
      async: ref.watch(attendanceProvider),
      ar: ar,
      itemBuilder: (e) => _Row(
        title: e.fullName,
        subtitle: [
          if (e.department != null && e.department!.isNotEmpty) e.department!,
          '${e.boarded}/${e.scheduled} ${ar ? 'ركب' : 'boarded'}',
          if (e.excused > 0) '${e.excused} ${ar ? 'بعذر' : 'excused'}',
        ].join(' · '),
        trailing: '${e.noShows} · ${e.noShowPct}%',
        badge: e.disciplineFlag
            ? _Badge(label: ar ? 'متكرر' : 'repeated', color: _red)
            : null,
      ),
    );
  }
}

class _PlanAdherence extends ConsumerWidget {
  const _PlanAdherence({required this.ar});
  final bool ar;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _AsyncList<PlanAdherenceRow>(
      async: ref.watch(planAdherenceProvider),
      ar: ar,
      itemBuilder: (p) => _Row(
        title: p.driverName,
        subtitle: [
          if (p.serviceDate != null)
            '${p.serviceDate!.year}-${p.serviceDate!.month.toString().padLeft(2, '0')}-${p.serviceDate!.day.toString().padLeft(2, '0')}',
          if (p.windowStart != null && p.windowEnd != null) '${p.windowStart} → ${p.windowEnd}',
          '${p.trips} ${ar ? 'رحلة' : 'trips'}',
          if (p.inWindow == false) (ar ? 'خارج الوقت' : 'outside the window'),
        ].join(' · '),
        trailing: p.zoneAdherencePct == null
            ? null
            : '${p.zoneAdherencePct}% ${ar ? 'داخل الزون' : 'in zone'}',
        badge: _Badge(
          label: p.adherent ? (ar ? 'ملتزم' : 'adherent') : (ar ? 'خارج الخطة' : 'off plan'),
          color: p.adherent ? _green : _amber,
        ),
      ),
    );
  }
}
