/**
 * Fuel-efficiency scoring (pure). The fuel report tells you what each bus
 * burned; this decides which of them is burning too much. A bus is compared
 * against the FLEET MEDIAN of the same period rather than a fixed target, so
 * the flag survives a change of fuel price, route mix or season.
 *
 * Median, not mean: one leaking bus would drag a mean down far enough to make
 * itself look normal.
 */

/** One vehicle's fuel usage over the reported period. */
export interface VehicleFuelUsage {
  vehicleId: string;
  plateNo: string | null;
  fills: number;
  liters: number;
  cost: number;
  /** Odometer span over the period; null when the fills carry no odometer. */
  km: number | null;
}

export type AnomalyReason = 'low_km_per_liter' | 'high_cost_per_km' | 'insufficient_data';

export interface VehicleFuelEfficiency extends VehicleFuelUsage {
  kmPerLiter: number | null;
  costPerKm: number | null;
  /** How far below the fleet median this bus runs, in percent (null = unknown). */
  deviationPct: number | null;
  anomaly: boolean;
  reasons: AnomalyReason[];
}

export interface FuelEfficiencyReport {
  fleetMedianKmPerLiter: number | null;
  fleetMedianCostPerKm: number | null;
  vehicles: VehicleFuelEfficiency[];
  anomalies: number;
}

export interface FuelEfficiencyOptions {
  /** Flag below this share of the fleet median km/L. Default 0.75 (−25%). */
  kmPerLiterFloor?: number;
  /** Flag above this multiple of the fleet median cost/km. Default 1.25 (+25%). */
  costPerKmCeiling?: number;
  /** Fewer fills than this and there is nothing to judge. Default 2. */
  minFills?: number;
}

export function median(values: readonly number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  if (xs.length % 2 === 1) return xs[mid] as number;
  return ((xs[mid - 1] as number) + (xs[mid] as number)) / 2;
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * Score every bus against the fleet and flag the outliers. A bus with too few
 * fills, or with no odometer readings, is reported as `insufficient_data` —
 * never as an anomaly, because we cannot tell.
 */
export function scoreFuelEfficiency(
  usage: readonly VehicleFuelUsage[],
  options: FuelEfficiencyOptions = {},
): FuelEfficiencyReport {
  const floor = options.kmPerLiterFloor ?? 0.75;
  const ceiling = options.costPerKmCeiling ?? 1.25;
  const minFills = options.minFills ?? 2;

  const base = usage.map((v) => {
    const measurable = v.km !== null && v.km > 0 && v.liters > 0 && v.fills >= minFills;
    return {
      ...v,
      kmPerLiter: measurable ? round((v.km as number) / v.liters) : null,
      costPerKm: measurable && v.cost > 0 ? round(v.cost / (v.km as number), 4) : null,
      measurable,
    };
  });

  const medianKmL = median(base.flatMap((v) => (v.kmPerLiter === null ? [] : [v.kmPerLiter])));
  const medianCostKm = median(base.flatMap((v) => (v.costPerKm === null ? [] : [v.costPerKm])));

  const vehicles: VehicleFuelEfficiency[] = base.map((v) => {
    const reasons: AnomalyReason[] = [];
    if (!v.measurable) reasons.push('insufficient_data');
    if (v.kmPerLiter !== null && medianKmL !== null && v.kmPerLiter < medianKmL * floor) {
      reasons.push('low_km_per_liter');
    }
    if (v.costPerKm !== null && medianCostKm !== null && v.costPerKm > medianCostKm * ceiling) {
      reasons.push('high_cost_per_km');
    }
    const deviationPct =
      v.kmPerLiter !== null && medianKmL !== null && medianKmL > 0
        ? round(((v.kmPerLiter - medianKmL) / medianKmL) * 100, 1)
        : null;
    const { measurable: _measurable, ...rest } = v;
    return {
      ...rest,
      deviationPct,
      anomaly: reasons.some((r) => r !== 'insufficient_data'),
      reasons,
    };
  });

  return {
    fleetMedianKmPerLiter: medianKmL,
    fleetMedianCostPerKm: medianCostKm,
    vehicles,
    anomalies: vehicles.filter((v) => v.anomaly).length,
  };
}
