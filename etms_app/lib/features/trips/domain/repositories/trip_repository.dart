import 'package:fpdart/fpdart.dart';

import '../../../../core/error/failures.dart';
import '../entities/trip.dart';

/// Domain contract for trips. Reads are offline-first streams (cache → refresh);
/// mutations are queued to the outbox and reconciled by the sync engine.
abstract interface class TripRepository {
  /// Emits today's trips from the local cache immediately, then updates as the
  /// server refresh completes and on realtime changes.
  Stream<List<Trip>> watchTodayTrips();

  /// Records a lifecycle event (start / pickup / dropoff / complete). Works
  /// offline: persisted locally + enqueued with an idempotency key.
  Future<Either<Failure, Unit>> markTripEvent({
    required String tripId,
    required String eventType,
    String? routeStopId,
    String? employeeId,
    double? lat,
    double? lng,
  });
}
