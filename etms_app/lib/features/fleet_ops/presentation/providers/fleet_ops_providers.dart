import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/providers.dart';
import '../../../../core/network/api_client.dart';
import '../../data/fleet_ops_models.dart';

/// Thin service over the fuel / violations / reports endpoints (db V0029).
class FleetOpsService {
  FleetOpsService(this._api);
  final ApiClient _api;

  // Fuel log.
  Future<List<FuelLog>> fuelLogs({String? vehicleId}) async {
    final res = await _api.get<Map<String, dynamic>>('/fuel-logs',
        query: {if (vehicleId != null) 'vehicle_id': vehicleId});
    return [for (final r in (res['data'] as List? ?? const [])) FuelLog.fromJson(r as Map<String, dynamic>)];
  }

  Future<void> addFuelLog({
    required String vehicleId,
    required double liters,
    required double costAmount,
    String? driverId,
    String fuelType = 'petrol_91',
    int? odometerKm,
    String? station,
    String? notes,
  }) =>
      _api.post<Map<String, dynamic>>('/fuel-logs', body: {
        'vehicle_id': vehicleId,
        'liters': liters,
        'cost_amount': costAmount,
        'fuel_type': fuelType,
        if (driverId != null) 'driver_id': driverId,
        if (odometerKm != null) 'odometer_km': odometerKm,
        if (station != null && station.isNotEmpty) 'station': station,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
      });

  // Violations.
  Future<List<Violation>> violations({ViolationStatus? status}) async {
    final res = await _api.get<Map<String, dynamic>>('/violations',
        query: {if (status != null) 'status': violationStatusWire(status)});
    return [for (final r in (res['data'] as List? ?? const [])) Violation.fromJson(r as Map<String, dynamic>)];
  }

  Future<void> addViolation({
    required String vehicleId,
    required String violationType,
    required double amount,
    String? driverId,
    String? violationNo,
    String? location,
    bool deductFromDriver = false,
    String? notes,
  }) =>
      _api.post<Map<String, dynamic>>('/violations', body: {
        'vehicle_id': vehicleId,
        'violation_type': violationType,
        'amount': amount,
        'deduct_from_driver': deductFromDriver,
        if (driverId != null) 'driver_id': driverId,
        if (violationNo != null && violationNo.isNotEmpty) 'violation_no': violationNo,
        if (location != null && location.isNotEmpty) 'location': location,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
      });

  Future<void> setViolationStatus(String id, ViolationStatus status) =>
      _api.post<Map<String, dynamic>>('/violations/$id/status',
          body: {'status': violationStatusWire(status)});

  // Reports.
  Future<FuelReport> fuelReport(DateTime from, DateTime to) async {
    final res = await _api.get<Map<String, dynamic>>('/reports/fuel',
        query: {'from': _d(from), 'to': _d(to)});
    return FuelReport.fromJson(res);
  }

  Future<ViolationsReport> violationsReport(DateTime from, DateTime to) async {
    final res = await _api.get<Map<String, dynamic>>('/reports/violations',
        query: {'from': _d(from), 'to': _d(to)});
    return ViolationsReport.fromJson(res);
  }

  // Dropdown data (admin CRUD list endpoints).
  Future<List<VehicleOption>> vehicles() async {
    final res = await _api.get<Map<String, dynamic>>('/vehicles');
    return [for (final r in (res['data'] as List? ?? const [])) VehicleOption.fromJson(r as Map<String, dynamic>)];
  }

  Future<List<DriverOption>> drivers() async {
    final res = await _api.get<Map<String, dynamic>>('/drivers');
    return [for (final r in (res['data'] as List? ?? const [])) DriverOption.fromJson(r as Map<String, dynamic>)];
  }

  static String _d(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

final fleetOpsServiceProvider =
    Provider<FleetOpsService>((ref) => FleetOpsService(ref.watch(apiClientProvider)));

final fuelLogsProvider = FutureProvider<List<FuelLog>>(
    (ref) => ref.watch(fleetOpsServiceProvider).fuelLogs());

/// Violations, optionally filtered by status (null = all).
final violationsProvider = FutureProvider.family<List<Violation>, ViolationStatus?>(
    (ref, status) => ref.watch(fleetOpsServiceProvider).violations(status: status));

/// Date range used by the reports screen; defaults to the current month.
final reportRangeProvider = StateProvider<({DateTime from, DateTime to})>((ref) {
  final now = DateTime.now();
  return (from: DateTime(now.year, now.month, 1), to: DateTime(now.year, now.month + 1, 0));
});

final fuelReportProvider = FutureProvider<FuelReport>((ref) {
  final r = ref.watch(reportRangeProvider);
  return ref.watch(fleetOpsServiceProvider).fuelReport(r.from, r.to);
});

final violationsReportProvider = FutureProvider<ViolationsReport>((ref) {
  final r = ref.watch(reportRangeProvider);
  return ref.watch(fleetOpsServiceProvider).violationsReport(r.from, r.to);
});

final vehicleOptionsProvider = FutureProvider<List<VehicleOption>>(
    (ref) => ref.watch(fleetOpsServiceProvider).vehicles());

final driverOptionsProvider = FutureProvider<List<DriverOption>>(
    (ref) => ref.watch(fleetOpsServiceProvider).drivers());
