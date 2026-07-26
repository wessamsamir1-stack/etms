import 'package:etms_app/features/fleet_ops/data/fleet_ops_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('FuelLog parses the API row shape', () {
    final log = FuelLog.fromJson({
      'id': 'f1',
      'vehicle_id': 'v1',
      'plate_no': '12345',
      'driver': 'Ahmad',
      'filled_at': '2026-07-20T08:30:00Z',
      'fuel_type': 'petrol_95',
      'liters': '35.500',
      'cost_amount': '3.750',
      'currency_code': 'KWD',
      'odometer_km': 120500,
      'station': 'KNPC',
    });
    expect(log.plateNo, '12345');
    expect(log.liters, 35.5);
    expect(log.costAmount, 3.75);
    expect(log.fuelType, 'petrol_95');
    expect(log.odometerKm, 120500);
    expect(log.filledAt, isNotNull);
  });

  test('Violation parses status and amount', () {
    final v = Violation.fromJson({
      'id': 'x1',
      'vehicle_id': 'v1',
      'plate_no': '777',
      'violation_type': 'speeding',
      'violation_no': 'MOI-99',
      'amount': '30.000',
      'status': 'disputed',
      'deduct_from_driver': true,
      'occurred_at': '2026-07-01T10:00:00Z',
    });
    expect(v.status, ViolationStatus.disputed);
    expect(v.amount, 30.0);
    expect(v.deductFromDriver, isTrue);
    expect(violationStatusWire(v.status), 'disputed');
  });

  test('FuelReport tolerates an empty payload', () {
    final r = FuelReport.fromJson(const {'data': {}});
    expect(r.fills, 0);
    expect(r.perVehicle, isEmpty);
  });

  test('ViolationsReport parses totals, byType and perDriver', () {
    final r = ViolationsReport.fromJson({
      'data': {
        'totals': {'violations': 4, 'pending': 2, 'total_amount': '95.0', 'unpaid_amount': '55.0'},
        'byType': [
          {'violation_type': 'speeding', 'violations': 3, 'amount': '75.0'},
        ],
        'perDriver': [
          {'full_name': 'Ahmad', 'violations': 2, 'amount': '50.0'},
        ],
      },
    });
    expect(r.violations, 4);
    expect(r.pending, 2);
    expect(r.unpaidAmount, 55.0);
    expect(r.byType.single.type, 'speeding');
    expect(r.perDriver.single.driver, 'Ahmad');
  });
}
