import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app/app.dart';
import 'core/backend/backend_client.dart';
import 'core/backend/firebase/firebase_backend_client.dart';
import 'core/backend/supabase/supabase_backend_client.dart';
import 'core/config/app_config.dart';
import 'core/di/providers.dart';
import 'core/offline/local_database.dart';
import 'core/offline/sync_engine.dart';
import 'core/utils/logger.dart';

/// Single async composition root shared by every flavor entrypoint.
///
/// Performs the I/O that must complete before the first frame (backend init,
/// DB open, prefs), then injects the concrete instances into the Riverpod graph
/// via ProviderScope overrides and starts the offline sync engine.
Future<void> bootstrap(AppConfig config) async {
  WidgetsFlutterBinding.ensureInitialized();

  // Auth + data now go through the ETMS backend REST API. The Supabase/Firebase
  // BackendClient is only initialized when configured (e.g. for realtime); it is
  // no longer required for auth or CRUD.
  BackendClient? backend;
  if (config.supabaseUrl.isNotEmpty || config.backendProvider == BackendProvider.firebase) {
    backend = switch (config.backendProvider) {
      BackendProvider.supabase => SupabaseBackendClient(config),
      BackendProvider.firebase => FirebaseBackendClient(),
    };
    await backend.initialize();
  }

  final prefs = await SharedPreferences.getInstance();
  final localDb = await LocalDatabase.open();

  FlutterError.onError = (details) =>
      appLogger.e('FlutterError', error: details.exception, stackTrace: details.stack);

  final container = ProviderContainer(
    overrides: [
      appConfigProvider.overrideWithValue(config),
      sharedPreferencesProvider.overrideWithValue(prefs),
      localDatabaseProvider.overrideWithValue(localDb),
      if (backend != null) backendClientProvider.overrideWithValue(backend),
    ],
  );

  // Kick off the offline outbox drainer.
  await container.read(syncEngineProvider).start();

  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const EtmsApp(),
    ),
  );
}
