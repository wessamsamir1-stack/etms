import 'flavor.dart';

/// Which backend-as-a-service implementation to bind at startup.
enum BackendProvider { supabase, firebase }

/// Immutable, environment-resolved application configuration.
///
/// Values come from `--dart-define`s (never hard-coded secrets). Each flavor
/// entrypoint builds one of these and passes it into [bootstrap].
class AppConfig {
  const AppConfig({
    required this.flavor,
    required this.apiBaseUrl,
    required this.backendProvider,
    required this.supabaseUrl,
    required this.supabaseAnonKey,
    this.tenantSlug = '',
    this.defaultLocale = 'ar',
    this.requestTimeout = const Duration(seconds: 20),
  });

  final Flavor flavor;
  final String apiBaseUrl;
  final BackendProvider backendProvider;
  final String supabaseUrl;
  final String supabaseAnonKey;
  /// The tenant this (white-label) build authenticates against (backend login).
  final String tenantSlug;
  final String defaultLocale;
  final Duration requestTimeout;

  /// Resolve config for [flavor] from compile-time defines.
  factory AppConfig.resolve(Flavor flavor) {
    const providerName =
        String.fromEnvironment('BACKEND', defaultValue: 'supabase');
    return AppConfig(
      flavor: flavor,
      apiBaseUrl: const String.fromEnvironment(
        'API_BASE_URL',
        defaultValue: 'https://api.dev.etms.app/v1',
      ),
      backendProvider: providerName == 'firebase'
          ? BackendProvider.firebase
          : BackendProvider.supabase,
      supabaseUrl: const String.fromEnvironment('SUPABASE_URL'),
      supabaseAnonKey: const String.fromEnvironment('SUPABASE_ANON_KEY'),
      tenantSlug: const String.fromEnvironment('TENANT_SLUG'),
    );
  }

  bool get isDebug => !flavor.isProduction;
}
