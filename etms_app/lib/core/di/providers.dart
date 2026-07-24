import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../features/auth/presentation/providers/auth_providers.dart';
import '../backend/backend_client.dart';
import '../config/app_config.dart';
import '../constants/app_constants.dart';
import '../network/api_client.dart';
import '../network/interceptors/auth_interceptor.dart';
import '../network/interceptors/logging_interceptor.dart';
import '../network/network_info.dart';
import '../offline/local_database.dart';
import '../offline/outbox_dao.dart';
import '../offline/sync_engine.dart';
import '../storage/key_value_store.dart';
import '../storage/secure_storage.dart';
import '../theme/tenant_theme.dart';

/// Root DI graph. Providers marked "override in bootstrap" are given concrete
/// instances via ProviderScope overrides after async initialization, so the
/// rest of the graph can depend on them synchronously.

// ---- Overridden in bootstrap ----------------------------------------------
final appConfigProvider = Provider<AppConfig>(
  (_) => throw UnimplementedError('appConfigProvider must be overridden'),
);
final sharedPreferencesProvider = Provider<SharedPreferences>(
  (_) => throw UnimplementedError('sharedPreferencesProvider must be overridden'),
);
final backendClientProvider = Provider<BackendClient>(
  (_) => throw UnimplementedError('backendClientProvider must be overridden'),
);
/// Null where on-device SQLite is unavailable (web) — see
/// [LocalDatabase.isSupported]. Consumers must fall back to an in-memory
/// implementation rather than assume persistence.
final localDatabaseProvider = Provider<LocalDatabase?>((_) => null);

// ---- Derived singletons ----------------------------------------------------
final secureStorageProvider =
    Provider<SecureStorage>((_) => SecureStorageImpl());

final keyValueStoreProvider = Provider<KeyValueStore>(
  (ref) => KeyValueStoreImpl(ref.watch(sharedPreferencesProvider)),
);

final networkInfoProvider =
    Provider<NetworkInfo>((_) => NetworkInfoImpl(Connectivity()));

final outboxDaoProvider = Provider<OutboxDao>((ref) {
  final db = ref.watch(localDatabaseProvider);
  return db == null ? MemoryOutboxDao() : SqliteOutboxDao(db.db);
});

final apiClientProvider = Provider<ApiClient>((ref) {
  final config = ref.watch(appConfigProvider);
  final storage = ref.watch(secureStorageProvider);
  // Rebind the client to the signed-in identity. Everything that reads the API
  // goes through here, so a login/logout invalidates the whole downstream graph
  // and screens refetch instead of showing the previous session's data.
  ref.watch(sessionScopeProvider);

  // On 401, rotate the backend refresh token via /v1/auth/refresh (a bare Dio,
  // no interceptor, to avoid a refresh loop).
  Future<String?> refresh() async {
    final rt = await storage.read(AppConstants.kRefreshToken);
    if (rt == null) return null;
    try {
      final dio = Dio(BaseOptions(baseUrl: config.apiBaseUrl));
      final res = await dio.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': rt},
      );
      final data = res.data!;
      final access = data['access_token'] as String;
      await storage.write(AppConstants.kAccessToken, access);
      final nrt = data['refresh_token'];
      if (nrt is String) await storage.write(AppConstants.kRefreshToken, nrt);
      return access;
    } catch (_) {
      return null;
    }
  }

  return ApiClient.create(config, [
    AuthInterceptor(storage, refresh),
    if (config.isDebug) LoggingInterceptor(),
  ]);
});

final syncEngineProvider = Provider<SyncEngine>((ref) {
  final engine = SyncEngine(
    outbox: ref.watch(outboxDaoProvider),
    network: ref.watch(networkInfoProvider),
  );
  ref.onDispose(engine.dispose);
  return engine;
});

/// Reactive view of the offline sync state for the UI.
final syncStateProvider = StreamProvider((ref) {
  final engine = ref.watch(syncEngineProvider);
  return engine.state;
});

/// Active tenant white-label theme. Defaults to the neutral brand; the tenant
/// context feature overrides this once branding (tenant_branding.theme_json)
/// is loaded after sign-in.
final tenantThemeProvider =
    StateProvider<TenantTheme>((_) => TenantTheme.fallback);
