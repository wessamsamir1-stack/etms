import 'models/backend_models.dart';

/// The single seam that decouples the app from any specific backend-as-a-service.
///
/// Two adapters implement it — [SupabaseBackendClient] and
/// [FirebaseBackendClient] — and exactly one is bound at startup based on
/// [AppConfig.backendProvider]. Feature data sources depend on this interface,
/// never on Supabase/Firebase SDK types, so swapping providers is a one-line
/// change in dependency injection.
abstract interface class BackendClient {
  Future<void> initialize();

  // ---- Authentication ------------------------------------------------------
  Future<BackendSession> signInWithPassword({
    required String email,
    required String password,
  });

  Future<BackendSession?> currentSession();

  /// Emits on sign-in / sign-out / token refresh.
  Stream<BackendSession?> authStateChanges();

  Future<BackendSession?> refreshSession();

  Future<void> signOut();

  // ---- Data (generic CRUD + realtime) --------------------------------------
  Future<List<Map<String, dynamic>>> fetch(String resource, {QuerySpec? query});

  /// Row count for a resource matching [query] (used by dashboard KPI tiles).
  Future<int> count(String resource, {QuerySpec? query});

  Future<Map<String, dynamic>> insert(
      String resource, Map<String, dynamic> data);

  Future<Map<String, dynamic>> update(
      String resource, String id, Map<String, dynamic> data);

  Future<void> delete(String resource, String id);

  /// Delete all rows matching an equality filter (for join tables without a
  /// single `id`, e.g. role_permission). Requires a non-empty filter.
  Future<void> deleteWhere(String resource, Map<String, Object?> equals);

  /// Realtime stream of a resource matching [query] (used for live tracking,
  /// trip status, control-tower feeds).
  Stream<List<Map<String, dynamic>>> watch(String resource, {QuerySpec? query});
}
