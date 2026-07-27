import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyTrip, rankInefficientTrips, type TripEfficiencyInput } from './trip_efficiency';

const trip = (over: Partial<TripEfficiencyInput> = {}): TripEfficiencyInput => ({
  tripId: 't1',
  actualKm: 20,
  plannedKm: 20,
  directKm: 15,
  pings: 100,
  idlePings: 10,
  plannedMinutes: 40,
  actualMinutes: 42,
  ...over,
});

test('a trip driven as planned is not flagged', () => {
  const r = classifyTrip(trip());
  assert.equal(r.inefficient, false);
  assert.deepEqual(r.flags, []);
  assert.equal(r.detourRatio, 1);
});

test('driving well beyond the planned route length is a detour', () => {
  const r = classifyTrip(trip({ actualKm: 32 })); // 60% further than planned
  assert.deepEqual(r.flags, ['detour']);
  assert.equal(r.detourRatio, 1.6);
  assert.equal(r.referenceKm, 20);
});

test('without a route the straight line is the reference', () => {
  const r = classifyTrip(trip({ plannedKm: null, actualKm: 30, directKm: 15 }));
  assert.equal(r.referenceKm, 15);
  assert.equal(r.detourRatio, 2);
  assert.ok(r.flags.includes('detour'));
});

test('a mostly stationary trip is flagged as idling', () => {
  const r = classifyTrip(trip({ pings: 100, idlePings: 60 }));
  assert.deepEqual(r.flags, ['idling']);
  assert.equal(r.idleShare, 0.6);
});

test('taking much longer than planned is an overrun', () => {
  const r = classifyTrip(trip({ actualMinutes: 60 })); // +50%
  assert.deepEqual(r.flags, ['overrun']);
  assert.equal(r.overrunPct, 50);
});

test('a very short reference distance is ignored — GPS noise, not a detour', () => {
  const r = classifyTrip(trip({ plannedKm: null, directKm: 0.4, actualKm: 2 }));
  assert.equal(r.detourRatio, null);
  assert.equal(r.inefficient, false);
});

test('thresholds are configurable', () => {
  const t = trip({ actualKm: 25 }); // +25%, under the 1.35 default
  assert.equal(classifyTrip(t).inefficient, false);
  assert.equal(classifyTrip(t, { detourRatio: 1.2 }).inefficient, true);
});

test('ranking puts the worst offenders first and drops the clean trips', () => {
  const ranked = rankInefficientTrips([
    trip({ tripId: 'clean' }),
    trip({ tripId: 'detour', actualKm: 30 }),
    trip({ tripId: 'everything', actualKm: 40, idlePings: 70, actualMinutes: 90 }),
  ]);
  assert.deepEqual(ranked.map((r) => r.tripId), ['everything', 'detour']);
  assert.equal(ranked[0]!.flags.length, 3);
});

test('a trip with no GPS trail yields no verdict rather than a false flag', () => {
  const r = classifyTrip(trip({ actualKm: null, pings: 0, idlePings: 0, plannedMinutes: null }));
  assert.equal(r.detourRatio, null);
  assert.equal(r.idleShare, null);
  assert.equal(r.overrunPct, null);
  assert.equal(r.inefficient, false);
});
