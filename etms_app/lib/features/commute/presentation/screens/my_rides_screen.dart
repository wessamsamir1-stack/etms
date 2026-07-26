import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/commute_models.dart';
import '../providers/commute_providers.dart';

/// The employee's own ride history (docs/etms/17 §11 / GET /v1/my/rides):
/// how many rides, which were boarded / no-show, and the last trip.
class MyRidesScreen extends ConsumerWidget {
  const MyRidesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final async = ref.watch(myRidesProvider);
    return Scaffold(
      appBar: AppBar(title: Text(ar ? 'رحلاتي' : 'My rides')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(myRidesProvider),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [
            const SizedBox(height: 120),
            Center(child: Text(ar ? 'تعذّر تحميل السجل' : 'Could not load history')),
          ],),
          data: (rides) => rides.isEmpty
              ? ListView(children: [
                  const SizedBox(height: 120),
                  Center(child: Text(ar ? 'لا رحلات بعد' : 'No rides yet')),
                ],)
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _Summary(rides: rides, ar: ar),
                    const SizedBox(height: 12),
                    for (final r in rides) _RideTile(ride: r, ar: ar),
                  ],
                ),
        ),
      ),
    );
  }
}

class _Summary extends StatelessWidget {
  const _Summary({required this.rides, required this.ar});
  final List<MyRide> rides;
  final bool ar;
  @override
  Widget build(BuildContext context) {
    final boarded = rides.where((r) => r.status == PassengerStatus.boarded).length;
    final noShow = rides.where((r) => r.status == PassengerStatus.noShow).length;
    return Row(
      children: [
        _Stat(value: rides.length, label: ar ? 'إجمالي' : 'Total', color: Theme.of(context).colorScheme.primary),
        _Stat(value: boarded, label: ar ? 'ركبت' : 'Boarded', color: const Color(0xFF1E9E58)),
        _Stat(value: noShow, label: ar ? 'لم تحضر' : 'No-show', color: const Color(0xFFE1554E)),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label, required this.color});
  final int value;
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
          Text('$value', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800, color: color)),
          Text(label, style: Theme.of(context).textTheme.labelSmall),
        ],),
      ),
    );
  }
}

class _RideTile extends StatelessWidget {
  const _RideTile({required this.ride, required this.ar});
  final MyRide ride;
  final bool ar;
  @override
  Widget build(BuildContext context) {
    final (color, label) = _style(ride.status, ar);
    final dir = ride.direction == 'inbound' ? (ar ? 'ذهاب' : 'Inbound') : (ar ? 'عودة' : 'Outbound');
    final d = ride.serviceDate;
    final date = d == null ? '' : '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(radius: 6, backgroundColor: color),
        title: Text('$date · $dir'),
        trailing: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w700)),
      ),
    );
  }
}

(Color, String) _style(PassengerStatus s, bool ar) {
  switch (s) {
    case PassengerStatus.boarded:
      return (const Color(0xFF1E9E58), ar ? 'ركبت' : 'Boarded');
    case PassengerStatus.noShow:
      return (const Color(0xFFE1554E), ar ? 'لم تحضر' : 'No-show');
    case PassengerStatus.excused:
    case PassengerStatus.onLeave:
      return (const Color(0xFF8494AC), ar ? 'إجازة' : 'On leave');
    default:
      return (const Color(0xFF1E5AA8), ar ? 'مجدولة' : 'Scheduled');
  }
}
