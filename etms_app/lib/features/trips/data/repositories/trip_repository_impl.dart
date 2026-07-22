import 'dart:math';

import 'package:fpdart/fpdart.dart';

import '../../../../core/constants/app_constants.dart';
import '../../../../core/error/exceptions.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/network/network_info.dart';
import '../../../../core/offline/outbox_dao.dart';
import '../../../../core/offline/sync_engine.dart';
import '../../domain/entities/trip.dart';
import '../../domain/repositories/trip_repository.dart';
import '../datasources/trip_local_data_source.dart';
import '../datasources/trip_remote_data_source.dart';

/// Offline-first trip repository.
///
/// Reads: cache first, then a network refresh when online.
/// Writes: persisted to the outbox with an idempotency key and drained by the
/// [SyncEngine]; the operation succeeds locally even with no connectivity.
class TripRepositoryImpl implements TripRepository {
  TripRepositoryImpl({
    required TripRemoteDataSource remote,
    required TripLocalDataSource local,
    required OutboxDao outbox,
    required SyncEngine sync,
    required NetworkInfo network,
  })  : _remote = remote,
        _local = local,
        _outbox = outbox,
        _sync = sync,
        _network = network {
    // Register how queued trip events reach the server.
    _sync.registerHandler(Resources.tripEvents, _pushEvent);
  }

  final TripRemoteDataSource _remote;
  final TripLocalDataSource _local;
  final OutboxDao _outbox;
  final SyncEngine _sync;
  final NetworkInfo _network;
  final _rand = Random();

  @override
  Stream<List<Trip>> watchTodayTrips() async* {
    // 1) Immediate render from local cache.
    final cached = await _local.readCached();
    yield cached.map((d) => d.toEntity()).toList();

    // 2) Refresh from server when connectivity allows.
    if (await _network.isConnected) {
      try {
        final fresh = await _remote.fetchToday();
        await _local.cache(fresh);
        yield fresh.map((d) => d.toEntity()).toList();
      } on AppException {
        // Keep showing cached data; the UI's offline/sync chips signal state.
      }
    }
  }

  @override
  Future<Either<Failure, Unit>> markTripEvent({
    required String tripId,
    required String eventType,
    String? routeStopId,
    String? employeeId,
    double? lat,
    double? lng,
  }) async {
    try {
      final clientEventId = _clientEventId();
      await _outbox.enqueue(
        resource: Resources.tripEvents,
        operation: 'custom',
        entityId: tripId,
        clientEventId: clientEventId,
        payload: {
          'trip_id': tripId,
          'client_event_id': clientEventId,
          'type': eventType,
          'route_stop_id': routeStopId,
          'employee_id': employeeId,
          'lat': lat,
          'lng': lng,
          'at': DateTime.now().toUtc().toIso8601String(),
        },
      );
      // Best-effort immediate drain; if offline it stays queued and retries.
      await _sync.flush();
      return const Right(unit);
    } on CacheException catch (e) {
      return Left(CacheFailure(e.message));
    } catch (_) {
      return const Left(UnexpectedFailure());
    }
  }

  /// SyncHandler: send one queued trip event to the API.
  Future<void> _pushEvent(OutboxEntry entry) async {
    final p = entry.payload;
    final tripId = p['trip_id'] as String;
    await _remote.postEvents(tripId, [
      {
        'client_event_id': p['client_event_id'],
        'type': p['type'],
        if (p['route_stop_id'] != null) 'route_stop_id': p['route_stop_id'],
        if (p['employee_id'] != null) 'employee_id': p['employee_id'],
        if (p['lat'] != null) 'lat': p['lat'],
        if (p['lng'] != null) 'lng': p['lng'],
        'at': p['at'],
      },
    ]);
  }

  String _clientEventId() =>
      '${DateTime.now().microsecondsSinceEpoch}-${_rand.nextInt(1 << 32)}';
}
