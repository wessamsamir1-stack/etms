import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/providers.dart';
import '../../../../core/network/api_client.dart';
import '../../data/ops_reports_models.dart';
import 'fleet_ops_providers.dart' show reportRangeProvider;

/// Thin service over the operational report pack (db V0033).
class OpsReportsService {
  OpsReportsService(this._api);
  final ApiClient _api;

  Future<Map<String, dynamic>> _fetch(OpsReport report, DateTime from, DateTime to) =>
      _api.get<Map<String, dynamic>>(
        '/reports/${report.path}',
        query: {'from': _d(from), 'to': _d(to)},
      );

  Future<List<DriverOpsRow>> driverOps(DateTime from, DateTime to) async {
    final res = await _fetch(OpsReport.driverOps, from, to);
    return [
      for (final r in _list(res, 'drivers')) DriverOpsRow.fromJson(r),
    ];
  }

  Future<List<VehicleOpsRow>> vehicleOps(DateTime from, DateTime to) async {
    final res = await _fetch(OpsReport.vehicleOps, from, to);
    return [
      for (final r in _list(res, 'vehicles')) VehicleOpsRow.fromJson(r),
    ];
  }

  Future<TripDurationReport> tripDuration(DateTime from, DateTime to) async =>
      TripDurationReport.fromJson(await _fetch(OpsReport.tripDuration, from, to));

  Future<List<InefficientTripRow>> inefficientTrips(DateTime from, DateTime to) async {
    final res = await _fetch(OpsReport.inefficientTrips, from, to);
    return [
      for (final r in _list(res, 'trips')) InefficientTripRow.fromJson(r),
    ];
  }

  Future<FuelEfficiencyReport> fuelEfficiency(DateTime from, DateTime to) async =>
      FuelEfficiencyReport.fromJson(await _fetch(OpsReport.fuelEfficiency, from, to));

  Future<List<RouteCostRow>> routeCost(DateTime from, DateTime to) async {
    final res = await _fetch(OpsReport.routeCost, from, to);
    return [
      for (final r in _list(res, 'routes')) RouteCostRow.fromJson(r),
    ];
  }

  Future<List<AttendanceRow>> attendance(DateTime from, DateTime to) async {
    final res = await _fetch(OpsReport.attendance, from, to);
    return [
      for (final r in _list(res, 'employees')) AttendanceRow.fromJson(r),
    ];
  }

  Future<List<PlanAdherenceRow>> planAdherence(DateTime from, DateTime to) async {
    final res = await _fetch(OpsReport.planAdherence, from, to);
    return [
      for (final r in _list(res, 'plans')) PlanAdherenceRow.fromJson(r),
    ];
  }

  /// Every report answers `{ data: { range, <key>: [...] } }`.
  static List<Map<String, dynamic>> _list(Map<String, dynamic> res, String key) {
    final data = (res['data'] as Map<String, dynamic>?) ?? res;
    return [
      for (final r in (data[key] as List? ?? const [])) r as Map<String, dynamic>,
    ];
  }

  static String _d(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

final opsReportsServiceProvider =
    Provider<OpsReportsService>((ref) => OpsReportsService(ref.watch(apiClientProvider)));

/// The report currently selected on the screen.
final selectedOpsReportProvider = StateProvider<OpsReport>((ref) => OpsReport.driverOps);

final driverOpsProvider = FutureProvider<List<DriverOpsRow>>((ref) {
  final r = ref.watch(reportRangeProvider);
  return ref.watch(opsReportsServiceProvider).driverOps(r.from, r.to);
});

final vehicleOpsProvider = FutureProvider<List<VehicleOpsRow>>((ref) {
  final r = ref.watch(reportRangeProvider);
  return ref.watch(opsReportsServiceProvider).vehicleOps(r.from, r.to);
});

final tripDurationProvider = FutureProvider<TripDurationReport>((ref) {
  final r = ref.watch(reportRangeProvider);
  return ref.watch(opsReportsServiceProvider).tripDuration(r.from, r.to);
});

final inefficientTripsProvider = FutureProvider<List<InefficientTripRow>>((ref) {
  final r = ref.watch(reportRangeProvider);
  return ref.watch(opsReportsServiceProvider).inefficientTrips(r.from, r.to);
});

final fuelEfficiencyProvider = FutureProvider<FuelEfficiencyReport>((ref) {
  final r = ref.watch(reportRangeProvider);
  return ref.watch(opsReportsServiceProvider).fuelEfficiency(r.from, r.to);
});

final routeCostProvider = FutureProvider<List<RouteCostRow>>((ref) {
  final r = ref.watch(reportRangeProvider);
  return ref.watch(opsReportsServiceProvider).routeCost(r.from, r.to);
});

final attendanceProvider = FutureProvider<List<AttendanceRow>>((ref) {
  final r = ref.watch(reportRangeProvider);
  return ref.watch(opsReportsServiceProvider).attendance(r.from, r.to);
});

final planAdherenceProvider = FutureProvider<List<PlanAdherenceRow>>((ref) {
  final r = ref.watch(reportRangeProvider);
  return ref.watch(opsReportsServiceProvider).planAdherence(r.from, r.to);
});
