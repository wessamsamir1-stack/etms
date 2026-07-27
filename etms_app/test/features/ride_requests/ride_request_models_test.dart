import 'package:etms_app/features/ride_requests/data/ride_request_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('a pickup inside the driver plan zones reads as on-route', () {
    final r = RideRequest.fromJson({
      'id': 'rr1',
      'employee_name': 'Sara',
      'direction': 'inbound',
      'status': 'open',
      'service_date': '2026-07-24',
      'requested_time': '06:30:00',
      'pickup_label': 'Salmiya',
      'pickup_lat': 29.33,
      'pickup_lng': 48.07,
      'matches_route': true,
    });
    expect(r.match, RouteMatch.onRoute);
    expect(r.hasPin, isTrue);
    expect(r.pickupLat, 29.33);
  });

  test('a pickup outside every zone reads as off-route', () {
    final r = RideRequest.fromJson({
      'id': 'rr2',
      'employee_name': 'Omar',
      'direction': 'inbound',
      'status': 'open',
      'matches_route': false,
    });
    expect(r.match, RouteMatch.offRoute);
    expect(r.hasPin, isFalse);
  });

  test('no approved plan is unknown, NOT off-route', () {
    final r = RideRequest.fromJson({
      'id': 'rr3',
      'employee_name': 'Nour',
      'direction': 'outbound',
      'status': 'open',
      'matches_route': null,
    });
    expect(r.match, RouteMatch.unknown);
    expect(r.match, isNot(RouteMatch.offRoute));
  });

  test('claiming a request seats the rider', () {
    final res = ClaimResult.fromJson({
      'data': {'id': 'rr1', 'status': 'assigned', 'tripId': 't1', 'onManifest': 12, 'capacity': 30},
      'waitlisted': false,
    });
    expect(res.tripId, 't1');
    expect(res.waitlisted, isFalse);
    expect(res.onManifest, 12);
    expect(res.position, isNull);
  });

  test('claiming onto a full bus queues the rider with a position', () {
    final res = ClaimResult.fromJson({
      'data': {'id': 'rr1', 'status': 'assigned', 'tripId': 't1', 'onManifest': 30, 'capacity': 30},
      'waitlisted': true,
      'position': 2,
    });
    expect(res.waitlisted, isTrue);
    expect(res.position, 2);
    expect(res.capacity, 30);
  });
}
