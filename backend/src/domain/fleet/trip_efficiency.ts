/**
 * Detour / inefficiency detection for a finished trip (pure). The GPS trail
 * tells us how far the bus actually drove; the route (or, without one, the
 * straight line between the first and last ping) tells us how far it should
 * have driven. Driving noticeably further than that is a lap — the driver went
 * around, doubled back, or ran an errand on company time.
 *
 * Three independent signals, any of which flags the trip:
 *   detour   — driven distance well above the reference distance
 *   idling   — most of the trip's pings were stationary
 *   overrun  — it took much longer than planned
 */

export interface TripEfficiencyInput {
  tripId: string;
  /** Distance actually driven, from the GPS trail (km). */
  actualKm: number | null;
  /** Planned route length (km) — preferred reference when the trip has a route. */
  plannedKm: number | null;
  /** Straight line from first to last ping (km) — the fallback reference. */
  directKm: number | null;
  pings: number;
  idlePings: number;
  plannedMinutes: number | null;
  actualMinutes: number | null;
}

export type InefficiencyFlag = 'detour' | 'idling' | 'overrun';

export interface TripEfficiency {
  tripId: string;
  referenceKm: number | null;
  /** actualKm ÷ referenceKm; > 1 means further than it should have been. */
  detourRatio: number | null;
  /** Share of pings the bus was stationary for, 0–1. */
  idleShare: number | null;
  overrunPct: number | null;
  flags: InefficiencyFlag[];
  inefficient: boolean;
}

export interface TripEfficiencyThresholds {
  /** Flag above this driven/reference ratio. Default 1.35 (+35%). */
  detourRatio?: number;
  /** Flag above this share of stationary pings. Default 0.4. */
  idleShare?: number;
  /** Flag above this % over the planned duration. Default 30. */
  overrunPct?: number;
  /** Ignore trips shorter than this — GPS noise dominates. Default 1 km. */
  minReferenceKm?: number;
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function classifyTrip(
  t: TripEfficiencyInput,
  thresholds: TripEfficiencyThresholds = {},
): TripEfficiency {
  const maxRatio = thresholds.detourRatio ?? 1.35;
  const maxIdle = thresholds.idleShare ?? 0.4;
  const maxOverrun = thresholds.overrunPct ?? 30;
  const minKm = thresholds.minReferenceKm ?? 1;

  // The planned route is the honest yardstick; the straight line only says the
  // bus could not possibly have driven less than this.
  const referenceKm = t.plannedKm && t.plannedKm > 0 ? t.plannedKm : t.directKm;

  const detourRatio =
    t.actualKm !== null && referenceKm !== null && referenceKm >= minKm
      ? round(t.actualKm / referenceKm)
      : null;
  const idleShare = t.pings > 0 ? round(t.idlePings / t.pings) : null;
  const overrunPct =
    t.plannedMinutes !== null && t.plannedMinutes > 0 && t.actualMinutes !== null
      ? round(((t.actualMinutes - t.plannedMinutes) / t.plannedMinutes) * 100, 1)
      : null;

  const flags: InefficiencyFlag[] = [];
  if (detourRatio !== null && detourRatio > maxRatio) flags.push('detour');
  if (idleShare !== null && idleShare > maxIdle) flags.push('idling');
  if (overrunPct !== null && overrunPct > maxOverrun) flags.push('overrun');

  return {
    tripId: t.tripId,
    referenceKm,
    detourRatio,
    idleShare,
    overrunPct,
    flags,
    inefficient: flags.length > 0,
  };
}

/** Worst offenders first — most flags, then the biggest detour. */
export function rankInefficientTrips(
  trips: readonly TripEfficiencyInput[],
  thresholds: TripEfficiencyThresholds = {},
): TripEfficiency[] {
  return trips
    .map((t) => classifyTrip(t, thresholds))
    .filter((t) => t.inefficient)
    .sort((a, b) => b.flags.length - a.flags.length || (b.detourRatio ?? 0) - (a.detourRatio ?? 0));
}
