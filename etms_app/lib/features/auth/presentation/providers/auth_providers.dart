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
