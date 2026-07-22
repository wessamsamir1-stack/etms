import 'package:equatable/equatable.dart';
import 'package:fpdart/fpdart.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../repositories/trip_repository.dart';

class MarkTripEventParams extends Equatable {
  const MarkTripEventParams({
    required this.tripId,
    required this.eventType,
    this.routeStopId,
    this.employeeId,
    this.lat,
    this.lng,
  });

  final String tripId;
  final String eventType; // started | arrived_stop | pickup | dropoff | completed
  final String? routeStopId;
  final String? employeeId;
  final double? lat;
  final double? lng;

  @override
  List<Object?> get props => [tripId, eventType, routeStopId, employeeId];
}

class MarkTripEvent implements UseCase<Unit, MarkTripEventParams> {
  const MarkTripEvent(this._repo);
  final TripRepository _repo;

  @override
  Future<Either<Failure, Unit>> call(MarkTripEventParams p) => _repo.markTripEvent(
        tripId: p.tripId,
        eventType: p.eventType,
        routeStopId: p.routeStopId,
        employeeId: p.employeeId,
        lat: p.lat,
        lng: p.lng,
      );
}
