import 'package:equatable/equatable.dart';
import 'package:fpdart/fpdart.dart';

import '../error/failures.dart';

/// Base contract for an application use-case (interactor).
///
/// [T] is the success payload; [Params] is the input. Returns an
/// `Either<Failure, T>` so error handling is explicit and testable.
abstract interface class UseCase<T, Params> {
  Future<Either<Failure, T>> call(Params params);
}

/// Streaming use-case for reactive/offline-first reads.
abstract interface class StreamUseCase<T, Params> {
  Stream<Either<Failure, T>> call(Params params);
}

/// Marker for use-cases that take no parameters.
class NoParams extends Equatable {
  const NoParams();
  @override
  List<Object?> get props => [];
}
