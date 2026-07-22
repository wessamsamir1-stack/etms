import 'dart:async';

import 'package:fpdart/fpdart.dart';

import '../../../../core/constants/app_constants.dart';
import '../../../../core/error/exceptions.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../../../core/utils/jwt.dart';
import '../../domain/entities/user.dart';
import '../../domain/repositories/auth_repository.dart';
import '../datasources/backend_auth_data_source.dart';

/// Auth against the ETMS backend (single source of truth). Tokens live in secure
/// storage; the current user is hydrated from the JWT claims so a restart needs
/// no network call. Emits on login/logout via a broadcast stream.
class AuthRepositoryImpl implements AuthRepository {
  AuthRepositoryImpl(this._backend, this._storage, this._tenantSlug);

  final BackendAuthDataSource _backend;
  final SecureStorage _storage;
  final String _tenantSlug;
  final _controller = StreamController<User?>.broadcast();

  @override
  Future<Either<Failure, User>> login({
    required String email,
    required String password,
  }) async {
    try {
      final r = await _backend.login(_tenantSlug, email.trim(), password);
      await _storage.write(AppConstants.kAccessToken, r.accessToken);
      await _storage.write(AppConstants.kUserId, r.userId);
      await _storage.write(AppConstants.kTenantId, r.tenantId);
      if (r.refreshToken != null) {
        await _storage.write(AppConstants.kRefreshToken, r.refreshToken!);
      }
      final user = User(
        id: r.userId,
        tenantId: r.tenantId,
        fullName: r.fullName,
        email: email.trim(),
        permissions: r.permissions,
      );
      _controller.add(user);
      return Right(user);
    } on AuthException catch (e) {
      return Left(AuthFailure(e.message));
    } on NetworkException {
      return const Left(NetworkFailure());
    } catch (_) {
      return const Left(UnexpectedFailure());
    }
  }

  @override
  Future<Either<Failure, Unit>> logout() async {
    final rt = await _storage.read(AppConstants.kRefreshToken);
    if (rt != null) await _backend.logout(rt);
    await _storage.delete(AppConstants.kAccessToken);
    await _storage.delete(AppConstants.kRefreshToken);
    await _storage.delete(AppConstants.kUserId);
    await _storage.delete(AppConstants.kTenantId);
    _controller.add(null);
    return const Right(unit);
  }

  @override
  Future<Either<Failure, User?>> currentUser() async {
    return Right(await _userFromStoredToken());
  }

  @override
  Stream<User?> authStateChanges() async* {
    yield await _userFromStoredToken();
    yield* _controller.stream;
  }

  Future<User?> _userFromStoredToken() async {
    final token = await _storage.read(AppConstants.kAccessToken);
    if (token == null) return null;
    final claims = decodeJwtPayload(token);
    if (claims.isEmpty || isJwtExpired(claims)) return null;
    return User(
      id: claims['sub'] as String? ?? '',
      tenantId: claims['tenant_id'] as String? ?? '',
      fullName: '',
      permissions: (claims['permissions'] as List?)?.map((e) => '$e').toList() ?? const [],
    );
  }
}
