// Models for ride requests (docs/etms/16 + the zone matching in db V0032).
// A staff member leaves a pickup request; drivers see the ones offered to them
// and claim the ones that are actually on their route.

/// Where a request sits relative to the driver's approved plan for that day.
enum RouteMatch {
  /// The pickup falls inside one of the plan's zones (ST_Covers).
  onRoute,

  /// The pickup is outside every zone on the plan.
  offRoute,

  /// No approved plan for that date — there is no route to compare against,
  /// which is NOT the same as "does not match".
  unknown,
}

RouteMatch routeMatchFrom(Object? v) {
  if (v is bool) return v ? RouteMatch.onRoute : RouteMatch.offRoute;
  return RouteMatch.unknown;
}

class RideRequest {
  const RideRequest({
    required this.id,
    required this.employeeName,
    required this.direction,
    required this.status,
    required this.match,
    this.serviceDate,
    this.requestedTime,
    this.pickupLabel,
    this.pickupAddress,
    this.pickupLat,
    this.pickupLng,
    this.tripId,
  });

  final String id;
  final String employeeName;
  final String direction; // inbound | outbound
  final String status; // open | assigned | cancelled | expired
  final RouteMatch match;
  final DateTime? serviceDate;
  final String? requestedTime; // HH:MM[:SS]
  final String? pickupLabel;
  final String? pickupAddress;
  final double? pickupLat;
  final double? pickupLng;
  final String? tripId;

  bool get hasPin => pickupLat != null && pickupLng != null;

  factory RideRequest.fromJson(Map<String, dynamic> j) => RideRequest(
        id: '${j['id']}',
        employeeName: '${j['employee_name'] ?? ''}',
        direction: '${j['direction'] ?? ''}',
        status: '${j['status'] ?? ''}',
        match: routeMatchFrom(j['matches_route']),
        serviceDate: _dt(j['service_date']),
        requestedTime: j['requested_time'] as String?,
        pickupLabel: j['pickup_label'] as String?,
        pickupAddress: j['pickup_address'] as String?,
        pickupLat: (j['pickup_lat'] as num?)?.toDouble(),
        pickupLng: (j['pickup_lng'] as num?)?.toDouble(),
        tripId: j['trip_id'] as String?,
      );
}

/// What happened when a driver claimed a request: the rider is either seated on
/// the manifest, or — when the bus is already full — queued on the trip's
/// waiting list and promoted automatically once a seat frees (db V0031).
class ClaimResult {
  const ClaimResult({
    required this.tripId,
    required this.waitlisted,
    this.position,
    this.onManifest,
    this.capacity,
  });

  final String tripId;
  final bool waitlisted;
  final int? position;
  final int? onManifest;
  final int? capacity;

  factory ClaimResult.fromJson(Map<String, dynamic> j) {
    final data = (j['data'] as Map<String, dynamic>?) ?? const {};
    return ClaimResult(
      tripId: '${data['tripId'] ?? ''}',
      waitlisted: j['waitlisted'] == true,
      position: (j['position'] as num?)?.toInt(),
      onManifest: (data['onManifest'] as num?)?.toInt(),
      capacity: (data['capacity'] as num?)?.toInt(),
    );
  }
}

DateTime? _dt(Object? v) => v is String ? DateTime.tryParse(v) : null;
