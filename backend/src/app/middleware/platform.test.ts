import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { authenticatePlatform, getPlatform } from './platform';
import { ApiError } from './context';
import { signJwt } from '../../util/jwt';

const SECRET = 'platform-test-secret';
const guard = authenticatePlatform(SECRET);
const reply = {} as FastifyReply;
const req = (authorization?: string): FastifyRequest =>
  ({ headers: authorization ? { authorization } : {} }) as unknown as FastifyRequest;

async function expectApiError(fn: () => Promise<void>, status: number, code: string): Promise<void> {
  await assert.rejects(fn, (e: unknown) => {
    assert.ok(e instanceof ApiError, 'expected an ApiError');
    assert.equal(e.status, status);
    assert.equal(e.code, code);
    return true;
  });
}

test('platform guard accepts a platform token and exposes the admin', async () => {
  const token = signJwt({ sub: 'admin-1', tenant_id: '', platform: true }, SECRET);
  const r = req(`Bearer ${token}`);
  await guard(r, reply);
  assert.equal(getPlatform(r).adminId, 'admin-1');
  assert.equal(getPlatform(r).mfa, false);
});

test('platform guard rejects a normal tenant token (no platform claim)', async () => {
  const token = signJwt({ sub: 'user-1', tenant_id: 't-1', permissions: ['tenant.manage'] }, SECRET);
  await expectApiError(() => guard(req(`Bearer ${token}`), reply), 403, 'FORBIDDEN');
});

test('platform guard rejects platform:false and a missing header', async () => {
  const token = signJwt({ sub: 'user-1', tenant_id: 't-1', platform: false }, SECRET);
  await expectApiError(() => guard(req(`Bearer ${token}`), reply), 403, 'FORBIDDEN');
  await expectApiError(() => guard(req(), reply), 401, 'UNAUTHENTICATED');
});

test('platform guard rejects a token signed with the wrong secret', async () => {
  const token = signJwt({ sub: 'admin-1', tenant_id: '', platform: true }, 'other-secret');
  await expectApiError(() => guard(req(`Bearer ${token}`), reply), 401, 'UNAUTHENTICATED');
});
