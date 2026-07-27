import assert from 'node:assert/strict';
import { test } from 'node:test';
import { median, scoreFuelEfficiency, type VehicleFuelUsage } from './fuel_efficiency';

const bus = (id: string, km: number | null, liters: number, cost = 100, fills = 4): VehicleFuelUsage => ({
  vehicleId: id,
  plateNo: id,
  fills,
  liters,
  cost,
  km,
});

test('median handles odd, even and empty sets', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test('km per litre and cost per km are derived per bus', () => {
  const r = scoreFuelEfficiency([bus('A', 800, 100, 40)]);
  const a = r.vehicles[0]!;
  assert.equal(a.kmPerLiter, 8);
  assert.equal(a.costPerKm, 0.05);
});

test('a bus well below the fleet median km/L is flagged as an anomaly', () => {
  const report = scoreFuelEfficiency([
    bus('A', 800, 100),
    bus('B', 800, 100),
    bus('C', 800, 100),
    bus('THIRSTY', 400, 100), // half the fleet's mileage per litre
  ]);
  assert.equal(report.fleetMedianKmPerLiter, 8);
  const thirsty = report.vehicles.find((v) => v.vehicleId === 'THIRSTY')!;
  assert.equal(thirsty.anomaly, true);
  assert.ok(thirsty.reasons.includes('low_km_per_liter'));
  assert.equal(thirsty.deviationPct, -50);
  // The healthy buses stay clean.
  assert.equal(report.anomalies, 1);
  assert.equal(report.vehicles.find((v) => v.vehicleId === 'A')!.anomaly, false);
});

test('a bus paying far more per km is flagged even when its km/L is normal', () => {
  const report = scoreFuelEfficiency([
    bus('A', 800, 100, 40),
    bus('B', 800, 100, 40),
    bus('PRICEY', 800, 100, 90),
  ]);
  const pricey = report.vehicles.find((v) => v.vehicleId === 'PRICEY')!;
  assert.equal(pricey.anomaly, true);
  assert.deepEqual(pricey.reasons, ['high_cost_per_km']);
});

test('missing odometer or a single fill is insufficient data, never an anomaly', () => {
  const report = scoreFuelEfficiency([
    bus('A', 800, 100),
    bus('B', 800, 100),
    bus('NO_ODO', null, 100),
    bus('ONE_FILL', 300, 100, 100, 1),
  ]);
  for (const id of ['NO_ODO', 'ONE_FILL']) {
    const v = report.vehicles.find((x) => x.vehicleId === id)!;
    assert.equal(v.anomaly, false);
    assert.deepEqual(v.reasons, ['insufficient_data']);
    assert.equal(v.kmPerLiter, null);
  }
});

test('the flagging threshold is configurable', () => {
  const usage = [bus('A', 800, 100), bus('B', 800, 100), bus('C', 700, 100)];
  assert.equal(scoreFuelEfficiency(usage).anomalies, 0);
  // Tighten to −5% and the 7 km/L bus falls below the 8 km/L median.
  assert.equal(scoreFuelEfficiency(usage, { kmPerLiterFloor: 0.95 }).anomalies, 1);
});
