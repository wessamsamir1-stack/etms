/// Models for the daily-commute manifest (docs/etms/17). No seat reservation:
/// each trip has a passenger manifest with attendance statuses.
enum PassengerStatus { expected, onTheWay, boarded, noShow, excused, onLeave, removed, unknown }

PassengerStatus passengerStatusFrom(String? s) {
  switch (s) {
    case 'expected':
      return PassengerStatus.expected;
    case 'on_the_way':
      return PassengerStatus.onTheWay;
    case 'boarded':
      return PassengerStatus.boarded;
    case 'no_show':
      return PassengerStatus.noShow;
    case 'excused':
      return PassengerStatus.excused;
    case 'on_leave':
      return PassengerStatus.onLeave;
    case 'removed':
      return PassengerStatus.removed;
    default:
      return PassengerStatus.unknown;
  }
}

class Passenger {
  const Passenger({
    required this.id,
    required this.employeeId,
    required this.fullName,
    required this.status,
    this.tripStopId,
    this.boardedAt,
    this.onTheWayAt,
  });

  final String id;
  final String employeeId;
  final String fullName;
  final PassengerStatus status;
  final String? tripStopId;
  final DateTime? boardedAt;
  final DateTime? onTheWayAt;

  factory Passenger.fromJson(Map<String, dynamic> j) => Passenger(
        id: '${j['id']}',
        employeeId: '${j['employee_id']}',
        fullName: '${j['full_name'] ?? ''}',
        status: passengerStatusFrom(j['status'] as String?),
        tripStopId: j['trip_stop_id'] as String?,
        boardedAt: _dt(j['boarded_at']),
        onTheWayAt: _dt(j['on_the_way_at']),
      );
}

class TripStop {
  const TripStop({
    required this.id,
    required this.name,
    required this.status,
    this.seq = 0,
    this.departsAt,
  });

  final String id;
  final String name;
  final String status; // pending | arrived | departed | skipped
  final int seq;
  final DateTime? departsAt;

  factory TripStop.fromJson(Map<String, dynamic> j) => TripStop(
        id: '${j['id']}',
        name: '${j['name'] ?? ''}',
        status: '${j['status'] ?? 'pending'}',
        seq: (j['seq'] as num?)?.toInt() ?? 0,
        departsAt: _dt(j['departs_at']),
      );
}

class ManifestCounts {
  const ManifestCounts({
    this.expected = 0,
    this.onTheWay = 0,
    this.boarded = 0,
    this.noShow = 0,
    this.excused = 0,
    this.remaining = 0,
    this.total = 0,
  });

  final int expected, onTheWay, boarded, noShow, excused, remaining, total;

  factory ManifestCounts.fromJson(Map<String, dynamic>? j) {
    j ??= const {};
    int n(String k) => (j![k] as num?)?.toInt() ?? 0;
    return ManifestCounts(
      expected: n('expected'),
      onTheWay: n('onTheWay'),
      boarded: n('boarded'),
      noShow: n('noShow'),
      excused: n('excused'),
      remaining: n('remaining'),
      total: n('total'),
    );
  }
}

class TripManifest {
  const TripManifest({
    required this.passengers,
    required this.stops,
    required this.counts,
    this.currentStop,
    this.countdownSeconds,
  });

  final List<Passenger> passengers;
  final List<TripStop> stops;
  final ManifestCounts counts;
  final TripStop? currentStop;
  final int? countdownSeconds;

  factory TripManifest.fromJson(Map<String, dynamic> j) {
    final data = (j['data'] as Map<String, dynamic>?) ?? j;
    final cur = data['currentStop'] as Map<String, dynamic>?;
    return TripManifest(
      passengers: [
        for (final p in (data['passengers'] as List? ?? const []))
          Passenger.fromJson(p as Map<String, dynamic>),
      ],
      stops: [
        for (final s in (data['stops'] as List? ?? const []))
          TripStop.fromJson(s as Map<String, dynamic>),
      ],
      counts: ManifestCounts.fromJson(data['counts'] as Map<String, dynamic>?),
      currentStop: cur == null ? null : TripStop.fromJson(cur),
      countdownSeconds: (data['countdownSeconds'] as num?)?.toInt(),
    );
  }
}

/// One row of the employee's own ride history (GET /v1/my/rides).
class MyRide {
  const MyRide({
    required this.tripId,
    required this.serviceDate,
    required this.direction,
    required this.status,
    this.boardedAt,
  });

  final String tripId;
  final DateTime? serviceDate;
  final String direction; // inbound | outbound
  final PassengerStatus status;
  final DateTime? boardedAt;

  factory MyRide.fromJson(Map<String, dynamic> j) => MyRide(
        tripId: '${j['trip_id']}',
        serviceDate: _dt(j['service_date']),
        direction: '${j['direction'] ?? ''}',
        status: passengerStatusFrom(j['status'] as String?),
        boardedAt: _dt(j['boarded_at']),
      );
}

DateTime? _dt(Object? v) => v is String ? DateTime.tryParse(v) : null;
