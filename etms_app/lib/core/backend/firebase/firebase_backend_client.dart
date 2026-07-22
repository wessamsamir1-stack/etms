import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:firebase_core/firebase_core.dart';

import '../../error/exceptions.dart';
import '../backend_client.dart';
import '../models/backend_models.dart';

/// Firebase implementation of [BackendClient] — proves the abstraction is real.
/// Bind by launching with `--dart-define=BACKEND=firebase` (requires the usual
/// google-services / GoogleService-Info files to run).
class FirebaseBackendClient implements BackendClient {
  fb.FirebaseAuth get _auth => fb.FirebaseAuth.instance;
  FirebaseFirestore get _db => FirebaseFirestore.instance;

  @override
  Future<void> initialize() async {
    await Firebase.initializeApp();
  }

  Future<BackendSession?> _map(fb.User? u) async {
    if (u == null) return null;
    final token = await u.getIdTokenResult();
    return BackendSession(
      userId: u.uid,
      accessToken: token.token ?? '',
      email: u.email,
      tenantId: token.claims?['tenant_id'] as String?,
    );
  }

  @override
  Future<BackendSession> signInWithPassword({
    required String email,
    required String password,
  }) async {
    try {
      final cred = await _auth.signInWithEmailAndPassword(
          email: email, password: password);
      final session = await _map(cred.user);
      if (session == null) throw const AuthException('No session returned');
      return session;
    } catch (e) {
      throw AuthException('Sign-in failed', cause: e);
    }
  }

  @override
  Future<BackendSession?> currentSession() => _map(_auth.currentUser);

  @override
  Stream<BackendSession?> authStateChanges() =>
      _auth.idTokenChanges().asyncMap(_map);

  @override
  Future<BackendSession?> refreshSession() async {
    await _auth.currentUser?.getIdToken(true);
    return _map(_auth.currentUser);
  }

  @override
  Future<void> signOut() => _auth.signOut();

  Query<Map<String, dynamic>> _applied(String resource, QuerySpec? q) {
    Query<Map<String, dynamic>> ref = _db.collection(resource);
    if (q != null) {
      q.equals.forEach((k, v) => ref = ref.where(k, isEqualTo: v));
      if (q.orderBy != null) {
        ref = ref.orderBy(q.orderBy!, descending: q.descending);
      }
      if (q.limit != null) ref = ref.limit(q.limit!);
    }
    return ref;
  }

  Map<String, dynamic> _withId(DocumentSnapshot<Map<String, dynamic>> d) =>
      {...?d.data(), 'id': d.id};

  @override
  Future<List<Map<String, dynamic>>> fetch(String resource,
      {QuerySpec? query}) async {
    final snap = await _applied(resource, query).get();
    return snap.docs.map((d) => {...d.data(), 'id': d.id}).toList();
  }

  @override
  Future<int> count(String resource, {QuerySpec? query}) async {
    final snap = await _applied(resource, query).count().get();
    return snap.count ?? 0;
  }

  @override
  Future<Map<String, dynamic>> insert(
      String resource, Map<String, dynamic> data) async {
    final ref = await _db.collection(resource).add(data);
    final doc = await ref.get();
    return _withId(doc);
  }

  @override
  Future<Map<String, dynamic>> update(
      String resource, String id, Map<String, dynamic> data) async {
    await _db.collection(resource).doc(id).update(data);
    final doc = await _db.collection(resource).doc(id).get();
    return _withId(doc);
  }

  @override
  Future<void> delete(String resource, String id) =>
      _db.collection(resource).doc(id).delete();

  @override
  Future<void> deleteWhere(String resource, Map<String, Object?> equals) async {
    assert(equals.isNotEmpty, 'deleteWhere requires a filter');
    final snap = await _applied(resource, QuerySpec(equals: equals)).get();
    final batch = _db.batch();
    for (final d in snap.docs) {
      batch.delete(d.reference);
    }
    await batch.commit();
  }

  @override
  Stream<List<Map<String, dynamic>>> watch(String resource, {QuerySpec? query}) {
    return _applied(resource, query).snapshots().map(
          (s) => s.docs.map((d) => {...d.data(), 'id': d.id}).toList(),
        );
  }
}
