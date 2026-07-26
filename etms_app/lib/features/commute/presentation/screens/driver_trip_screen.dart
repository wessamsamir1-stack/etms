import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/commute_models.dart';
import '../providers/commute_providers.dart';

/// Driver screen for the daily commute (docs/etms/17 §7). Shows the current
/// stop, the waiting countdown, expected/boarded/remaining counts, the
/// colour-coded passenger manifest, and the Arrived / Board / Next-stop actions.
class DriverTripScreen extends ConsumerWidget {
  const DriverTripScreen({super.key, required this.tripId});
  final String tripId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final async = ref.watch(tripManifestProvider(tripId));
    return Scaffold(
      appBar: AppBar(title: Text(ar ? 'رحلتي' : 'My trip')),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _Retry(onRetry: () => ref.invalidate(tripManifestProvider(tripId))),
        data: (m) => _DriverBody(tripId: tripId, manifest: m, ar: ar),
      ),
    );
  }
}

class _DriverBody extends ConsumerWidget {
  const _DriverBody({required this.tripId, required this.manifest, required this.ar});
  final String tripId;
  final TripManifest manifest;
  final bool ar;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final svc = ref.read(commuteServiceProvider);
    void refresh() => ref.invalidate(tripManifestProvider(tripId));
    final stop = manifest.currentStop;
    final c = manifest.counts;

    Future<void> run(Future<void> Function() action) async {
      try {
        await action();
      } catch (_) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(ar ? 'تعذّر تنفيذ العملية' : 'Action failed')),
          );
        }
      } finally {
        refresh();
      }
    }

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // Current stop + countdown
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Text(
                        stop == null
                            ? (ar ? 'لا محطة حالية' : 'No current stop')
                            : (ar ? 'المحطة ${stop.seq + 1}' : 'Stop ${stop.seq + 1}'),
                        style: theme.textTheme.labelMedium,
                      ),
                      const SizedBox(height: 2),
                      Text(stop?.name ?? '—',
                          style: theme.textTheme.titleLarge, textAlign: TextAlign.center,),
                      const SizedBox(height: 12),
                      _Countdown(seconds: manifest.countdownSeconds),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              // Counts
              Row(
                children: [
                  _CountTile(value: c.expected, label: ar ? 'متوقّع' : 'Expected', color: theme.colorScheme.primary),
                  _CountTile(value: c.boarded, label: ar ? 'ركبوا' : 'Boarded', color: const Color(0xFF1E9E58)),
                  _CountTile(value: c.remaining, label: ar ? 'متبقّي' : 'Remaining', color: const Color(0xFFC9871A)),
                ],
              ),
              const SizedBox(height: 12),
              Text(ar ? 'قائمة الركّاب' : 'Passenger manifest', style: theme.textTheme.labelLarge),
              const SizedBox(height: 8),
              for (final p in manifest.passengers)
                _PassengerRow(
                  passenger: p,
                  ar: ar,
                  onBoard: (p.status == PassengerStatus.expected || p.status == PassengerStatus.onTheWay)
                      ? () => run(() => svc.board(tripId, p.id))
                      : null,
                ),
            ],
          ),
        ),
        // Actions
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
            child: Row(
              children: [
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF1E9E58),
                      padding: const EdgeInsets.symmetric(vertical: 16),
                    ),
                    onPressed: (stop != null && stop.status == 'pending')
                        ? () => run(() => svc.arrive(tripId, stop.id))
                        : null,
                    child: Text(ar ? 'وصلت' : 'Arrived'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton(
                    onPressed: (stop != null && stop.status == 'arrived')
                        ? () => run(() => svc.depart(tripId, stop.id))
                        : null,
                    child: Text(ar ? 'المحطة التالية' : 'Next stop'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Ticking countdown from the server's `countdownSeconds`.
class _Countdown extends StatefulWidget {
  const _Countdown({required this.seconds});
  final int? seconds;
  @override
  State<_Countdown> createState() => _CountdownState();
}

class _CountdownState extends State<_Countdown> {
  Timer? _timer;
  int _s = 0;

  @override
  void initState() {
    super.initState();
    _s = widget.seconds ?? 0;
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _s = _s > 0 ? _s - 1 : 0);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    if (widget.seconds == null) {
      return Text(ar ? 'لم يصل الباص بعد' : 'Not arrived yet',
          style: Theme.of(context).textTheme.bodyMedium,);
    }
    final mm = (_s ~/ 60).toString().padLeft(2, '0');
    final ss = (_s % 60).toString().padLeft(2, '0');
    final urgent = _s <= 30;
    return Column(
      children: [
        Text('$mm:$ss',
            style: Theme.of(context).textTheme.displaySmall?.copyWith(
                  fontWeight: FontWeight.w800,
                  color: urgent ? const Color(0xFFE1554E) : const Color(0xFFC9871A),
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),),
        Text(ar ? 'متبقّي على التحرّك' : 'until departure',
            style: Theme.of(context).textTheme.labelSmall,),
      ],
    );
  }
}

class _CountTile extends StatelessWidget {
  const _CountTile({required this.value, required this.label, required this.color});
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
          color: (Theme.of(context).brightness == Brightness.dark ? const Color(0xFF17263C) : const Color(0xFFEEF4FB)),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          children: [
            Text('$value',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800, color: color,),),
            Text(label, style: Theme.of(context).textTheme.labelSmall),
          ],
        ),
      ),
    );
  }
}

class _PassengerRow extends StatelessWidget {
  const _PassengerRow({required this.passenger, required this.ar, this.onBoard});
  final Passenger passenger;
  final bool ar;
  final VoidCallback? onBoard;

  @override
  Widget build(BuildContext context) {
    final (color, label) = _statusStyle(passenger.status, ar);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(radius: 6, backgroundColor: color),
        title: Text(passenger.fullName),
        subtitle: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w700)),
        trailing: onBoard == null
            ? null
            : TextButton(onPressed: onBoard, child: Text(ar ? 'ركب' : 'Board')),
      ),
    );
  }
}

(Color, String) _statusStyle(PassengerStatus s, bool ar) {
  switch (s) {
    case PassengerStatus.boarded:
      return (const Color(0xFF1E9E58), ar ? 'ركب' : 'Boarded');
    case PassengerStatus.onTheWay:
      return (const Color(0xFFC9871A), ar ? 'في الطريق' : 'On the way');
    case PassengerStatus.noShow:
      return (const Color(0xFFE1554E), ar ? 'لم يحضر' : 'No-show');
    case PassengerStatus.excused:
    case PassengerStatus.onLeave:
      return (const Color(0xFF8494AC), ar ? 'إجازة / اعتذر' : 'On leave');
    case PassengerStatus.removed:
      return (const Color(0xFF8494AC), ar ? 'مستبعد' : 'Removed');
    case PassengerStatus.expected:
    case PassengerStatus.unknown:
      return (const Color(0xFF1E5AA8), ar ? 'متوقّع' : 'Expected');
  }
}

class _Retry extends StatelessWidget {
  const _Retry({required this.onRetry});
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(ar ? 'تعذّر تحميل الرحلة' : 'Could not load the trip'),
          const SizedBox(height: 8),
          FilledButton(onPressed: onRetry, child: Text(ar ? 'إعادة المحاولة' : 'Retry')),
        ],
      ),
    );
  }
}
