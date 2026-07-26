import 'dart:convert';

import 'package:sqflite/sqflite.dart';

import '../../../../core/constants/app_constants.dart';
import '../dtos/trip_dto.dart';

/// Local cache for trips backed by the `cache` table (offline-first reads).
abstract interface class TripLocalDataSource {
  Future<List<TripDto>> readCached();
  Future<void> cache(List<TripDto> trips);
}

class TripLocalDataSourceImpl implements TripLocalDataSource {
  TripLocalDataSourceImpl(this._db);
  final Database _db;

  @override
  Future<List<TripDto>> readCached() async {
    final rows = await _db.query(
      'cache',
      where: 'resource = ?',
      whereArgs: [Resources.trips],
    );
    return rows
        .map((r) =>
            TripDto.fromJson(jsonDecode(r['data'] as String) as Map<String, dynamic>),)
        .toList();
  }

  @override
  Future<void> cache(List<TripDto> trips) async {
    final batch = _db.batch();
    for (final t in trips) {
      batch.insert(
        'cache',
        {
          'resource': Resources.trips,
          'entity_id': t.id,
          'data': jsonEncode(t.toJson()),
          'updated_at': DateTime.now().millisecondsSinceEpoch,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }
    await batch.commit(noResult: true);
  }
}

/// Used where SQLite is unavailable (web): reads always miss, writes are
/// dropped, so the repository falls straight through to the remote source.
class NoopTripLocalDataSource implements TripLocalDataSource {
  @override
  Future<List<TripDto>> readCached() async => const [];

  @override
  Future<void> cache(List<TripDto> trips) async {}
}
