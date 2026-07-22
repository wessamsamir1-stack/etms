import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/providers.dart';
import '../../data/datasources/trip_local_data_source.dart';
import '../../data/datasources/trip_remote_data_source.dart';
import '../../data/repositories/trip_repository_impl.dart';
import '../../domain/entities/trip.dart';
import '../../domain/repositories/trip_repository.dart';
import '../../domain/usecases/mark_trip_event.dart';
import '../../domain/usecases/watch_today_trips.dart';

final _tripRemoteProvider = Provider<TripRemoteDataSource>(
  (ref) => TripRemoteDataSourceImpl(ref.watch(apiClientProvider)),
);

final _tripLocalProvider = Provider<TripLocalDataSource>(
  (ref) => TripLocalDataSourceImpl(ref.watch(localDatabaseProvider).db),
);

final tripRepositoryProvider = Provider<TripRepository>(
  (ref) => TripRepositoryImpl(
    remote: ref.watch(_tripRemoteProvider),
    local: ref.watch(_tripLocalProvider),
    outbox: ref.watch(outboxDaoProvider),
    sync: ref.watch(syncEngineProvider),
    network: ref.watch(networkInfoProvider),
  ),
);

final markTripEventProvider =
    Provider<MarkTripEvent>((ref) => MarkTripEvent(ref.watch(tripRepositoryProvider)));

/// Offline-first stream of today's trips for the driver's "Today" screen.
final todayTripsProvider = StreamProvider<List<Trip>>((ref) {
  final usecase = WatchTodayTrips(ref.watch(tripRepositoryProvider));
  return usecase();
});
