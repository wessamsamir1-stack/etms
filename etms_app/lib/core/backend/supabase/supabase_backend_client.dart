import 'package:supabase_flutter/supabase_flutter.dart' hide AuthException;

import '../../config/app_config.dart';
import '../../error/exceptions.dart';
import '../backend_client.dart';
import '../models/backend_models.dart';

/// Supabase implementation of [BackendClient] (default provider).
class SupabaseBackendClient implements BackendClient {
  SupabaseBackendClient(this._config);
  final AppConfig _config;

  SupabaseClient get _c => Supabase.instance.client;

  @override
  Future<void> initialize() async {
    await Supabase.initialize(
      url: _config.supabaseUrl,
      anonKey: _config.supabaseAnonKey,
    );
  }

  BackendSession? _map(Session? s) {
    if (s == null) return null;
    return BackendSession(
      userId: s.user.id,
      accessToken: s.accessToken,
      refreshToken: s.refreshToken,
      email: s.user.email,
      tenantId: s.user.appMetadata['tenant_id'] as String?,
    );
  }

  @override
  Future<BackendSession> signInWithPassword({
    required String email,
    required String password,
  }) async {
    try {
      final res = await _c.auth
          .signInWithPassword(email: email, password: password);
      final session = _map(res.session);
      if (session == null) throw const AuthException('No session returned');
      return session;
    } on AuthException {
      rethrow;
    } catch (e) {
      throw AuthException('Sign-in failed', cause: e);
    }
  }

  @override
  Future<BackendSession?> currentSession() async =>
      _map(_c.auth.currentSession);

  @override
  Stream<BackendSession?> authStateChanges() =>
      _c.auth.onAuthStateChange.map((e) => _map(e.session));

  @override
  Future<BackendSession?> refreshSession() async {
    final res = await _c.auth.refreshSession();
    return _map(res.session);
  }

  @override
  Future<void> signOut() => _c.auth.signOut();

  PostgrestFilterBuilder<dynamic> _applied(String resource, QuerySpec? q) {
    var builder = _c.from(resource).select();
    if (q != null) {
      q.equals.forEach((k, v) => builder = builder.eq(k, v as Object));
    }
    return builder;
  }

  @override
  Future<List<Map<String, dynamic>>> fetch(String resource,
      {QuerySpec? query}) async {
    var q = _applied(resource, query);
    final rows = await q;
    return (rows as List).cast<Map<String, dynamic>>();
  }

  @override
  Future<int> count(String resource, {QuerySpec? query}) async {
    final res = await _applied(resource, query).count(CountOption.exact);
    return res.count;
  }

  @override
  Future<Map<String, dynamic>> insert(
      String resource, Map<String, dynamic> data) async {
    final row = await _c.from(resource).insert(data).select().single();
    return row;
  }

  @override
  Future<Map<String, dynamic>> update(
      String resource, String id, Map<String, dynamic> data) async {
    final row =
        await _c.from(resource).update(data).eq('id', id).select().single();
    return row;
  }

  @override
  Future<void> delete(String resource, String id) async {
    await _c.from(resource).delete().eq('id', id);
  }

  @override
  Future<void> deleteWhere(String resource, Map<String, Object?> equals) async {
    assert(equals.isNotEmpty, 'deleteWhere requires a filter');
    var b = _c.from(resource).delete();
    equals.forEach((k, v) => b = b.eq(k, v as Object));
    await b;
  }

  @override
  Stream<List<Map<String, dynamic>>> watch(String resource, {QuerySpec? query}) {
    final base = _c.from(resource).stream(primaryKey: ['id']);
    SupabaseStreamBuilder stream = base;
    final entries = query?.equals.entries.toList() ?? const [];
    if (entries.isNotEmpty) {
      stream = base.eq(entries.first.key, entries.first.value as Object);
    }
    if (query?.orderBy != null) {
      stream = stream.order(query!.orderBy!, ascending: !query.descending);
    }
    return stream;
  }
}
