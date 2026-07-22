import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/localization/l10n_extensions.dart';
import '../../../../shared/widgets/offline_banner.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../../shared/widgets/sync_status_chip.dart';
import '../providers/trip_providers.dart';
import '../widgets/trip_card.dart';

/// Driver "Today" screen — offline-first list backed by [todayTripsProvider].
class TripsScreen extends ConsumerWidget {
  const TripsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trips = ref.watch(todayTripsProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(context.l10n.tripsToday),
        actions: const [SyncStatusChip()],
      ),
      body: OfflineBanner(
        child: trips.when(
          loading: () => const LoadingIndicator(),
          error: (e, _) => ErrorView(
            message: e.toString(),
            onRetry: () => ref.invalidate(todayTripsProvider),
          ),
          data: (list) => list.isEmpty
              ? const EmptyState(icon: Icons.directions_bus_outlined)
              : RefreshIndicator(
                  onRefresh: () async => ref.invalidate(todayTripsProvider),
                  child: ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: list.length,
                    itemBuilder: (_, i) => TripCard(trip: list[i]),
                  ),
                ),
        ),
      ),
    );
  }
}
