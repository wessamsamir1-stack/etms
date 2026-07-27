// Models for the operational report pack (db V0033). Each class carries only
// the columns the screen shows — the API returns more, and adding a field here
// is all it takes to surface one.

// Postgres `numeric` comes back over JSON as a STRING ('35.500'), while `::int`
// columns and anything computed in the API are real numbers — so every reader
// here has to accept both.
double? _d(Object? v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  return double.tryParse('$v');
}

int _i(Object? v) => _iOrNull(v) ?? 0;

int? _iOrNull(Object? v) {
  if (v == null) return null;
  if (v is num) return v.toInt();
  return double.tryParse('$v')?.round();
}

/// Which report the ops-reports screen is showing. One fetch at a time — the
/// pack is eight separate queries and loading them all would be wasteful.
enum OpsReport {
  driverOps,
  vehicleOps,
  tripDuration,
  inefficientTrips,
  fuelEfficiency,
  routeCost,
  attendance,
  planAdherence,
}

extension OpsReportPath on OpsReport {
  /// The `/v1/reports/<path>` segment this report is served from.
  String get path => switch (this) {
        OpsReport.driverOps => 'driver-ops',
        OpsReport.vehicleOps => 'vehicle-ops',
        OpsReport.tripDuration => 'trip-duration',
        OpsReport.inefficientTrips => 'inefficient-trips',
        OpsReport.fuelEfficiency => 'fuel-efficiency',
        OpsReport.routeCost => 'route-cost',
        OpsReport.attendance => 'attendance-discipline',
        OpsReport.planAdherence => 'plan-adherence',
      };

  String label(bool ar) => switch (this) {
        OpsReport.driverOps => ar ? 'أداء السائقين' : 'Driver ops',
        OpsReport.vehicleOps => ar ? 'أداء الباصات' : 'Vehicle ops',
        OpsReport.tripDuration => ar ? 'مدة الرحلات' : 'Trip duration',
        OpsReport.inefficientTrips => ar ? 'رحلات فيها لفّ' : 'Inefficient trips',
        OpsReport.fuelEfficiency => ar ? 'كفاءة البنزين' : 'Fuel efficiency',
        OpsReport.routeCost => ar ? 'تكلفة المسارات' : 'Route cost',
        OpsReport.attendance => ar ? 'الالتزام بالحضور' : 'Attendance',
        OpsReport.planAdherence => ar ? 'الالتزام بالخطة' : 'Plan adherence',
      };
}

/// One driver's operations scorecard (GET /v1/reports/driver-ops).
class DriverOpsRow {
  const DriverOpsRow({
    required this.driverId,
    required this.fullName,
    required this.trips,
    required this.completed,
    required this.passengers,
    required this.noShows,
    required this.violations,
    required this.incidents,
    this.onTimePct,
    this.avgDelayMin,
    this.avgRating,
  });

  final String driverId;
  final String fullName;
  final int trips, completed, passengers, noShows, violations, incidents;
  final int? onTimePct;
  final double? avgDelayMin;
  final double? avgRating;

  factory DriverOpsRow.fromJson(Map<String, dynamic> j) => DriverOpsRow(
        driverId: '${j['driver_id']}',
        fullName: '${j['full_name'] ?? ''}',
        trips: _i(j['trips']),
        completed: _i(j['completed']),
        passengers: _i(j['passengers']),
        noShows: _i(j['no_shows']),
        violations: _i(j['violations']),
        incidents: _i(j['incidents']),
        onTimePct: _iOrNull(j['on_time_pct']),
        avgDelayMin: _d(j['avg_delay_min']),
        avgRating: _d(j['avg_rating']),
      );
}

/// One vehicle's operations + utilization (GET /v1/reports/vehicle-ops).
class VehicleOpsRow {
  const VehicleOpsRow({
    required this.vehicleId,
    required this.plateNo,
    required this.trips,
    required this.passengers,
    required this.violations,
    this.capacity,
    this.utilizationPct,
    this.fuelCost,
    this.drivenKm,
    this.costPerKm,
  });

  final String vehicleId;
  final String plateNo;
  final int trips, passengers, violations;
  final int? capacity;
  final int? utilizationPct;
  final double? fuelCost, drivenKm, costPerKm;

  factory VehicleOpsRow.fromJson(Map<String, dynamic> j) => VehicleOpsRow(
        vehicleId: '${j['vehicle_id']}',
        plateNo: '${j['plate_no'] ?? ''}',
        trips: _i(j['trips']),
        passengers: _i(j['passengers']),
        violations: _i(j['violations']),
        capacity: _iOrNull(j['capacity']),
        utilizationPct: _iOrNull(j['utilization_pct']),
        fuelCost: _d(j['fuel_cost']),
        drivenKm: _d(j['driven_km']),
        costPerKm: _d(j['cost_per_km']),
      );
}

/// Planned vs actual duration, per route (GET /v1/reports/trip-duration).
class TripDurationReport {
  const TripDurationReport({
    required this.trips,
    required this.lateStarts,
    required this.perRoute,
    this.avgPlannedMinutes,
    this.avgActualMinutes,
    this.avgStartDelayMin,
    this.avgOverrunMin,
  });

  final int trips, lateStarts;
  final double? avgPlannedMinutes, avgActualMinutes, avgStartDelayMin, avgOverrunMin;
  final List<RouteDurationRow> perRoute;

  factory TripDurationReport.fromJson(Map<String, dynamic> j) {
    final data = (j['data'] as Map<String, dynamic>?) ?? j;
    final t = (data['totals'] as Map<String, dynamic>?) ?? const {};
    return TripDurationReport(
      trips: _i(t['trips']),
      lateStarts: _i(t['late_starts']),
      avgPlannedMinutes: _d(t['avg_planned_minutes']),
      avgActualMinutes: _d(t['avg_actual_minutes']),
      avgStartDelayMin: _d(t['avg_start_delay_min']),
      avgOverrunMin: _d(t['avg_overrun_min']),
      perRoute: [
        for (final r in (data['perRoute'] as List? ?? const []))
          RouteDurationRow.fromJson(r as Map<String, dynamic>),
      ],
    );
  }
}

class RouteDurationRow {
  const RouteDurationRow({
    required this.routeName,
    required this.trips,
    this.avgPlannedMinutes,
    this.avgActualMinutes,
    this.avgOverrunMin,
  });

  final String routeName;
  final int trips;
  final double? avgPlannedMinutes, avgActualMinutes, avgOverrunMin;

  factory RouteDurationRow.fromJson(Map<String, dynamic> j) => RouteDurationRow(
        routeName: '${j['route_name'] ?? ''}',
        trips: _i(j['trips']),
        avgPlannedMinutes: _d(j['avg_planned_minutes']),
        avgActualMinutes: _d(j['avg_actual_minutes']),
        avgOverrunMin: _d(j['avg_overrun_min']),
      );
}

/// A trip the detour detector flagged (GET /v1/reports/inefficient-trips).
class InefficientTripRow {
  const InefficientTripRow({
    required this.tripId,
    required this.flags,
    required this.routeName,
    required this.driverName,
    required this.plateNo,
    this.serviceDate,
    this.actualKm,
    this.referenceKm,
    this.detourRatio,
    this.idleShare,
    this.overrunPct,
  });

  final String tripId;

  /// 'detour' | 'idling' | 'overrun'.
  final List<String> flags;
  final String routeName, driverName, plateNo;
  final DateTime? serviceDate;
  final double? actualKm, referenceKm, detourRatio, idleShare, overrunPct;

  factory InefficientTripRow.fromJson(Map<String, dynamic> j) => InefficientTripRow(
        tripId: '${j['tripId'] ?? j['trip_id']}',
        flags: [for (final f in (j['flags'] as List? ?? const [])) '$f'],
        routeName: '${j['route_name'] ?? ''}',
        driverName: '${j['driver_name'] ?? ''}',
        plateNo: '${j['plate_no'] ?? ''}',
        serviceDate: j['service_date'] is String
            ? DateTime.tryParse(j['service_date'] as String)
            : null,
        actualKm: _d(j['actual_km']),
        referenceKm: _d(j['referenceKm']),
        detourRatio: _d(j['detourRatio']),
        idleShare: _d(j['idleShare']),
        overrunPct: _d(j['overrunPct']),
      );
}

/// Per-bus fuel efficiency with the anomaly verdict
/// (GET /v1/reports/fuel-efficiency).
class FuelEfficiencyReport {
  const FuelEfficiencyReport({
    required this.vehicles,
    required this.anomalies,
    this.fleetMedianKmPerLiter,
  });

  final List<FuelEfficiencyRow> vehicles;
  final int anomalies;
  final double? fleetMedianKmPerLiter;

  factory FuelEfficiencyReport.fromJson(Map<String, dynamic> j) {
    final data = (j['data'] as Map<String, dynamic>?) ?? j;
    return FuelEfficiencyReport(
      anomalies: _i(data['anomalies']),
      fleetMedianKmPerLiter: _d(data['fleetMedianKmPerLiter']),
      vehicles: [
        for (final v in (data['vehicles'] as List? ?? const []))
          FuelEfficiencyRow.fromJson(v as Map<String, dynamic>),
      ],
    );
  }
}

class FuelEfficiencyRow {
  const FuelEfficiencyRow({
    required this.plateNo,
    required this.fills,
    required this.anomaly,
    required this.reasons,
    this.kmPerLiter,
    this.costPerKm,
    this.deviationPct,
  });

  final String plateNo;
  final int fills;
  final bool anomaly;

  /// 'low_km_per_liter' | 'high_cost_per_km' | 'insufficient_data'.
  final List<String> reasons;
  final double? kmPerLiter, costPerKm, deviationPct;

  bool get insufficientData => reasons.contains('insufficient_data');

  factory FuelEfficiencyRow.fromJson(Map<String, dynamic> j) => FuelEfficiencyRow(
        plateNo: '${j['plateNo'] ?? ''}',
        fills: _i(j['fills']),
        anomaly: j['anomaly'] == true,
        reasons: [for (final r in (j['reasons'] as List? ?? const [])) '$r'],
        kmPerLiter: _d(j['kmPerLiter']),
        costPerKm: _d(j['costPerKm']),
        deviationPct: _d(j['deviationPct']),
      );
}

/// Cost of running one route over the period (GET /v1/reports/route-cost).
class RouteCostRow {
  const RouteCostRow({
    required this.routeName,
    required this.trips,
    required this.passengers,
    required this.totalCost,
    this.costPerTrip,
    this.costPerPassenger,
    this.costPerKm,
  });

  final String routeName;
  final int trips, passengers;
  final double totalCost;
  final double? costPerTrip, costPerPassenger, costPerKm;

  factory RouteCostRow.fromJson(Map<String, dynamic> j) => RouteCostRow(
        routeName: '${j['route_name'] ?? ''}',
        trips: _i(j['trips']),
        passengers: _i(j['passengers']),
        totalCost: _d(j['total_cost']) ?? 0,
        costPerTrip: _d(j['cost_per_trip']),
        costPerPassenger: _d(j['cost_per_passenger']),
        costPerKm: _d(j['cost_per_km']),
      );
}

/// One employee's attendance record (GET /v1/reports/attendance-discipline).
class AttendanceRow {
  const AttendanceRow({
    required this.fullName,
    required this.scheduled,
    required this.boarded,
    required this.noShows,
    required this.excused,
    required this.noShowPct,
    required this.disciplineFlag,
    this.department,
  });

  final String fullName;
  final String? department;
  final int scheduled, boarded, noShows, excused, noShowPct;

  /// Repeated AND frequent — the line ops actually acts on.
  final bool disciplineFlag;

  factory AttendanceRow.fromJson(Map<String, dynamic> j) => AttendanceRow(
        fullName: '${j['full_name'] ?? ''}',
        department: j['department'] as String?,
        scheduled: _i(j['scheduled']),
        boarded: _i(j['boarded']),
        noShows: _i(j['no_shows']),
        excused: _i(j['excused']),
        noShowPct: _i(j['no_show_pct']),
        disciplineFlag: j['discipline_flag'] == true,
      );
}

/// Did the driver drive the day they proposed (GET /v1/reports/plan-adherence).
class PlanAdherenceRow {
  const PlanAdherenceRow({
    required this.driverName,
    required this.planStatus,
    required this.trips,
    required this.adherent,
    this.serviceDate,
    this.windowStart,
    this.windowEnd,
    this.zoneAdherencePct,
    this.inWindow,
  });

  final String driverName;
  final String planStatus; // proposed | approved | rejected | cancelled
  final int trips;
  final bool adherent;
  final DateTime? serviceDate;
  final String? windowStart, windowEnd;
  final int? zoneAdherencePct;

  /// Null when the driver ran no trips that day — unknown, not a breach.
  final bool? inWindow;

  factory PlanAdherenceRow.fromJson(Map<String, dynamic> j) => PlanAdherenceRow(
        driverName: '${j['driver_name'] ?? ''}',
        planStatus: '${j['plan_status'] ?? ''}',
        trips: _i(j['trips']),
        adherent: j['adherent'] == true,
        serviceDate: j['service_date'] is String
            ? DateTime.tryParse(j['service_date'] as String)
            : null,
        windowStart: j['window_start'] as String?,
        windowEnd: j['window_end'] as String?,
        zoneAdherencePct: _iOrNull(j['zone_adherence_pct']),
        inWindow: j['in_window'] as bool?,
      );
}
