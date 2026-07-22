import '../../domain/entities/trip.dart';

class TripDto {
  const TripDto({
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
  final String serviceDate;
  final String direction;
  final String status;
  final int seatsTaken;
  final int? capacity;
  final String? routeName;
  final String? plannedStart;

  factory TripDto.fromJson(Map<String, dynamic> j) => TripDto(
        id: j['id'] as String,
        serviceDate: (j['service_date'] ?? j['serviceDate']) as String,
        direction: j['direction'] as String? ?? 'inbound',
        status: j['status'] as String? ?? 'scheduled',
        seatsTaken: (j['seats_taken'] as num?)?.toInt() ?? 0,
        capacity: (j['capacity'] as num?)?.toInt(),
        routeName: j['route_name'] as String?,
        plannedStart: j['planned_start'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'service_date': serviceDate,
        'direction': direction,
        'status': status,
        'seats_taken': seatsTaken,
        'capacity': capacity,
        'route_name': routeName,
        'planned_start': plannedStart,
      };

  Trip toEntity() => Trip(
        id: id,
        serviceDate: DateTime.tryParse(serviceDate) ?? DateTime.now(),
        direction: direction,
        status: TripStatus.parse(status),
        seatsTaken: seatsTaken,
        capacity: capacity,
        routeName: routeName,
        plannedStart:
            plannedStart != null ? DateTime.tryParse(plannedStart!) : null,
      );
}
