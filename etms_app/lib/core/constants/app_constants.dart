/// App-wide constant values (no secrets — those come from AppConfig).
abstract final class AppConstants {
  static const supportedLocales = ['ar', 'en'];

  // Local storage keys
  static const kAccessToken = 'access_token';
  static const kRefreshToken = 'refresh_token';
  static const kTenantId = 'tenant_id';
  static const kUserId = 'user_id';
  static const kLocale = 'app_locale';
  static const kThemeMode = 'theme_mode';

  // Session context headers (mirror the DB RLS context in db/README.md)
  static const hTenant = 'X-Tenant-Id';
  static const hRequestId = 'X-Request-Id';

  // Offline sync
  static const outboxTable = 'outbox';
  static const maxSyncRetries = 8;
  static const syncBatchSize = 50;
}

/// Backend resource names (tables/collections) — shared by data sources so the
/// Supabase and Firebase adapters address the same logical entities.
abstract final class Resources {
  static const users = 'app_user';
  static const trips = 'trip';
  static const bookings = 'booking';
  static const tripEvents = 'trip_event';
  static const incidents = 'incident';
}
