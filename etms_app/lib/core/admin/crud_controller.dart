import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:fpdart/fpdart.dart';

import '../error/failures.dart';
import 'crud_repository.dart';

typedef Json = Map<String, dynamic>;

/// List + mutation state for one resource, keyed by its backend REST path
/// (family). Tenant scoping is server-side (JWT), so no tenant is injected here.
class CrudListController extends FamilyAsyncNotifier<List<Json>, String> {
  String get _path => arg;
  CrudRepository get _repo => ref.read(crudRepositoryProvider);

  @override
  Future<List<Json>> build(String path) => _fetch();

  Future<List<Json>> _fetch() async {
    final res = await _repo.list(_path);
    return res.fold((f) => throw f, (rows) => rows);
  }

  Future<void> reload() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_fetch);
  }

  Future<Either<Failure, Unit>> create(Json data) async {
    final res = await _repo.create(_path, data);
    return res.match((f) => Left(f), (_) async {
      await reload();
      return const Right(unit);
    });
  }

  Future<Either<Failure, Unit>> edit(String id, Json data) async {
    final res = await _repo.update(_path, id, data);
    return res.match((f) => Left(f), (_) async {
      await reload();
      return const Right(unit);
    });
  }

  Future<Either<Failure, Unit>> remove(String id) async {
    final res = await _repo.remove(_path, id);
    return res.match((f) => Left(f), (_) async {
      await reload();
      return const Right(unit);
    });
  }
}

final crudListProvider =
    AsyncNotifierProvider.family<CrudListController, List<Json>, String>(
  CrudListController.new,
);

/// Loads id/label pairs for a reference (foreign-key) picker from a REST path.
final referenceOptionsProvider =
    FutureProvider.family<List<(String, String)>, ({String path, String label})>(
        (ref, arg) async {
  final res = await ref.watch(crudRepositoryProvider).list(arg.path);
  return res.fold(
    (_) => <(String, String)>[],
    (rows) => rows
        .map((r) => (r['id'] as String, (r[arg.label] ?? r['id']).toString()))
        .toList(),
  );
});
