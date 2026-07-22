import 'package:fpdart/fpdart.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../repositories/auth_repository.dart';

class Logout implements UseCase<Unit, NoParams> {
  const Logout(this._repo);
  final AuthRepository _repo;

  @override
  Future<Either<Failure, Unit>> call(NoParams params) => _repo.logout();
}
