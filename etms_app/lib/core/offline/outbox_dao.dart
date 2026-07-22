import 'dart:convert';

import 'package:sqflite/sqflite.dart';

import '../constants/app_constants.dart';

/// A queued offline mutation.
class OutboxEntry {
  const OutboxEntry({
    required this.id,
    required this.resource,
    required this.operation,
    required this.payload,
    required this.clientEventId,
    this.entityId,
    this.endpoint,
    this.attempts = 0,
    this.lastError,
  });

  final int id;
  final String resource;
  final String operation; // insert | update | delete | custom
  final String? entityId;
  final String? endpoint;
  final Map<String, dynamic> payload;
  final String clientEventId;
  final int attempts;
  final String? lastError;

  static OutboxEntry fromRow(Map<String, dynamic> r) => OutboxEntry(
        id: r['id'] as int,
        resource: r['resource'] as String,
        operation: r['operation'] as String,
        entityId: r['entity_id'] as String?,
        endpoint: r['endpoint'] as String?,
        payload: jsonDecode(r['payload'] as String) as Map<String, dynamic>,
        clientEventId: r['client_event_id'] as String,
        attempts: r['attempts'] as int,
        lastError: r['last_error'] as String?,
      );
}

/// Data-access for the sync outbox. All offline writes go through [enqueue];
/// the [SyncEngine] drains via [pending]/[markDone]/[markFailed].
class OutboxDao {
  OutboxDao(this._db);
  final Database _db;

  Future<void> enqueue({
    required String resource,
    required String operation,
    required Map<String, dynamic> payload,
    required String clientEventId,
    String? entityId,
    String? endpoint,
  }) async {
    await _db.insert(
      AppConstants.outboxTable,
      {
        'resource': resource,
        'operation': operation,
        'entity_id': entityId,
        'endpoint': endpoint,
        'payload': jsonEncode(payload),
        'client_event_id': clientEventId,
        'status': 'pending',
        'attempts': 0,
        'created_at': DateTime.now().millisecondsSinceEpoch,
      },
      // Idempotent enqueue: re-queuing the same client_event_id is a no-op.
      conflictAlgorithm: ConflictAlgorithm.ignore,
    );
  }

  Future<List<OutboxEntry>> pending({int limit = AppConstants.syncBatchSize}) async {
    final rows = await _db.query(
      AppConstants.outboxTable,
      where: "status IN ('pending','failed')",
      orderBy: 'created_at ASC',
      limit: limit,
    );
    return rows.map(OutboxEntry.fromRow).toList();
  }

  Future<int> counts(String status) async {
    final r = await _db.rawQuery(
      'SELECT COUNT(*) c FROM ${AppConstants.outboxTable} WHERE status = ?',
      [status],
    );
    return Sqflite.firstIntValue(r) ?? 0;
  }

  Future<void> markSyncing(int id) => _setStatus(id, 'syncing');

  Future<void> markDone(int id) async {
    await _db.delete(AppConstants.outboxTable, where: 'id = ?', whereArgs: [id]);
  }

  Future<void> markFailed(int id, String error) async {
    await _db.rawUpdate(
      'UPDATE ${AppConstants.outboxTable} '
      'SET status = ?, attempts = attempts + 1, last_error = ? WHERE id = ?',
      ['failed', error, id],
    );
  }

  Future<void> _setStatus(int id, String status) => _db.update(
        AppConstants.outboxTable,
        {'status': status},
        where: 'id = ?',
        whereArgs: [id],
      );
}
