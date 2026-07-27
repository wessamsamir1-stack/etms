import 'package:etms_app/features/commute/data/commute_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the manifest carries the seat accounting the driver screen shows', () {
    final m = TripManifest.fromJson({
      'data': {
        'passengers': [
          {'id': 'p1', 'employee_id': 'e1', 'full_name': 'Ali', 'status': 'boarded'},
        ],
        'stops': [],
        'counts': {'expected': 0, 'boarded': 1, 'remaining': 0, 'total': 1},
        'capacity': 30,
        'occupied': 30,
        'remaining_seats': 0,
        'waiting': 2,
      },
    });
    expect(m.capacity, 30);
    expect(m.occupied, 30);
    expect(m.remainingSeats, 0);
    expect(m.waiting, 2);
    expect(m.isFull, isTrue);
  });

  test('an uncapped trip is never reported as full', () {
    final m = TripManifest.fromJson({
      'data': {
        'passengers': [],
        'stops': [],
        'counts': {},
        'capacity': null,
        'occupied': 12,
        'remaining_seats': null,
        'waiting': 0,
      },
    });
    expect(m.capacity, isNull);
    expect(m.remainingSeats, isNull);
    expect(m.isFull, isFalse);
  });

  test('a manifest from an older backend still parses (no seat fields)', () {
    final m = TripManifest.fromJson({
      'data': {
        'passengers': [],
        'stops': [],
        'counts': {'total': 0},
      },
    });
    expect(m.capacity, isNull);
    expect(m.occupied, 0);
    expect(m.waiting, 0);
    expect(m.isFull, isFalse);
  });

  test('the waiting list keeps queue order and drops the resolved entries', () {
    final w = TripWaitlist.fromJson({
      'data': [
        {
          'id': 'w1',
          'employee_id': 'e9',
          'full_name': 'Sara',
          'position': 1,
          'status': 'waiting',
          'source': 'ride_request',
        },
        {
          'id': 'w2',
          'employee_id': 'e8',
          'full_name': 'Omar',
          'position': 2,
          'status': 'waiting',
          'source': 'manifest',
        },
        {
          'id': 'w0',
          'employee_id': 'e7',
          'full_name': 'Nour',
          'position': 3,
          'status': 'promoted',
          'promoted_at': '2026-07-22T06:10:00Z',
        },
      ],
      'seats': {'capacity': 30, 'occupied': 30, 'remaining': 0},
    });

    expect(w.entries.length, 3);
    expect(w.waiting.map((e) => e.fullName), ['Sara', 'Omar']);
    expect(w.waiting.first.position, 1);
    expect(w.waiting.first.source, 'ride_request');
    expect(w.remainingSeats, 0);

    final promoted = w.entries.last;
    expect(promoted.status, WaitlistStatus.promoted);
    expect(promoted.promotedAt, isNotNull);
  });

  test('an unknown waiting-list status does not blow up the parse', () {
    expect(waitlistStatusFrom('something-new'), WaitlistStatus.unknown);
    expect(waitlistStatusFrom(null), WaitlistStatus.unknown);
  });
}
