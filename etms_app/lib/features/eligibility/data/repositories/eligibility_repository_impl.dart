import 'package:fpdart/fpdart.dart';

import '../../../../core/error/exceptions.dart';
import '../../../../core/error/failures.dart';
import '../../domain/entities/eligibility_decision.dart';
import '../../domain/repositories/eligibility_repository.dart';
import '../datasources/eligibility_remote_data_source.dart';

class EligibilityRepositoryImpl implements EligibilityRepository {
  EligibilityRepositoryImpl(this._remote);
  final EligibilityRemoteDataSource _remote;

  @override
  Future<Either<Failure, List<EligibilityDecision>>> reviewQueue({String? band}) =>
      _guard(() async {
        final dtos = await _remote.reviewQueue(band: band);
        return dtos.map((d) => d.toEntity()).toList();
      });

  @override
  Future<Either<Failure, EligibilityDecision>> decide(String employeeId) =>
      _guard(() async => (await _remote.decide(employeeId)).toEntity());

  @override
  Future<Either<Failure, Unit>> overrideDecision(String decisionId, String outcome) =>
      _guard(() async {
        await _remote.overrideDecision(decisionId, outcome);
        return unit;
      });

  Future<Either<Failure, T>> _guard<T>(Future<T> Function() run) async {
    try {
      return Right(await run());
    } on AuthException catch (e) {
      return Left(AuthFailure(e.message));
    } on NetworkException {
      return const Left(NetworkFailure());
    } on ServerException catch (e) {
      return Left(ServerFailure(e.message, statusCode: e.statusCode));
    } catch (_) {
      return const Left(UnexpectedFailure());
    }
  }
}
