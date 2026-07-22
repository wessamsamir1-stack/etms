import assert from 'node:assert/strict';
import { test } from 'node:test';
import { optimizeRoutes, Stop } from './route_optimizer';

const depot = { lat: 29.3759, lng: 47.9774 }; // Kuwait City

test('single vehicle serves all stops when capacity is sufficient', () => {
  const stops: Stop[] = [
    { id: 'a', lat: 29.38, lng: 47.98, demand: 2 },
    { id: 'b', lat: 29.39, lng: 47.99, demand: 3 },
    { id: 'c', lat: 29.4, lng: 48.0, demand: 1 },
  ];
  const routes = optimizeRoutes(stops, depot, { capacity: 10 });
  assert.equal(routes.length, 1);
  assert.equal(routes[0]!.load, 6);
  assert.deepEqual([...routes[0]!.stopIds].sort(), ['a', 'b', 'c']);
  assert.ok(routes[0]!.distanceKm > 0);
});

test('splits into multiple vehicles when demand exceeds capacity', () => {
  const stops: Stop[] = [
    { id: 'a', lat: 29.38, lng: 47.98, demand: 3 },
    { id: 'b', lat: 29.39, lng: 47.99, demand: 3 },
    { id: 'c', lat: 29.4, lng: 48.0, demand: 3 },
  ];
  const routes = optimizeRoutes(stops, depot, { capacity: 4 });
  assert.equal(routes.length, 3); // each stop needs its own vehicle (3+3 > 4)
  for (const r of routes) assert.ok(r.load <= 4);
  const served = routes.flatMap((r) => r.stopIds).sort();
  assert.deepEqual(served, ['a', 'b', 'c']);
});

test('nearest-neighbour visits the closer stop first', () => {
  const stops: Stop[] = [
    { id: 'far', lat: 29.6, lng: 48.2, demand: 1 },
    { id: 'near', lat: 29.38, lng: 47.98, demand: 1 },
  ];
  const routes = optimizeRoutes(stops, depot, { capacity: 10 });
  assert.deepEqual(routes[0]!.stopIds, ['near', 'far']);
});

test('an oversized stop still gets its own vehicle (no infinite loop)', () => {
  const stops: Stop[] = [{ id: 'big', lat: 29.38, lng: 47.98, demand: 50 }];
  const routes = optimizeRoutes(stops, depot, { capacity: 10 });
  assert.equal(routes.length, 1);
  assert.equal(routes[0]!.stopIds[0], 'big');
});

test('rejects non-positive capacity', () => {
  assert.throws(() => optimizeRoutes([], depot, { capacity: 0 }));
});

test('a high-priority residence is served before a nearer low-priority stop', () => {
  // home ~3.3 km from depot (priority 0); residence ~10.5 km (priority 5).
  // effectiveCost(residence) = 10.5/6 ≈ 1.75 < 3.3 = effectiveCost(home) → residence first.
  const stops: Stop[] = [
    { id: 'home', lat: 29.40, lng: 48.0, demand: 1, priority: 0 },
    { id: 'residence', lat: 29.45, lng: 48.05, demand: 1, priority: 5 },
  ];
  const routes = optimizeRoutes(stops, depot, { capacity: 10 });
  assert.equal(routes[0]!.stopIds[0], 'residence'); // weighted priority wins
});

test('priority defaults to 0 → unchanged nearest-neighbour behaviour', () => {
  const stops: Stop[] = [
    { id: 'far', lat: 29.6, lng: 48.2, demand: 1 },
    { id: 'near', lat: 29.38, lng: 47.98, demand: 1 },
  ];
  const routes = optimizeRoutes(stops, depot, { capacity: 10 });
  assert.deepEqual(routes[0]!.stopIds, ['near', 'far']);
});
