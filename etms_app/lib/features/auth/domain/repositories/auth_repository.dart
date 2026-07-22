import 'package:fpdart/fpdart.dart';

import '../../../../core/error/failures.dart';
import '../entities/user.dart';

/// Domain contract for authentication. The presentation layer depends on this
/// interface; the data layer provides the implementation.
abstract interface class AuthRepository {
  Future<Either<Failure, User>> login({
    required String email,
    required String password,
  });

  Future<Either<Failure, Unit>> logout();

  Future<Either<Failure, User?>> currentUser();

  /// Emits the current user on sign-in / sign-out / token refresh.
  Stream<User?> authStateChanges();
}
