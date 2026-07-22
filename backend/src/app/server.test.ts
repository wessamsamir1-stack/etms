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

function token(perms: string[], mfa = false): string {
  return signJwt(
    { sub: 'u1', tenant_id: 't1', permissions: perms, mfa, exp: Math.floor(Date.now() / 1000) + 600 },
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

test('GET /health is public and reports db unconfigured', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().db, 'unconfigured');
});

test('GET /ready reports readiness (db unconfigured → ready)', async () => {
  const res = await app.inject({ method: 'GET', url: '/ready' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ready, true);
});

test('protected route rejects a request with no token (401)', async () => {
  const res = await app.inject({ method: 'POST', url: '/v1/routes/optimize', payload: {} });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().code, 'UNAUTHENTICATED');
});

test('RBAC rejects a valid token lacking the permission (403)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/routes/optimize',
    headers: { authorization: `Bearer ${token(['trip.read'])}` },
    payload: { depot: { lat: 29.3, lng: 47.9 }, capacity: 10, stops: [{ id: 'a', lat: 29.4, lng: 48, demand: 1 }] },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().code, 'FORBIDDEN');
});

test('optimize returns routes for an authorized caller', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/routes/optimize',
    headers: { authorization: `Bearer ${token(['route.manage'])}` },
    payload: {
      depot: { lat: 29.3, lng: 47.9 },
      capacity: 4,
      stops: [
        { id: 'a', lat: 29.4, lng: 48.0, demand: 3 },
        { id: 'b', lat: 29.41, lng: 48.01, demand: 3 },
      ],
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().vehicles, 2); // 3+3 > capacity 4 → two vehicles
});

test('validation error returns 422', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/routes/optimize',
    headers: { authorization: `Bearer ${token(['route.manage'])}` },
    payload: { depot: { lat: 29.3, lng: 47.9 }, capacity: -1, stops: [] },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().code, 'VALIDATION_ERROR');
});

test('QR check-in token round-trips through the API', async () => {
  const t = token(['trip.operate']);
  const issued = await app.inject({
    method: 'POST',
    url: '/v1/checkin/token',
    headers: { authorization: `Bearer ${t}` },
    payload: { tripId: 'trip1', employeeId: 'emp1', direction: 'in' },
  });
  assert.equal(issued.statusCode, 200);
  const { token: qr } = issued.json();

  const verified = await app.inject({
    method: 'POST',
    url: '/v1/checkin/verify',
    headers: { authorization: `Bearer ${t}` },
    payload: { token: qr },
  });
  assert.equal(verified.statusCode, 200);
  assert.equal(verified.json().tripId, 'trip1');
});

test('ERP export requires MFA step-up (403 without it)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/exports/erp',
    headers: { authorization: `Bearer ${token(['erp.export'])}` }, // no mfa
    payload: {
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      format: 'csv',
      lines: [{ tripId: 't1', costCenter: 'CC1', amount: 10, currency: 'KWD', serviceDate: '2026-07-01' }],
    },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().code, 'MFA_REQUIRED');
});

test('ERP export returns an idempotency key + total (with MFA)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/exports/erp',
    headers: { authorization: `Bearer ${token(['erp.export'], true)}` }, // mfa:true
    payload: {
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      format: 'csv',
      lines: [{ tripId: 't1', costCenter: 'CC1', amount: 10, currency: 'KWD', serviceDate: '2026-07-01' }],
    },
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.json().idempotencyKey, /^erp_/);
  assert.equal(res.json().total, 10);
});
