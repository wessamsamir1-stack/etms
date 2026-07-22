import 'package:equatable/equatable.dart';

enum TripStatus {
  scheduled,
  assigned,
  started,
  inProgress,
  completed,
  cancelled,
  exception;

  static TripStatus parse(String? raw) => switch (raw) {
        'assigned' => TripStatus.assigned,
        'started' => TripStatus.started,
        'in_progress' => TripStatus.inProgress,
        'completed' => TripStatus.completed,
        'cancelled' => TripStatus.cancelled,
        'exception' => TripStatus.exception,
        _ => TripStatus.scheduled,
      };

  String get wire => switch (this) {
        TripStatus.inProgress => 'in_progress',
        _ => name,
      };
}

/// Domain entity for a scheduled trip execution.
class Trip extends Equatable {
  const Trip({
    required this.id,
    required this.serviceDate,
    required this.direction,
    required this.status,
    required this.seatsTaken,
    this.capacity,
    this.routeName,
    this.plannedStart,
  });

  final String id;
  final DateTime serviceDate;
  final String direction; // inbound | outbound
  final TripStatus status;
  final int seatsTaken;
  final int? capacity;
  final String? routeName;
  final DateTime? plannedStart;

  bool get isFull => capacity != null && seatsTaken >= capacity!;

  @override
  List<Object?> get props => [id, status, seatsTaken, capacity];
}
