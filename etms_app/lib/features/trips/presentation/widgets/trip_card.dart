import 'package:flutter/material.dart';

import '../../../../core/localization/l10n_extensions.dart';
import '../../../../shared/widgets/status_chip.dart';
import '../../domain/entities/trip.dart';

class TripCard extends StatelessWidget {
  const TripCard({super.key, required this.trip, this.onTap});
  final Trip trip;
  final VoidCallback? onTap;

  String _statusLabel(BuildContext context) {
    final l10n = context.l10n;
    return switch (trip.status) {
      TripStatus.scheduled => l10n.tripStatusScheduled,
      TripStatus.assigned => l10n.tripStatusAssigned,
      TripStatus.started || TripStatus.inProgress => l10n.tripStatusInProgress,
      TripStatus.completed => l10n.tripStatusCompleted,
      TripStatus.cancelled => l10n.tripStatusCancelled,
      TripStatus.exception => l10n.tripStatusException,
    };
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        onTap: onTap,
        title: Text(trip.routeName ?? trip.direction),
        subtitle: Text(
          context.l10n.seatsLabel(trip.seatsTaken, trip.capacity ?? 0),
        ),
        trailing: StatusChip(
          status: trip.status.wire,
          label: _statusLabel(context),
        ),
      ),
    );
  }
}
