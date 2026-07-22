import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeTripCost } from './cost_engine';

test('per_km multiplies rate by distance', () => {
  const r = computeTripCost(
    { model: 'per_km', rate: 0.5, currency: 'KWD' },
    { distanceKm: 12 },
  );
  assert.equal(r.amount, 6);
  assert.equal(r.currency, 'KWD');
});

test('per_seat multiplies rate by seats', () => {
  const r = computeTripCost(
    { model: 'per_seat', rate: 1.25, currency: 'KWD' },
    { seats: 8 },
  );
  assert.equal(r.amount, 10);
});

test('per_trip is a flat rate', () => {
  const r = computeTripCost({ model: 'per_trip', rate: 15, currency: 'KWD' }, {});
  assert.equal(r.amount, 15);
});

test('minimum charge is applied', () => {
  const r = computeTripCost(
    { model: 'per_km', rate: 0.5, minCharge: 5, currency: 'KWD' },
    { distanceKm: 4 }, // base 2 < minCharge 5
  );
  assert.equal(r.amount, 5);
});

test('rejects a negative rate', () => {
  assert.throws(() =>
    computeTripCost({ model: 'per_trip', rate: -1, currency: 'KWD' }, {}),
  );
});
