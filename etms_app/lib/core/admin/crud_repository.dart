import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:fpdart/fpdart.dart';

import '../di/providers.dart';
import '../error/exceptions.dart';
import '../error/failures.dart';
import '../network/api_client.dart';

/// Generic CRUD over the ETMS backend REST API (`/v1/<path>`). Powers the Admin
/// Portal's data grids and forms. Rows are `Map<String,dynamic>`; the UI
/// describes each resource with a `ResourceConfig` (whose `apiPath` is used here).
/// Tenant scoping is enforced server-side from the JWT — the client never sends it.
class CrudRepository {
  CrudRepository(this._api);
  final ApiClient _api;

  Future<Either<Failure, List<Map<String, dynamic>>>> list(String path) =>
      _guard(() async {
        final res = await _api.get<Map<String, dynamic>>('/$path');
        return (res['data'] as List? ?? const [])
            .cast<Map<String, dynamic>>();
      });

  Future<Either<Failure, Map<String, dynamic>>> create(
    String path,
    Map<String, dynamic> data,
  ) =>
      _guard(() async {
        final res = await _api.post<Map<String, dynamic>>('/$path', body: data);
        return (res['data'] ?? res) as Map<String, dynamic>;
      });

  Future<Either<Failure, Map<String, dynamic>>> update(
    String path,
    String id,
    Map<String, dynamic> data,
  ) =>
      _guard(() async {
        final res = await _api.patch<Map<String, dynamic>>('/$path/$id', body: data);
        return (res['data'] ?? res) as Map<String, dynamic>;
      });

  Future<Either<Failure, Unit>> remove(String path, String id) =>
      _guard(() async {
        await _api.delete<dynamic>('/$path/$id');
        return unit;
      });

  Future<Either<Failure, T>> _guard<T>(Future<T> Function() run) async {
    try {
      return Right(await run());
    } on NetworkException {
      return const Left(NetworkFailure());
    } on AuthException catch (e) {
      return Left(AuthFailure(e.message));
    } on ValidationException catch (e) {
      return Left(ValidationFailure(e.message, fieldErrors: e.fieldErrors));
    } on ServerException catch (e) {
      return Left(ServerFailure(e.message, statusCode: e.statusCode));
    } catch (e) {
      return Left(ServerFailure(e.toString()));
    }
  }
}

final crudRepositoryProvider =
    Provider<CrudRepository>((ref) => CrudRepository(ref.watch(apiClientProvider)));
