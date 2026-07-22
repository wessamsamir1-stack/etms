import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/commute_models.dart';
import '../providers/commute_providers.dart';

/// Employee screen for the daily commute (docs/etms/17 §8). Shows the trip /
/// bus status and pickup point, a live waiting countdown once the bus has
/// arrived, and the "I'm on the way" action. Live map + ETA come from the
/// tracking feature (GPS pings) — surfaced here as the status banner.
class EmployeeTripScreen extends ConsumerWidget {
  const EmployeeTripScreen({super.key, required this.tripId});
  final String tripId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final async = ref.watch(tripManifestProvider(tripId));
    return Scaffold(
      appBar: AppBar(title: Text(ar ? 'رحلتك' : 'Your ride')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(tripManifestProvider(tripId)),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [
            const SizedBox(height: 120),
            Center(child: Text(ar ? 'تعذّر تحميل الرحلة' : 'Could not load the trip')),
          ]),
          data: (m) => _EmployeeBody(tripId: tripId, manifest: m, ar: ar),
        ),
      ),
    );
  }
}

class _EmployeeBody extends ConsumerWidget {
  const _EmployeeBody({required this.tripId, required this.manifest, required this.ar});
  final String tripId;
  final TripManifest manifest;
  final bool ar;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final stop = manifest.currentStop;
    final arrived = stop?.status == 'arrived';
    final svc = ref.read(commuteServiceProvider);

    Future<void> onTheWay() async {
      try {
        await svc.onTheWay(tripId);
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text(ar ? 'أبلغنا السائق بأنك في الطريق' : 'The driver has been notified')));
        }
      } catch (_) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text(ar ? 'تعذّر الإرسال' : 'Could not send')));
        }
      } finally {
        ref.invalidate(tripManifestProvider(tripId));
      }
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Status banner
        Card(
          color: arrived
              ? const Color(0xFF1E9E58).withOpacity(0.12)
              : theme.colorScheme.primary.withOpacity(0.10),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Icon(arrived ? Icons.directions_bus : Icons.near_me,
                    color: arrived ? const Color(0xFF1E9E58) : theme.colorScheme.primary),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    arrived
                        ? (ar ? 'وصل باص الشركة إلى نقطة التجمّع' : 'The company bus has arrived')
                        : (ar ? 'الباص في الطريق إليك' : 'The bus is on the way'),
                    style: theme.textTheme.titleMedium,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        // Pickup + countdown
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(ar ? 'نقطة تجمّعك' : 'Your pickup', style: theme.textTheme.labelMedium),
                const SizedBox(height: 2),
                Text(stop?.name ?? (ar ? 'غير محدّد' : 'Not set'),
                    style: theme.textTheme.titleLarge),
                if (arrived) ...[
                  const SizedBox(height: 12),
                  _MiniCountdown(seconds: manifest.countdownSeconds, ar: ar),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        FilledButton.icon(
          style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
          onPressed: onTheWay,
          icon: const Icon(Icons.directions_walk),
          label: Text(ar ? 'أنا في الطريق' : "I'm on the way"),
        ),
        const SizedBox(height: 8),
        Text(
          ar
              ? 'زر «أنا في الطريق» يُبلّغ السائق — لكنه لا يوقف العدّاد؛ يتحرّك الباص عند انتهاء الوقت.'
              : '"I\'m on the way" notifies the driver — it does not pause the timer; the bus leaves when the countdown ends.',
          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
        ),
      ],
    );
  }
}

class _MiniCountdown extends StatefulWidget {
  const _MiniCountdown({required this.seconds, required this.ar});
  final int? seconds;
  final bool ar;
  @override
  State<_MiniCountdown> createState() => _MiniCountdownState();
}

class _MiniCountdownState extends State<_MiniCountdown> {
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
    final mm = (_s ~/ 60).toString().padLeft(2, '0');
    final ss = (_s % 60).toString().padLeft(2, '0');
    return Row(
      children: [
        const Icon(Icons.timer_outlined, size: 18, color: Color(0xFFC9871A)),
        const SizedBox(width: 6),
        Text(
          widget.ar ? 'يتحرّك خلال $mm:$ss' : 'Leaves in $mm:$ss',
          style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFFC9871A)),
        ),
      ],
    );
  }
}
