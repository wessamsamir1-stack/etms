import 'package:equatable/equatable.dart';
import 'package:fpdart/fpdart.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../entities/user.dart';
import '../repositories/auth_repository.dart';

class LoginParams extends Equatable {
  const LoginParams({required this.email, required this.password});
  final String email;
  final String password;

  @override
  List<Object?> get props => [email, password];
}

class Login implements UseCase<User, LoginParams> {
  const Login(this._repo);
  final AuthRepository _repo;

  @override
  Future<Either<Failure, User>> call(LoginParams params) {
    if (params.email.trim().isEmpty || params.password.isEmpty) {
      return Future.value(
          const Left(ValidationFailure('Email and password are required')));
    }
    return _repo.login(email: params.email.trim(), password: params.password);
  }
}
