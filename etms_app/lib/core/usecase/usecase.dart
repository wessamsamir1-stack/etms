import 'package:equatable/equatable.dart';
import 'package:fpdart/fpdart.dart';

import '../error/failures.dart';

/// Base contract for an application use-case (interactor).
///
/// [Type] is the success payload; [Params] is the input. Returns an
/// `Either<Failure, Type>` so error handling is explicit and testable.
abstract interface class UseCase<Type, Params> {
  Future<Either<Failure, Type>> call(Params params);
}

/// Streaming use-case for reactive/offline-first reads.
abstract interface class StreamUseCase<Type, Params> {
  Stream<Either<Failure, Type>> call(Params params);
}

/// Marker for use-cases that take no parameters.
class NoParams extends Equatable {
  const NoParams();
  @override
  List<Object?> get props => [];
}
