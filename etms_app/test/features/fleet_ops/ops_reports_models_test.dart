import 'package:etms_app/features/fleet_ops/data/ops_reports_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('DriverOpsRow reads counts and the derived on-time share', () {
    final r = DriverOpsRow.fromJson({
      'driver_id': 'd1',
      'full_name': 'Khaled',
      'trips': 12,
      'completed': 11,
      'passengers': 180,
      'no_shows': 6,
      'violations': 1,
      'incidents': 0,
      'on_time_pct': 83,
      // Postgres numeric arrives as a string.
      'avg_delay_min': '4.5',
      'avg_rating': '4.60',
    });
    expect(r.fullName, 'Khaled');
    expect(r.trips, 12);
    expect(r.onTimePct, 83);
    expect(r.avgDelayMin, 4.5);
    expect(r.avgRating, 4.6);
  });

  test('VehicleOpsRow parses string numerics for fuel and distance', () {
    final v = VehicleOpsRow.fromJson({
      'vehicle_id': 'v1',
      'plate_no': '12345',
      'trips': 20,
      'passengers': 300,
      'violations': 0,
      'capacity': 30,
      'utilization_pct': 50,
      'fuel_cost': '84.500',
      'driven_km': '1250.40',
      'cost_per_km': 0.068,
    });
    expect(v.fuelCost, 84.5);
    expect(v.drivenKm, 1250.40);
    expect(v.costPerKm, 0.068);
    expect(v.utilizationPct, 50);
  });

  test('TripDurationReport reads totals and the per-route rows', () {
    final r = TripDurationReport.fromJson({
      'data': {
        'range': {'from': '2026-07-01', 'to': '2026-07-31'},
        'totals': {
          'trips': 40,
          'avg_planned_minutes': '45.0',
          'avg_actual_minutes': '52.5',
          'avg_start_delay_min': '3.2',
          'avg_overrun_min': '7.5',
          'late_starts': 9,
        },
        'perRoute': [
          {
            'route_id': 'r1',
            'route_name': 'Salmiya AM',
            'trips': 20,
            'avg_planned_minutes': '45.0',
            'avg_actual_minutes': '58.0',
            'avg_overrun_min': '13.0',
          },
        ],
      },
    });
    expect(r.trips, 40);
    expect(r.lateStarts, 9);
    expect(r.avgOverrunMin, 7.5);
    expect(r.perRoute.single.routeName, 'Salmiya AM');
    expect(r.perRoute.single.avgOverrunMin, 13.0);
  });

  test('InefficientTripRow keeps every flag the detector raised', () {
    final t = InefficientTripRow.fromJson({
      'tripId': 't1',
      'trip_id': 't1',
      'route_name': 'Jahra PM',
      'driver_name': 'Omar',
      'plate_no': '999',
      'service_date': '2026-07-12',
      'actual_km': '41.20',
      'referenceKm': 22,
      'detourRatio': 1.87,
      'idleShare': 0.55,
      'overrunPct': 42.0,
      'flags': ['detour', 'idling', 'overrun'],
    });
    expect(t.flags.length, 3);
    expect(t.detourRatio, 1.87);
    expect(t.actualKm, 41.2);
    expect(t.serviceDate, isNotNull);
  });

  test('FuelEfficiencyRow distinguishes an anomaly from missing data', () {
    final report = FuelEfficiencyReport.fromJson({
      'data': {
        'fleetMedianKmPerLiter': 8,
        'anomalies': 1,
        'vehicles': [
          {
            'plateNo': 'THIRSTY',
            'fills': 4,
            'kmPerLiter': 4,
            'costPerKm': 0.12,
            'deviationPct': -50,
            'anomaly': true,
            'reasons': ['low_km_per_liter'],
          },
          {
            'plateNo': 'NO-ODO',
            'fills': 3,
            'kmPerLiter': null,
            'anomaly': false,
            'reasons': ['insufficient_data'],
          },
        ],
      },
    });
    expect(report.anomalies, 1);
    expect(report.fleetMedianKmPerLiter, 8);

    final thirsty = report.vehicles.first;
    expect(thirsty.anomaly, isTrue);
    expect(thirsty.deviationPct, -50);
    expect(thirsty.insufficientData, isFalse);

    final unknown = report.vehicles.last;
    expect(unknown.anomaly, isFalse);
    expect(unknown.insufficientData, isTrue);
    expect(unknown.kmPerLiter, isNull);
  });

  test('RouteCostRow reads the cost breakdown', () {
    final r = RouteCostRow.fromJson({
      'route_name': 'Fahaheel AM',
      'trips': 22,
      'passengers': 410,
      'total_cost': 512.5,
      'cost_per_trip': 23.295,
      'cost_per_passenger': 1.25,
      'cost_per_km': 0.41,
    });
    expect(r.totalCost, 512.5);
    expect(r.costPerPassenger, 1.25);
  });

  test('AttendanceRow carries the discipline flag as sent', () {
    final e = AttendanceRow.fromJson({
      'full_name': 'Sara',
      'department': 'Kitchen',
      'scheduled': 20,
      'boarded': 12,
      'no_shows': 5,
      'excused': 3,
      'no_show_pct': 29,
      'discipline_flag': true,
    });
    expect(e.noShowPct, 29);
    expect(e.disciplineFlag, isTrue);
  });

  test('PlanAdherenceRow keeps in_window null when the driver ran no trips', () {
    final p = PlanAdherenceRow.fromJson({
      'driver_name': 'Nasser',
      'plan_status': 'approved',
      'service_date': '2026-07-09',
      'window_start': '06:00:00',
      'window_end': '10:00:00',
      'trips': 0,
      'zone_adherence_pct': null,
      'in_window': null,
      'adherent': false,
    });
    expect(p.trips, 0);
    expect(p.inWindow, isNull); // unknown, not a breach
    expect(p.zoneAdherencePct, isNull);
    expect(p.adherent, isFalse);
  });

  test('every report has a stable path and a label in both languages', () {
    for (final r in OpsReport.values) {
      expect(r.path, isNotEmpty);
      expect(r.label(true), isNotEmpty);
      expect(r.label(false), isNotEmpty);
    }
    expect(OpsReport.inefficientTrips.path, 'inefficient-trips');
  });
}
