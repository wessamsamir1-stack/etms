import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

/// Opens and migrates the on-device SQLite database used for the offline cache
/// and the sync outbox. Kept dependency-light (raw SQL, no codegen) so the
/// skeleton compiles as-is; swap for Drift/Isar without touching call sites
/// that depend on the DAOs.
class LocalDatabase {
  LocalDatabase._(this.db);
  final Database db;

  static const _fileName = 'etms.db';
  static const _version = 1;

  /// `sqflite` and `path_provider` have no web implementation. On web the app
  /// runs without on-device persistence: the outbox and caches fall back to
  /// in-memory implementations (see `outboxDaoProvider`), so a page reload
  /// drops anything not yet synced. The admin dashboard is online-only anyway.
  static bool get isSupported => !kIsWeb;

  static Future<LocalDatabase> open() async {
    final dir = await getApplicationDocumentsDirectory();
    final database = await openDatabase(
      p.join(dir.path, _fileName),
      version: _version,
      onConfigure: (d) => d.execute('PRAGMA foreign_keys = ON'),
      onCreate: _onCreate,
      onUpgrade: _onUpgrade,
    );
    return LocalDatabase._(database);
  }

  static Future<void> _onCreate(Database db, int version) async {
    // Write-ahead outbox: every offline mutation is queued here first.
    await db.execute('''
      CREATE TABLE outbox (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        resource        TEXT    NOT NULL,
        operation       TEXT    NOT NULL,      -- insert | update | delete | custom
        entity_id       TEXT,
        endpoint        TEXT,                  -- optional REST path override
        payload         TEXT    NOT NULL,      -- JSON
        client_event_id TEXT    NOT NULL,      -- idempotency key (server-honored)
        status          TEXT    NOT NULL DEFAULT 'pending',
        attempts        INTEGER NOT NULL DEFAULT 0,
        last_error      TEXT,
        created_at      INTEGER NOT NULL
      )
    ''');
    await db.execute(
        'CREATE UNIQUE INDEX ux_outbox_client ON outbox(client_event_id)',);
    await db.execute('CREATE INDEX ix_outbox_status ON outbox(status)');

    // Generic read cache: one row per (resource, entity_id) holding JSON so the
    // UI renders from local state first (offline-first reads).
    await db.execute('''
      CREATE TABLE cache (
        resource   TEXT    NOT NULL,
        entity_id  TEXT    NOT NULL,
        data       TEXT    NOT NULL,           -- JSON
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (resource, entity_id)
      )
    ''');
    await db.execute('CREATE INDEX ix_cache_resource ON cache(resource)');
  }

  static Future<void> _onUpgrade(Database db, int from, int to) async {
    // Forward-only migrations go here as the schema evolves.
  }

  Future<void> close() => db.close();
}
