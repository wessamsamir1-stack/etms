/// Models for the fuel log + traffic-violation register and their reports
/// (backend routes_fuel_violations / db V0029).
class FuelLog {
  const FuelLog({
    required this.id,
    required this.vehicleId,
    required this.plateNo,
    required this.liters,
    required this.costAmount,
    required this.currency,
    required this.fuelType,
    this.driver,
    this.filledAt,
    this.odometerKm,
    this.station,
    this.notes,
  });

  final String id;
  final String vehicleId;
  final String plateNo;
  final double liters;
  final double costAmount;
  final String currency;
  final String fuelType; // petrol_91 | petrol_95 | diesel
  final String? driver;
  final DateTime? filledAt;
  final int? odometerKm;
  final String? station;
  final String? notes;

  factory FuelLog.fromJson(Map<String, dynamic> j) => FuelLog(
        id: '${j['id']}',
        vehicleId: '${j['vehicle_id']}',
        plateNo: '${j['plate_no'] ?? ''}',
        liters: _num(j['liters']),
        costAmount: _num(j['cost_amount']),
        currency: '${j['currency_code'] ?? 'KWD'}',
        fuelType: '${j['fuel_type'] ?? 'petrol_91'}',
        driver: j['driver'] as String?,
        filledAt: _dt(j['filled_at']),
        odometerKm: (j['odometer_km'] as num?)?.toInt(),
        station: j['station'] as String?,
        notes: j['notes'] as String?,
      );
}

enum ViolationStatus { pending, paid, disputed, waived, deducted, unknown }

ViolationStatus violationStatusFrom(String? s) {
  switch (s) {
    case 'pending':
      return ViolationStatus.pending;
    case 'paid':
      return ViolationStatus.paid;
    case 'disputed':
      return ViolationStatus.disputed;
    case 'waived':
      return ViolationStatus.waived;
    case 'deducted':
      return ViolationStatus.deducted;
    default:
      return ViolationStatus.unknown;
  }
}

String violationStatusWire(ViolationStatus s) => switch (s) {
      ViolationStatus.pending => 'pending',
      ViolationStatus.paid => 'paid',
      ViolationStatus.disputed => 'disputed',
      ViolationStatus.waived => 'waived',
      ViolationStatus.deducted => 'deducted',
      ViolationStatus.unknown => 'pending',
    };

class Violation {
  const Violation({
    required this.id,
    required this.vehicleId,
    required this.plateNo,
    required this.type,
    required this.amount,
    required this.currency,
    required this.status,
    this.driver,
    this.violationNo,
    this.occurredAt,
    this.location,
    this.deductFromDriver = false,
    this.notes,
  });

  final String id;
  final String vehicleId;
  final String plateNo;
  final String type;
  final double amount;
  final String currency;
  final ViolationStatus status;
  final String? driver;
  final String? violationNo;
  final DateTime? occurredAt;
  final String? location;
  final bool deductFromDriver;
  final String? notes;

  factory Violation.fromJson(Map<String, dynamic> j) => Violation(
        id: '${j['id']}',
        vehicleId: '${j['vehicle_id']}',
        plateNo: '${j['plate_no'] ?? ''}',
        type: '${j['violation_type'] ?? 'other'}',
        amount: _num(j['amount']),
        currency: '${j['currency_code'] ?? 'KWD'}',
        status: violationStatusFrom(j['status'] as String?),
        driver: j['driver'] as String?,
        violationNo: j['violation_no'] as String?,
        occurredAt: _dt(j['occurred_at']),
        location: j['location'] as String?,
        deductFromDriver: j['deduct_from_driver'] == true,
        notes: j['notes'] as String?,
      );
}

/// GET /v1/reports/fuel — totals + per-vehicle consumption rows.
class FuelReport {
  const FuelReport({required this.fills, required this.liters, required this.cost, required this.perVehicle});

  final int fills;
  final double liters;
  final double cost;
  final List<FuelVehicleRow> perVehicle;

  factory FuelReport.fromJson(Map<String, dynamic> j) {
    final data = (j['data'] as Map<String, dynamic>?) ?? j;
    final totals = (data['totals'] as Map<String, dynamic>?) ?? const {};
    return FuelReport(
      fills: (totals['fills'] as num?)?.toInt() ?? 0,
      liters: _num(totals['liters']),
      cost: _num(totals['cost']),
      perVehicle: [
        for (final r in (data['perVehicle'] as List? ?? const []))
          FuelVehicleRow.fromJson(r as Map<String, dynamic>),
      ],
    );
  }
}

class FuelVehicleRow {
  const FuelVehicleRow({
    required this.plateNo,
    required this.fills,
    required this.liters,
    required this.cost,
    this.km,
    this.kmPerLiter,
  });

  final String plateNo;
  final int fills;
  final double liters;
  final double cost;
  final int? km;
  final double? kmPerLiter;

  factory FuelVehicleRow.fromJson(Map<String, dynamic> j) => FuelVehicleRow(
        plateNo: '${j['plate_no'] ?? ''}',
        fills: (j['fills'] as num?)?.toInt() ?? 0,
        liters: _num(j['liters']),
        cost: _num(j['cost']),
        km: (j['km'] as num?)?.toInt(),
        kmPerLiter: j['km_per_liter'] == null ? null : _num(j['km_per_liter']),
      );
}

/// GET /v1/reports/violations — totals + per-type + per-driver rows.
class ViolationsReport {
  const ViolationsReport({
    required this.violations,
    required this.pending,
    required this.totalAmount,
    required this.unpaidAmount,
    required this.byType,
    required this.perDriver,
  });

  final int violations;
  final int pending;
  final double totalAmount;
  final double unpaidAmount;
  final List<({String type, int violations, double amount})> byType;
  final List<({String driver, int violations, double amount})> perDriver;

  factory ViolationsReport.fromJson(Map<String, dynamic> j) {
    final data = (j['data'] as Map<String, dynamic>?) ?? j;
    final totals = (data['totals'] as Map<String, dynamic>?) ?? const {};
    return ViolationsReport(
      violations: (totals['violations'] as num?)?.toInt() ?? 0,
      pending: (totals['pending'] as num?)?.toInt() ?? 0,
      totalAmount: _num(totals['total_amount']),
      unpaidAmount: _num(totals['unpaid_amount']),
      byType: [
        for (final r in (data['byType'] as List? ?? const []))
          (
            type: '${(r as Map)['violation_type'] ?? 'other'}',
            violations: (r['violations'] as num?)?.toInt() ?? 0,
            amount: _num(r['amount']),
          ),
      ],
      perDriver: [
        for (final r in (data['perDriver'] as List? ?? const []))
          (
            driver: '${(r as Map)['full_name'] ?? ''}',
            violations: (r['violations'] as num?)?.toInt() ?? 0,
            amount: _num(r['amount']),
          ),
      ],
    );
  }
}

/// A vehicle option for the add-fuel / add-violation dropdowns.
class VehicleOption {
  const VehicleOption({required this.id, required this.plateNo});
  final String id;
  final String plateNo;
  factory VehicleOption.fromJson(Map<String, dynamic> j) =>
      VehicleOption(id: '${j['id']}', plateNo: '${j['plate_no'] ?? ''}');
}

/// A driver option for the add-fuel / add-violation dropdowns.
class DriverOption {
  const DriverOption({required this.id, required this.fullName});
  final String id;
  final String fullName;
  factory DriverOption.fromJson(Map<String, dynamic> j) =>
      DriverOption(id: '${j['id']}', fullName: '${j['full_name'] ?? ''}');
}

double _num(Object? v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;
DateTime? _dt(Object? v) => v is String ? DateTime.tryParse(v) : null;
