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

let app: FastifyInstance;
before(async () => {
  app = await buildServer({ config, db: null });
});
after(async () => {
  await app.close();
});

test('fuel log create requires authentication (401)', async () => {
  const res = await app.inject({ method: 'POST', url: '/v1/fuel-logs', payload: {} });
  assert.equal(res.statusCode, 401);
});

test('fuel log create requires fuel.create (403)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/fuel-logs',
    headers: { authorization: `Bearer ${token(['trip.read'])}` },
    payload: { vehicle_id: '2b6a2f2e-0000-4000-8000-000000000001', liters: 30, cost_amount: 3.5 },
  });
  assert.equal(res.statusCode, 403);
});

test('fuel log create validates the body (422)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/fuel-logs',
    headers: { authorization: `Bearer ${token(['fuel.create'])}` },
    payload: { vehicle_id: 'not-a-uuid', liters: -5, cost_amount: 3.5 },
  });
  assert.equal(res.statusCode, 422);
});

test('fuel log create with valid body reports db unconfigured (503)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/fuel-logs',
    headers: { authorization: `Bearer ${token(['fuel.create'])}` },
    payload: { vehicle_id: '2b6a2f2e-0000-4000-8000-000000000001', liters: 30, cost_amount: 3.5 },
  });
  assert.equal(res.statusCode, 503);
});

test('violations list requires violation.read (403)', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/v1/violations',
    headers: { authorization: `Bearer ${token(['fuel.read'])}` },
  });
  assert.equal(res.statusCode, 403);
});

test('violation status rejects an unknown status (422)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/violations/2b6a2f2e-0000-4000-8000-000000000001/status',
    headers: { authorization: `Bearer ${token(['violation.manage'])}` },
    payload: { status: 'nonsense' },
  });
  assert.equal(res.statusCode, 422);
});

test('fuel report requires report.operational (403)', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/v1/reports/fuel?from=2026-07-01&to=2026-07-31',
    headers: { authorization: `Bearer ${token(['fuel.read'])}` },
  });
  assert.equal(res.statusCode, 403);
});

test('violations report validates the date range (422)', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/v1/reports/violations',
    headers: { authorization: `Bearer ${token(['report.operational'])}` },
  });
  assert.equal(res.statusCode, 422);
});
