import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server';
import { signJwt } from '../util/jwt';

const config = {
  port: 0,
  databaseUrl: undefined,
  jwtSecret: 'test-secret',
  qrSecret: 'test-qr',
  env: 'test',
};

function token(perms: string[]): string {
  return signJwt(
    { sub: 'u1', tenant_id: 't1', permissions: perms, exp: Math.floor(Date.now() / 1000) + 600 },
    config.jwtSecret,
  );
}

const REPORTS = [
  'driver-ops',
  'vehicle-ops',
  'trip-duration',
  'inefficient-trips',
  'fuel-efficiency',
  'route-cost',
  'attendance-discipline',
  'plan-adherence',
] as const;

const range = 'from=2026-07-01&to=2026-07-31';

let app: FastifyInstance;
before(async () => {
  app = await buildServer({ config, db: null });
});
after(async () => {
  await app.close();
});

for (const name of REPORTS) {
  test(`${name} report requires authentication (401)`, async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/reports/${name}?${range}` });
    assert.equal(res.statusCode, 401);
  });

  test(`${name} report requires report.operational (403)`, async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/reports/${name}?${range}`,
      headers: { authorization: `Bearer ${token(['trip.read'])}` },
    });
    assert.equal(res.statusCode, 403);
  });

  test(`${name} report requires a date range (422)`, async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/reports/${name}`,
      headers: { authorization: `Bearer ${token(['report.operational'])}` },
    });
    assert.equal(res.statusCode, 422);
  });

  test(`${name} report with a valid range reports db unconfigured (503)`, async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/reports/${name}?${range}`,
      headers: { authorization: `Bearer ${token(['report.operational'])}` },
    });
    assert.equal(res.statusCode, 503);
  });
}

test('inefficient-trips rejects an out-of-range detour threshold (422)', async () => {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/reports/inefficient-trips?${range}&detour_ratio=0.2`,
    headers: { authorization: `Bearer ${token(['report.operational'])}` },
  });
  assert.equal(res.statusCode, 422);
});

test('fuel-efficiency rejects an out-of-range km/L floor (422)', async () => {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/reports/fuel-efficiency?${range}&km_per_liter_floor=5`,
    headers: { authorization: `Bearer ${token(['report.operational'])}` },
  });
  assert.equal(res.statusCode, 422);
});

test('a report limit above the cap is rejected (422)', async () => {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/reports/driver-ops?${range}&limit=5000`,
    headers: { authorization: `Bearer ${token(['report.operational'])}` },
  });
  assert.equal(res.statusCode, 422);
});
