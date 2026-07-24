import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/providers.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../data/datasources/backend_auth_data_source.dart';
import '../../data/repositories/auth_repository_impl.dart';
import '../../domain/entities/user.dart';
import '../../domain/repositories/auth_repository.dart';
import '../../domain/usecases/login.dart';
import '../../domain/usecases/logout.dart';

final _backendAuthProvider = Provider<BackendAuthDataSource>(
  (ref) => BackendAuthDataSourceImpl(ref.watch(appConfigProvider)),
);

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final SecureStorage storage = ref.watch(secureStorageProvider);
  final slug = ref.watch(appConfigProvider).tenantSlug;
  return AuthRepositoryImpl(ref.watch(_backendAuthProvider), storage, slug);
});

final loginUseCaseProvider =
    Provider<Login>((ref) => Login(ref.watch(authRepositoryProvider)));

final logoutUseCaseProvider =
    Provider<Logout>((ref) => Logout(ref.watch(authRepositoryProvider)));

/// Reactive auth state used by GoRouter's redirect and the shell UI.
final authStateChangesProvider = StreamProvider<User?>(
  (ref) => ref.watch(authRepositoryProvider).authStateChanges(),
);

/// Best-effort snapshot of the current user (null when signed out).
final currentUserProvider = Provider<User?>(
  (ref) => ref.watch(authStateChangesProvider).valueOrNull,
);

/// Identity of the signed-in session — `''` when signed out.
///
/// [apiClientProvider] watches this, so signing in or out rebuilds the API
/// client and, transitively, every provider that reads through it. Without that
/// the one-shot fetches (trips, dashboard KPIs, my rides, …) would keep serving
/// the previous session's result until a full app restart.
final sessionScopeProvider = Provider<String>((ref) {
  final user = ref.watch(currentUserProvider);
  return user == null ? '' : '${user.tenantId}:${user.id}';
});
