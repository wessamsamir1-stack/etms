import 'dart:async';

import '../constants/app_constants.dart';
import '../network/network_info.dart';
import '../utils/logger.dart';
import 'outbox_dao.dart';
import 'sync_status.dart';

/// Pushes a single outbox entry to the server. Feature modules register a
/// handler per resource (e.g. trip events → POST /trips/{id}/events). Returning
/// normally = success; throwing = failure (the entry is retried with backoff).
typedef SyncHandler = Future<void> Function(OutboxEntry entry);

/// Drains the offline outbox to the server whenever connectivity allows,
/// with exponential backoff and idempotent replay (client_event_id).
///
/// Conflict policy: the server is authoritative. Handlers send the mutation;
/// on 409/2xx-duplicate the server no-ops (idempotency), on 4xx-conflict the
/// handler resolves by refetching. Last-writer-wins per field, audited server-side.
class SyncEngine {
  SyncEngine({
    required OutboxDao outbox,
    required NetworkInfo network,
  })  : _outbox = outbox,
        _network = network;

  final OutboxDao _outbox;
  final NetworkInfo _network;
  final Map<String, SyncHandler> _handlers = {};

  final _stateCtrl = StreamController<SyncState>.broadcast();
  SyncState _state = const SyncState();
  StreamSubscription<bool>? _connSub;
  Timer? _retryTimer;
  bool _draining = false;

  Stream<SyncState> get state => _stateCtrl.stream;
  SyncState get current => _state;

  /// Register how a given resource's queued mutations are sent.
  void registerHandler(String resource, SyncHandler handler) =>
      _handlers[resource] = handler;

  Future<void> start() async {
    _connSub = _network.onStatusChange.listen((online) {
      _emit(_state.copyWith(online: online));
      if (online) unawaited(drain());
    });
    _emit(_state.copyWith(online: await _network.isConnected));
    await _refreshCounts();
    unawaited(drain());
  }

  /// Enqueue-then-drain entry point used by repositories after a local write.
  Future<void> flush() => drain();

  Future<void> drain() async {
    if (_draining) return;
    if (!await _network.isConnected) return;
    _draining = true;
    _emit(_state.copyWith(syncing: true));
    try {
      var batch = await _outbox.pending();
      while (batch.isNotEmpty) {
        for (final entry in batch) {
          await _process(entry);
        }
        batch = await _outbox.pending();
      }
    } finally {
      _draining = false;
      await _refreshCounts();
      _emit(_state.copyWith(syncing: false));
    }
  }

  Future<void> _process(OutboxEntry entry) async {
    final handler = _handlers[entry.resource];
    if (handler == null) {
      appLogger.w('No sync handler for "${entry.resource}"; skipping');
      return;
    }
    try {
      await _outbox.markSyncing(entry.id);
      await handler(entry);
      await _outbox.markDone(entry.id);
    } catch (e) {
      await _outbox.markFailed(entry.id, e.toString());
      if (entry.attempts + 1 >= AppConstants.maxSyncRetries) {
        appLogger.e('Outbox entry ${entry.id} exhausted retries', error: e);
      } else {
        _scheduleRetry(entry.attempts + 1);
      }
    }
  }

  /// Exponential backoff: 2^attempts seconds, capped at 5 minutes.
  void _scheduleRetry(int attempts) {
    _retryTimer?.cancel();
    final secs = (1 << attempts).clamp(2, 300);
    _retryTimer = Timer(Duration(seconds: secs), () => unawaited(drain()));
  }

  Future<void> _refreshCounts() async {
    final pending = await _outbox.counts('pending');
    final failed = await _outbox.counts('failed');
    _emit(_state.copyWith(pending: pending, failed: failed));
  }

  void _emit(SyncState s) {
    _state = s;
    if (!_stateCtrl.isClosed) _stateCtrl.add(s);
  }

  Future<void> dispose() async {
    await _connSub?.cancel();
    _retryTimer?.cancel();
    await _stateCtrl.close();
  }
}
