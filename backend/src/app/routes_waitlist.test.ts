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

const TRIP = '2b6a2f2e-0000-4000-8000-000000000001';
const EMP = '2b6a2f2e-0000-4000-8000-000000000002';

let app: FastifyInstance;
before(async () => {
  app = await buildServer({ config, db: null });
});
after(async () => {
  await app.close();
});

test('reading a waiting list requires authentication (401)', async () => {
  const res = await app.inject({ method: 'GET', url: `/v1/trips/${TRIP}/waitlist` });
  assert.equal(res.statusCode, 401);
});

test('reading a waiting list requires waitlist.read (403)', async () => {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/trips/${TRIP}/waitlist`,
    headers: { authorization: `Bearer ${token(['trip.read'])}` },
  });
  assert.equal(res.statusCode, 403);
});

test('waitlist.read is not enough to queue someone (403)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/trips/${TRIP}/waitlist`,
    headers: { authorization: `Bearer ${token(['waitlist.read'])}` },
    payload: { employee_id: EMP },
  });
  assert.equal(res.statusCode, 403);
});

test('queueing validates the body (422)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/trips/${TRIP}/waitlist`,
    headers: { authorization: `Bearer ${token(['waitlist.manage'])}` },
    payload: { employee_id: 'not-a-uuid' },
  });
  assert.equal(res.statusCode, 422);
});

test('an unknown waiting-list status filter is rejected (422)', async () => {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/trips/${TRIP}/waitlist?status=nonsense`,
    headers: { authorization: `Bearer ${token(['waitlist.read'])}` },
  });
  assert.equal(res.statusCode, 422);
});

test('a valid queue request reports db unconfigured (503)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/trips/${TRIP}/waitlist`,
    headers: { authorization: `Bearer ${token(['waitlist.manage'])}` },
    payload: { employee_id: EMP },
  });
  assert.equal(res.statusCode, 503);
});

test('promoting the queue requires waitlist.manage (403)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/trips/${TRIP}/waitlist/promote`,
    headers: { authorization: `Bearer ${token(['waitlist.read'])}` },
    payload: {},
  });
  assert.equal(res.statusCode, 403);
});

test('cancelling an entry requires waitlist.manage (403)', async () => {
  const res = await app.inject({
    method: 'DELETE',
    url: `/v1/trips/${TRIP}/waitlist/${EMP}`,
    headers: { authorization: `Bearer ${token(['waitlist.read'])}` },
  });
  assert.equal(res.statusCode, 403);
});

test('adding a passenger still requires manifest.manage (403)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/trips/${TRIP}/passengers`,
    headers: { authorization: `Bearer ${token(['waitlist.manage'])}` },
    payload: { employee_id: EMP },
  });
  assert.equal(res.statusCode, 403);
});

test('the waitlist opt-out flag must be a boolean (422)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/trips/${TRIP}/passengers`,
    headers: { authorization: `Bearer ${token(['manifest.manage'])}` },
    payload: { employee_id: EMP, waitlist: 'yes' },
  });
  assert.equal(res.statusCode, 422);
});
