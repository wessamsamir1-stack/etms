import { haversineKm, LatLng } from '../../util/geo';

/** A pickup stop with its demand (number of riders to board). */
export interface Stop extends LatLng {
  id: string;
  demand: number;
  /**
   * Soft routing priority (default 0). Company residences carry a high priority
   * so they are pulled earlier without being forced (weighted, not strict) —
   * see docs/etms/11 §B.3.
   */
  priority?: number;
}

/** How strongly priority biases selection (effectiveCost = dist / (1 + GAIN*priority)). */
const PRIORITY_GAIN = 1;

export interface OptimizedRoute {
  stopIds: string[];
  distanceKm: number;
  load: number;
}

export interface OptimizeOptions {
  /** Vehicle seat capacity. */
  capacity: number;
}

/**
 * Route Optimization Engine (pluggable, per docs/etms/02 §RouteOptimizerPort).
 *
 * Capacitated nearest-neighbour construction: starting from the depot (site),
 * repeatedly append the closest unvisited stop that still fits the vehicle's
 * remaining capacity; when nothing fits, close the vehicle (return to depot) and
 * start a new one. Deterministic tie-breaking by stop id keeps results stable
 * and testable. This is a fast, good-enough heuristic; a metaheuristic (2-opt /
 * OR-Tools) can replace it behind the same interface without touching callers.
 *
 * Distance is the full depot → stops → depot loop (haversine).
 */
export function optimizeRoutes(
  stops: readonly Stop[],
  depot: LatLng,
  opts: OptimizeOptions,
): OptimizedRoute[] {
  if (opts.capacity <= 0) throw new Error('capacity must be > 0');

  const remaining = new Map(stops.map((s) => [s.id, s]));
  const routes: OptimizedRoute[] = [];

  while (remaining.size > 0) {
    const stopIds: string[] = [];
    let load = 0;
    let cursor: LatLng = depot;

    // Build one vehicle's route.
    while (remaining.size > 0) {
      const next = nearestFitting(cursor, remaining, opts.capacity - load);
      if (!next) break; // nothing else fits this vehicle
      stopIds.push(next.id);
      load += next.demand;
      cursor = next;
      remaining.delete(next.id);
    }

    // Safety: an oversized single stop (demand > capacity) still gets its own
    // vehicle so we never loop forever.
    if (stopIds.length === 0) {
      const next = nearest(depot, remaining)!;
      stopIds.push(next.id);
      load += next.demand;
      cursor = next;
      remaining.delete(next.id);
    }

    routes.push({
      stopIds,
      load,
      distanceKm: round(routeDistance(depot, stopIds, stops)),
    });
  }

  return routes;
}

/** Priority-weighted distance: higher priority → lower effective cost. */
function effectiveCost(from: LatLng, s: Stop): number {
  return haversineKm(from, s) / (1 + PRIORITY_GAIN * (s.priority ?? 0));
}

function nearestFitting(
  from: LatLng,
  pool: Map<string, Stop>,
  capacityLeft: number,
): Stop | undefined {
  let best: Stop | undefined;
  let bestC = Infinity;
  for (const s of pool.values()) {
    if (s.demand > capacityLeft) continue;
    const cst = effectiveCost(from, s);
    if (cst < bestC || (cst === bestC && (!best || s.id < best.id))) {
      best = s;
      bestC = cst;
    }
  }
  return best;
}

function nearest(from: LatLng, pool: Map<string, Stop>): Stop | undefined {
  let best: Stop | undefined;
  let bestC = Infinity;
  for (const s of pool.values()) {
    const cst = effectiveCost(from, s);
    if (cst < bestC || (cst === bestC && (!best || s.id < best.id))) {
      best = s;
      bestC = cst;
    }
  }
  return best;
}

function routeDistance(
  depot: LatLng,
  stopIds: readonly string[],
  stops: readonly Stop[],
): number {
  const byId = new Map(stops.map((s) => [s.id, s]));
  let total = 0;
  let cursor: LatLng = depot;
  for (const id of stopIds) {
    const s = byId.get(id)!;
    total += haversineKm(cursor, s);
    cursor = s;
  }
  total += haversineKm(cursor, depot); // return to depot
  return total;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
