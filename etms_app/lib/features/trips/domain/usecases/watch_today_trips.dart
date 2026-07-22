import '../entities/trip.dart';
import '../repositories/trip_repository.dart';

/// Streaming read of today's trips (offline-first). Kept as a thin use-case so
/// presentation depends on the domain, not the repository implementation.
class WatchTodayTrips {
  const WatchTodayTrips(this._repo);
  final TripRepository _repo;

  Stream<List<Trip>> call() => _repo.watchTodayTrips();
}
