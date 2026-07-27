import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server';
import { Db } from './db/pool';
import { generateTotp } from '../util/totp';
import { signJwt } from '../util/jwt';
import { hashPassword } from '../util/password';

// Live end-to-end tests — run only when a seeded database is provided:
//   TEST_DATABASE_URL=postgres://appuser:apppass@host:port/etms node --test dist/**/*.test.js
// The harness in the repo README seeds tenant 'acme' with admin@acme.com / Passw0rd!.
const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL not set' };

const config = {
  port: 0,
  databaseUrl: url,
  jwtSecret: 'itest-secret',
  qrSecret: 'itest-qr',
  env: 'test',
};

let app: FastifyInstance;
let db: Db | null = null;

before(async () => {
  if (!url) return;
  db = Db.fromUrl(url);
  app = await buildServer({ config, db });
});
after(async () => {
  await app?.close();
  await db?.close();
});

async function login(email: string, password: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { tenantSlug: 'acme', email, password },
  });
}

test('login mints a JWT with resolved permissions', opts, async () => {
  const res = await login('admin@acme.com', 'Passw0rd!');
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.access_token);
  assert.ok(body.refresh_token);
  assert.ok(body.user.permissions.includes('site.manage'));
});

test('refresh rotates the token; the old one is single-use', opts, async () => {
  const first = (await login('admin@acme.com', 'Passw0rd!')).json();

  const refreshed = await app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    payload: { refreshToken: first.refresh_token },
  });
  assert.equal(refreshed.statusCode, 200);
  const next = refreshed.json();
  assert.ok(next.access_token);
  assert.notEqual(next.refresh_token, first.refresh_token); // rotated

  // The already-used (rotated) refresh token must now be rejected.
  const reuse = await app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    payload: { refreshToken: first.refresh_token },
  });
  assert.equal(reuse.statusCode, 401);
});

test('logout revokes the refresh token', opts, async () => {
  const { refresh_token } = (await login('admin@acme.com', 'Passw0rd!')).json();
  const out = await app.inject({ method: 'POST', url: '/v1/auth/logout', payload: { refreshToken: refresh_token } });
  assert.equal(out.statusCode, 200);
  const after = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: refresh_token } });
  assert.equal(after.statusCode, 401);
});

test('login rejects a wrong password (401)', opts, async () => {
  const res = await login('admin@acme.com', 'wrong');
  assert.equal(res.statusCode, 401);
});

test('CRUD round-trip on sites is tenant-isolated (RLS)', opts, async () => {
  const token = (await login('admin@acme.com', 'Passw0rd!')).json().access_token as string;
  const authH = { authorization: `Bearer ${token}` };

  // LIST — sees Acme's site, never Globex's.
  const list1 = await app.inject({ method: 'GET', url: '/v1/sites', headers: authH });
  assert.equal(list1.statusCode, 200);
  const names1 = (list1.json().data as Array<{ name: string }>).map((s) => s.name);
  assert.ok(names1.includes('Acme HQ'));
  assert.ok(!names1.includes('Globex HQ')); // RLS isolation

  // CREATE
  const created = await app.inject({
    method: 'POST',
    url: '/v1/sites',
    headers: authH,
    payload: { name: 'New Depot', status: 'active' },
  });
  assert.equal(created.statusCode, 201);
  const id = created.json().data.id as string;

  // UPDATE
  const updated = await app.inject({
    method: 'PATCH',
    url: `/v1/sites/${id}`,
    headers: authH,
    payload: { name: 'Renamed Depot' },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().data.name, 'Renamed Depot');

  // DELETE (soft) → gone from the list
  const del = await app.inject({ method: 'DELETE', url: `/v1/sites/${id}`, headers: authH });
  assert.equal(del.statusCode, 204);
  const list2 = await app.inject({ method: 'GET', url: '/v1/sites', headers: authH });
  const ids2 = (list2.json().data as Array<{ id: string }>).map((s) => s.id);
  assert.ok(!ids2.includes(id));
});

test('MFA step-up: enroll → confirm → challenge unlocks the ERP export', opts, async () => {
  const token = (await login('admin@acme.com', 'Passw0rd!')).json().access_token as string;
  const H = { authorization: `Bearer ${token}` };
  const post = (url: string, payload: Record<string, unknown>, hdr = H) =>
    app.inject({ method: 'POST', url, headers: hdr, payload });

  const erpBody = {
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    format: 'csv',
    lines: [{ tripId: 't1', costCenter: 'CC1', amount: 10, currency: 'KWD', serviceDate: '2026-07-01' }],
  };

  // Without MFA the sensitive export is blocked.
  const blocked = await post('/v1/exports/erp', erpBody);
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.json().code, 'MFA_REQUIRED');

  // Enroll TOTP, then confirm with a freshly computed code.
  const secret = (await post('/v1/auth/mfa/enroll', {})).json().secret as string;
  const nowSec = Math.floor(Date.now() / 1000);
  assert.equal((await post('/v1/auth/mfa/verify', { code: generateTotp(secret, nowSec) })).json().enabled, true);

  // Step-up → token with mfa:true → export now succeeds.
  const stepUp = await post('/v1/auth/mfa/challenge', { code: generateTotp(secret, Math.floor(Date.now() / 1000)) });
  assert.equal(stepUp.statusCode, 200);
  const mfaToken = stepUp.json().access_token as string;

  const ok = await post('/v1/exports/erp', erpBody, { authorization: `Bearer ${mfaToken}` });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.json().idempotencyKey, /^erp_/);
});

test('eligibility: residence member → green; a transport block → red', opts, async () => {
  const auth = (await login('admin@acme.com', 'Passw0rd!')).json();
  const token = auth.access_token as string;
  const H = { authorization: `Bearer ${token}` };
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, headers: H, payload });

  // A residence member with a valid employee number → clean GREEN.
  const resId = (await post('/v1/residences', { name: 'Camp A', priority_weight: 5 })).json().data.id;
  const empId = (await post('/v1/employees', { full_name: 'Ali', external_hr_id: 'E123', eligible: true, residence_id: resId })).json().data.id;

  const green = await post('/v1/eligibility/evaluate', { employeeId: empId });
  assert.equal(green.statusCode, 200);
  assert.equal(green.json().band, 'green');
  assert.equal(green.json().outcome, 'approved');

  // Inject an active transport block from "HR" → hard-gate RED.
  await db!.withTenant(auth.user.tenantId, auth.user.id, (c) =>
    c.query(
      `INSERT INTO hr_violation(tenant_id, employee_id, external_ref, type, severity, status)
       VALUES ($1,$2,$3,'transport_block','blocking','active')`,
      [auth.user.tenantId, empId, `blk-${empId}`],
    ),
  );

  const red = await post('/v1/eligibility/evaluate', { employeeId: empId });
  assert.equal(red.json().band, 'red');
  assert.equal(red.json().outcome, 'rejected');
  assert.ok((red.json().reasons as string[]).includes('hard_gate_failed:no_transport_block'));
});

test('HR sync applies a transport block idempotently and clears it', opts, async () => {
  const token = (await login('admin@acme.com', 'Passw0rd!')).json().access_token as string;
  const H = { authorization: `Bearer ${token}` };
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, headers: H, payload });

  const resId = (await post('/v1/residences', { name: 'Camp Sync' })).json().data.id;
  const empId = (await post('/v1/employees', { full_name: 'Omar', external_hr_id: 'SF-900', eligible: true, residence_id: resId })).json().data.id;

  // Clean baseline → green.
  assert.equal((await post('/v1/eligibility/evaluate', { employeeId: empId })).json().band, 'green');

  // HR sync sets a transport block → engine turns RED.
  const s1 = await post('/v1/hr/violations/sync', {
    records: [{ externalRef: 'SF-900', transportBlock: true, employmentEnded: false }],
  });
  assert.equal(s1.statusCode, 200);
  assert.equal(s1.json().matched, 1);
  assert.equal((await post('/v1/eligibility/evaluate', { employeeId: empId })).json().band, 'red');

  // Re-syncing the same block is idempotent (no duplicate rows, still red).
  await post('/v1/hr/violations/sync', {
    records: [{ externalRef: 'SF-900', transportBlock: true, employmentEnded: false }],
  });
  assert.equal((await post('/v1/eligibility/evaluate', { employeeId: empId })).json().band, 'red');

  // Clearing the block in HR → engine returns to GREEN.
  await post('/v1/hr/violations/sync', {
    records: [{ externalRef: 'SF-900', transportBlock: false, employmentEnded: false }],
  });
  assert.equal((await post('/v1/eligibility/evaluate', { employeeId: empId })).json().band, 'green');
});

test('decisions: shadow recommends + queue + override; live auto-approves; block rejects', opts, async () => {
  const auth = (await login('admin@acme.com', 'Passw0rd!')).json();
  const H = { authorization: `Bearer ${auth.access_token}` };
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, headers: H, payload });
  const tenantId = auth.user.tenantId as string;
  const userId = auth.user.id as string;

  const resId = (await post('/v1/residences', { name: 'Camp Dec' })).json().data.id;
  const green = (await post('/v1/employees', { full_name: 'Dec1', external_hr_id: 'DEC-1', eligible: true, residence_id: resId })).json().data.id;

  // Default policy = shadow → a GREEN case is recorded as needs_review (not auto).
  const d1 = await post('/v1/eligibility/decisions', { employeeId: green });
  assert.equal(d1.json().band, 'green');
  assert.equal(d1.json().outcome, 'needs_review');
  assert.equal(d1.json().autoApproved, false);
  const decisionId = d1.json().id as string;

  // It appears in the review queue.
  const queue = await app.inject({ method: 'GET', url: '/v1/eligibility/queue', headers: H });
  assert.ok((queue.json().data as Array<{ id: string }>).some((x) => x.id === decisionId));

  // A human overrides it to approved.
  const ov = await post(`/v1/eligibility/decisions/${decisionId}/override`, { outcome: 'approved' });
  assert.equal(ov.json().data.outcome, 'approved');
  assert.equal(ov.json().data.decision_source, 'human');

  // Flip the tenant policy to live, then a GREEN case auto-approves.
  await db!.withTenant(tenantId, userId, (c) =>
    c.query(
      `INSERT INTO eligibility_policy(tenant_id, auto_approve_mode) VALUES ($1,'live')
       ON CONFLICT (tenant_id) DO UPDATE SET auto_approve_mode='live'`,
      [tenantId],
    ),
  );
  const d2 = await post('/v1/eligibility/decisions', { employeeId: green });
  assert.equal(d2.json().outcome, 'approved');
  assert.equal(d2.json().autoApproved, true);

  // A blocked employee is rejected regardless of mode.
  const blocked = (await post('/v1/employees', { full_name: 'Dec2', external_hr_id: 'DEC-2', eligible: true, residence_id: resId })).json().data.id;
  await post('/v1/hr/violations/sync', { records: [{ externalRef: 'DEC-2', transportBlock: true, employmentEnded: false }] });
  const d3 = await post('/v1/eligibility/decisions', { employeeId: blocked });
  assert.equal(d3.json().band, 'red');
  assert.equal(d3.json().outcome, 'rejected');
});

test('account security: per-account lockout after repeated failures + strong-password change', opts, async () => {
  // A dedicated account so lockout doesn't interfere with other tests' logins.
  const auth = (await login('admin@acme.com', 'Passw0rd!')).json();
  await db!.withTenant(auth.user.tenantId, auth.user.id, (c) =>
    c.query(
      `INSERT INTO app_user(tenant_id, email, full_name, status, password_hash)
       VALUES ($1,'sec@acme.com','Sec User','active',$2)`,
      [auth.user.tenantId, hashPassword('S3curePass1')],
    ),
  );
  const tryLogin = (password: string) =>
    app.inject({ method: 'POST', url: '/v1/auth/login', payload: { tenantSlug: 'acme', email: 'sec@acme.com', password } });

  // 5 wrong attempts → the 5th trips the lock.
  for (let i = 0; i < 5; i++) assert.equal((await tryLogin('nope')).statusCode, 401);

  // Now even the CORRECT password is refused while locked (per-account, not per-IP).
  const locked = await tryLogin('S3curePass1');
  assert.equal(locked.statusCode, 429);
  assert.equal(locked.json().code, 'ACCOUNT_LOCKED');

  // Simulate the cool-down elapsing (clears the throttle) → login works again.
  await db!.query('SELECT auth_login_success($1,$2)', ['acme', 'sec@acme.com']);
  const ok = await tryLogin('S3curePass1');
  assert.equal(ok.statusCode, 200);
  const token = ok.json().access_token as string;
  const H = { authorization: `Bearer ${token}` };

  // Change password: weak → 422, wrong current → 401, valid → 200.
  const weak = await app.inject({ method: 'POST', url: '/v1/auth/password', headers: H, payload: { currentPassword: 'S3curePass1', newPassword: 'weak' } });
  assert.equal(weak.statusCode, 422);
  const wrong = await app.inject({ method: 'POST', url: '/v1/auth/password', headers: H, payload: { currentPassword: 'WRONG', newPassword: 'N3wStrongPass!' } });
  assert.equal(wrong.statusCode, 401);
  const changed = await app.inject({ method: 'POST', url: '/v1/auth/password', headers: H, payload: { currentPassword: 'S3curePass1', newPassword: 'N3wStrongPass!' } });
  assert.equal(changed.statusCode, 200);

  // New password works; the old one no longer does.
  assert.equal((await tryLogin('N3wStrongPass!')).statusCode, 200);
  assert.equal((await tryLogin('S3curePass1')).statusCode, 401);
});

test('roles: catalog + grant/revoke permissions (MFA-gated)', opts, async () => {
  const auth = (await login('admin@acme.com', 'Passw0rd!')).json();
  const token = auth.access_token as string;
  const H = { authorization: `Bearer ${token}` };
  const post = (url: string, payload: Record<string, unknown>, hdr = H) =>
    app.inject({ method: 'POST', url, headers: hdr, payload });

  // Permission catalog is readable.
  const cat = await app.inject({ method: 'GET', url: '/v1/permissions', headers: H });
  assert.equal(cat.statusCode, 200);
  const perm = (cat.json().data as Array<{ id: string; code: string }>).find((x) => x.code === 'trip.read')!;
  assert.ok(perm);

  // Create a tenant role via the generic CRUD.
  const roleId = (await post('/v1/roles', { code: 'ops2', name: 'Ops Two' })).json().data.id as string;

  // Granting requires MFA → without it, 403.
  const noMfa = await post(`/v1/roles/${roleId}/permissions`, { permissionId: perm.id });
  assert.equal(noMfa.statusCode, 403);
  assert.equal(noMfa.json().code, 'MFA_REQUIRED');

  // Step up (enroll + challenge), then grant + verify + revoke.
  const secret = (await post('/v1/auth/mfa/enroll', {})).json().secret as string;
  await post('/v1/auth/mfa/verify', { code: generateTotp(secret, Math.floor(Date.now() / 1000)) });
  const stepUp = (await post('/v1/auth/mfa/challenge', { code: generateTotp(secret, Math.floor(Date.now() / 1000)) })).json().access_token as string;
  const MH = { authorization: `Bearer ${stepUp}` };

  const grant = await post(`/v1/roles/${roleId}/permissions`, { permissionId: perm.id }, MH);
  assert.equal(grant.statusCode, 201);
  const after = await app.inject({ method: 'GET', url: `/v1/roles/${roleId}/permissions`, headers: H });
  assert.ok((after.json().data as string[]).includes(perm.id));

  const revoke = await app.inject({ method: 'DELETE', url: `/v1/roles/${roleId}/permissions/${perm.id}`, headers: MH });
  assert.equal(revoke.statusCode, 204);
});

test('RBAC: creating without the token is rejected (401)', opts, async () => {
  const res = await app.inject({ method: 'POST', url: '/v1/sites', payload: { name: 'x' } });
  assert.equal(res.statusCode, 401);
});

test('the generic CRUD factory works for another resource (vendors)', opts, async () => {
  const token = (await login('admin@acme.com', 'Passw0rd!')).json().access_token as string;
  const authH = { authorization: `Bearer ${token}` };

  const created = await app.inject({
    method: 'POST',
    url: '/v1/vendors',
    headers: authH,
    payload: { name: 'FleetCo', status: 'active' },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().data.name, 'FleetCo');

  const list = await app.inject({ method: 'GET', url: '/v1/vendors', headers: authH });
  assert.equal(list.statusCode, 200);
  assert.ok((list.json().data as Array<{ name: string }>).some((v) => v.name === 'FleetCo'));
});

test('dispatch + lifecycle: verify driver → assign → start → complete', opts, async () => {
  const token = (await login('admin@acme.com', 'Passw0rd!')).json().access_token as string;
  const H = { authorization: `Bearer ${token}` };
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, headers: H, payload });

  // Fleet: a pending driver + a small and a big vehicle.
  const drvId = (await post('/v1/drivers', { full_name: 'Khaled', verification_status: 'pending', availability: 'available' })).json().data.id;
  const smallVeh = (await post('/v1/vehicles', { plate_no: 'SMALL-1', capacity: 4, status: 'active' })).json().data.id;
  const bigVeh = (await post('/v1/vehicles', { plate_no: 'BIG-1', capacity: 20, status: 'active' })).json().data.id;

  // A trip with 5 booked seats (capacity left null so seats_taken=5 is allowed).
  const tripId = (await post('/v1/trips', { service_date: '2026-07-20', direction: 'inbound', seats_taken: 5 })).json().data.id;

  // Assign is blocked while the driver is unverified.
  const unverified = await post(`/v1/trips/${tripId}/assign`, { vehicleId: bigVeh, driverId: drvId });
  assert.equal(unverified.statusCode, 422);

  // Verify the driver (sensitive action).
  const verified = await post(`/v1/drivers/${drvId}/verify`, { status: 'verified' });
  assert.equal(verified.statusCode, 200);
  assert.equal(verified.json().data.verification_status, 'verified');

  // Vehicle too small for the booked seats → 422.
  const tooSmall = await post(`/v1/trips/${tripId}/assign`, { vehicleId: smallVeh, driverId: drvId });
  assert.equal(tooSmall.statusCode, 422);

  // Valid assignment → trip becomes assigned.
  const assigned = await post(`/v1/trips/${tripId}/assign`, { vehicleId: bigVeh, driverId: drvId });
  assert.equal(assigned.statusCode, 200);

  // Lifecycle: start → complete. Completing before start is a 409.
  assert.equal((await post(`/v1/trips/${tripId}/complete`, {})).statusCode, 409);
  assert.equal((await post(`/v1/trips/${tripId}/start`, {})).statusCode, 200);
  const done = await post(`/v1/trips/${tripId}/complete`, {});
  assert.equal(done.statusCode, 200);
  assert.equal(done.json().data.status, 'completed');
});

test("driver trips: scoped to the caller's own driver record and service date", opts, async () => {
  const session = (await login('admin@acme.com', 'Passw0rd!')).json();
  const H = { authorization: `Bearer ${session.access_token}` };
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, headers: H, payload });
  const get = (url: string) => app.inject({ method: 'GET', url, headers: H });

  // Detach any driver record an earlier run linked to this user, so the
  // "caller is not a driver" assertion below is deterministic.
  const linked = (await get('/v1/drivers')).json().data as Array<{
    id: string;
    user_id: string | null;
  }>;
  for (const d of linked.filter((d) => d.user_id === session.user.id)) {
    await app.inject({ method: 'DELETE', url: `/v1/drivers/${d.id}`, headers: H });
  }

  // A caller with no driver record gets an empty list, not an error — this feeds
  // the home screen every role lands on.
  const notADriver = await get('/v1/driver/trips?date=2026-07-21');
  assert.equal(notADriver.statusCode, 200);
  assert.deepEqual(notADriver.json().data, []);

  const me = (
    await post('/v1/drivers', {
      full_name: 'Me',
      user_id: session.user.id,
      verification_status: 'verified',
      availability: 'available',
    })
  ).json().data.id;
  // A second record for the same user: `driver.user_id` has no unique
  // constraint, and trips under either record are the caller's.
  const meAlso = (
    await post('/v1/drivers', {
      full_name: 'Me (vendor record)',
      user_id: session.user.id,
      verification_status: 'verified',
      availability: 'available',
    })
  ).json().data.id;
  const other = (
    await post('/v1/drivers', {
      full_name: 'Someone else',
      verification_status: 'verified',
      availability: 'available',
    })
  ).json().data.id;
  const vehA = (await post('/v1/vehicles', { plate_no: 'DRV-A', capacity: 10, status: 'active' })).json().data.id;
  const vehB = (await post('/v1/vehicles', { plate_no: 'DRV-B', capacity: 10, status: 'active' })).json().data.id;

  const mine = (await post('/v1/trips', { service_date: '2026-07-21', direction: 'inbound' })).json().data.id;
  const mineToo = (await post('/v1/trips', { service_date: '2026-07-21', direction: 'outbound' })).json().data.id;
  const theirs = (await post('/v1/trips', { service_date: '2026-07-21', direction: 'inbound' })).json().data.id;
  const nextDay = (await post('/v1/trips', { service_date: '2026-07-22', direction: 'inbound' })).json().data.id;

  assert.equal((await post(`/v1/trips/${mine}/assign`, { vehicleId: vehA, driverId: me })).statusCode, 200);
  assert.equal((await post(`/v1/trips/${mineToo}/assign`, { vehicleId: vehA, driverId: meAlso })).statusCode, 200);
  assert.equal((await post(`/v1/trips/${theirs}/assign`, { vehicleId: vehB, driverId: other })).statusCode, 200);
  assert.equal((await post(`/v1/trips/${nextDay}/assign`, { vehicleId: vehA, driverId: me })).statusCode, 200);

  // Both of my trips, neither the other driver's nor the next day's.
  const res = await get('/v1/driver/trips?date=2026-07-21');
  assert.equal(res.statusCode, 200);
  const data = res.json().data as Array<{ id: string; service_date: string; status: string }>;
  assert.deepEqual([...data.map((t) => t.id)].sort(), [mine, mineToo].sort());
  assert.equal(data[0]?.service_date, '2026-07-21');
  assert.equal(data[0]?.status, 'assigned');

  // An unparseable date is rejected rather than silently treated as today.
  assert.equal((await get('/v1/driver/trips?date=21-07-2026')).statusCode, 422);

  assert.equal((await get('/v1/driver/trips?date=today')).statusCode, 200);
});

test('a token naming an unknown tenant is rejected the same way on every route', opts, async () => {
  const session = (await login('admin@acme.com', 'Passw0rd!')).json();
  // Well-formed and correctly signed, but the tenant is not visible under RLS —
  // a bad credential, not a caller who happens to have no data. Db.withTenant
  // rejects it centrally, so routes cannot drift apart on this.
  const stray = signJwt(
    {
      sub: session.user.id,
      tenant_id: '00000000-0000-4000-8000-00000000dead',
      permissions: ['trip.read', 'tenant.read', 'site.read', 'vehicle.read'],
      exp: Math.floor(Date.now() / 1000) + 600,
    },
    config.jwtSecret,
  );
  const H = { authorization: `Bearer ${stray}` };

  for (const url of ['/v1/driver/trips?date=today', '/v1/branding', '/v1/sites', '/v1/vehicles']) {
    const res = await app.inject({ method: 'GET', url, headers: H });
    assert.equal(res.statusCode, 401, `${url} should be 401, got ${res.statusCode}`);
    assert.equal(res.json().code, 'UNAUTHENTICATED', `${url} code`);
  }
});

test('tracking: GPS ping updates last position; SOS incident lifecycle', opts, async () => {
  const token = (await login('admin@acme.com', 'Passw0rd!')).json().access_token as string;
  const H = { authorization: `Bearer ${token}` };
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, headers: H, payload });

  const vehId = (await post('/v1/vehicles', { plate_no: 'TRACK-1', capacity: 10, status: 'active' })).json().data.id;

  // Ingest a GPS ping.
  const ping = await post('/v1/tracking/pings', {
    pings: [{ vehicleId: vehId, lat: 29.376, lng: 47.977, speed: 42, heading: 180, recordedAt: new Date().toISOString() }],
  });
  assert.equal(ping.statusCode, 202);

  // Last position reflects it (lat/lng round-trip through PostGIS).
  const fleet = await app.inject({ method: 'GET', url: '/v1/tracking/vehicles', headers: H });
  const pos = (fleet.json().data as Array<{ vehicle_id: string; lat: number; lng: number }>).find((v) => v.vehicle_id === vehId);
  assert.ok(pos);
  assert.ok(Math.abs(pos!.lat - 29.376) < 1e-4);
  assert.ok(Math.abs(pos!.lng - 47.977) < 1e-4);

  // Raise an SOS, list it, resolve it.
  const inc = await post('/v1/incidents', { type: 'sos', severity: 'critical', lat: 29.376, lng: 47.977 });
  assert.equal(inc.statusCode, 201);
  const incId = inc.json().data.id as string;

  const open = await app.inject({ method: 'GET', url: '/v1/incidents?status=open', headers: H });
  assert.ok((open.json().data as Array<{ id: string }>).some((i) => i.id === incId));

  const resolved = await post(`/v1/incidents/${incId}/resolve`, {});
  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.json().data.status, 'resolved');
});

test('notifications: DB template → render → dispatch → status sent', opts, async () => {
  const token = (await login('admin@acme.com', 'Passw0rd!')).json().access_token as string;
  const H = { authorization: `Bearer ${token}` };
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, headers: H, payload });

  // Author a template (CRUD), then send using it.
  const tpl = await post('/v1/notification-templates', {
    code: 'booking_confirmed',
    channel: 'email',
    locale: 'en',
    subject: 'Your seat',
    body: 'Hi {{name}}, your seat on {{date}} is confirmed.',
    active: true,
  });
  assert.equal(tpl.statusCode, 201);

  const sent = await post('/v1/notifications/send', {
    channel: 'email',
    templateCode: 'booking_confirmed',
    locale: 'en',
    to: 'sara@acme.com',
    vars: { name: 'Sara', date: '2026-08-01' },
  });
  assert.equal(sent.statusCode, 200);
  assert.equal(sent.json().status, 'sent'); // rendered + dispatched + persisted

  // Sending with an unknown template → 422.
  const bad = await post('/v1/notifications/send', {
    channel: 'email',
    templateCode: 'nope',
    locale: 'en',
    to: 'x@y.com',
    vars: {},
  });
  assert.equal(bad.statusCode, 422);

  const list = await app.inject({ method: 'GET', url: '/v1/notifications?status=sent', headers: H });
  assert.ok((list.json().data as Array<{ template_code: string }>).some((n) => n.template_code === 'booking_confirmed'));
});

test('a check-constraint violation surfaces as 422 (bad route direction)', opts, async () => {
  const token = (await login('admin@acme.com', 'Passw0rd!')).json().access_token as string;
  const site = await app.inject({
    method: 'POST',
    url: '/v1/sites',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'RouteSite' },
  });
  const siteId = site.json().data.id as string;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/routes',
    headers: { authorization: `Bearer ${token}` },
    payload: { site_id: siteId, name: 'R1', direction: 'sideways' }, // invalid enum
  });
  assert.equal(res.statusCode, 422);
});

test('waitlist: a full bus queues the next employee and promotes them when a seat frees', opts, async () => {
  const session = (await login('admin@acme.com', 'Passw0rd!')).json();
  const H = { authorization: `Bearer ${session.access_token}` };
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, headers: H, payload });
  const get = (url: string) => app.inject({ method: 'GET', url, headers: H });

  // A two-seat bus with a verified driver on today's trip.
  const drv = (await post('/v1/drivers', { full_name: 'WL Driver', verification_status: 'verified', availability: 'available' })).json().data.id;
  const veh = (await post('/v1/vehicles', { plate_no: 'WL-2', capacity: 2, status: 'active' })).json().data.id;
  const trip = (await post('/v1/trips', { service_date: '2026-07-22', direction: 'inbound' })).json().data.id;
  assert.equal((await post(`/v1/trips/${trip}/assign`, { vehicleId: veh, driverId: drv })).statusCode, 200);

  const emp = async (name: string): Promise<string> =>
    (await post('/v1/employees', { full_name: name, external_hr_id: `WL-${name}`, eligible: true })).json().data.id;
  const [e1, e2, e3, e4] = [await emp('WL One'), await emp('WL Two'), await emp('WL Three'), await emp('WL Four')];

  // The two seats fill normally.
  const first = await post(`/v1/trips/${trip}/passengers`, { employee_id: e1 });
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().seats.remaining, 1);
  assert.equal((await post(`/v1/trips/${trip}/passengers`, { employee_id: e2 })).statusCode, 201);

  // The bus is full → the third employee is queued, not rejected.
  const queued = await post(`/v1/trips/${trip}/passengers`, { employee_id: e3 });
  assert.equal(queued.statusCode, 202);
  assert.equal(queued.json().waitlisted, true);
  assert.equal(queued.json().position, 1);

  // Opting out of the queue gives the plain "full" conflict instead.
  const refused = await post(`/v1/trips/${trip}/passengers`, { employee_id: e4, waitlist: false });
  assert.equal(refused.statusCode, 409);

  // The manifest read carries the seat accounting the driver screen needs.
  const manifest = (await get(`/v1/trips/${trip}/manifest`)).json().data;
  assert.equal(manifest.capacity, 2);
  assert.equal(manifest.occupied, 2);
  assert.equal(manifest.remaining_seats, 0);
  assert.equal(manifest.waiting, 1);

  const list = (await get(`/v1/trips/${trip}/waitlist`)).json();
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].employee_id, e3);
  assert.equal(list.data[0].status, 'waiting');
  assert.equal(list.seats.remaining, 0);

  // Excusing a passenger frees a seat → the head of the queue is promoted.
  const pax1 = (manifest.passengers as Array<{ id: string; employee_id: string }>).find((x) => x.employee_id === e1)!;
  const excused = await post(`/v1/trips/${trip}/passengers/${pax1.id}/status`, { status: 'excused' });
  assert.equal(excused.statusCode, 200);
  assert.equal(excused.json().promotedFromWaitlist.length, 1);
  assert.equal(excused.json().promotedFromWaitlist[0].employeeId, e3);

  const after = (await get(`/v1/trips/${trip}/manifest`)).json().data;
  assert.equal(after.occupied, 2);
  assert.equal(after.remaining_seats, 0);
  assert.equal(after.waiting, 0);
  assert.ok((after.passengers as Array<{ employee_id: string; status: string }>)
    .some((x) => x.employee_id === e3 && x.status === 'expected'));

  const promotedList = (await get(`/v1/trips/${trip}/waitlist?status=promoted`)).json().data;
  assert.equal(promotedList.length, 1);
  assert.equal(promotedList[0].employee_id, e3);
});

test('waitlist: an uncapped trip promotes immediately; a cancelled entry never does', opts, async () => {
  const session = (await login('admin@acme.com', 'Passw0rd!')).json();
  const H = { authorization: `Bearer ${session.access_token}` };
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, headers: H, payload });

  // No capacity override and no assigned vehicle → the trip is uncapped.
  const trip = (await post('/v1/trips', { service_date: '2026-07-23', direction: 'outbound' })).json().data.id;
  const e1 = (await post('/v1/employees', { full_name: 'WL Five', external_hr_id: 'WL-5', eligible: true })).json().data.id;
  const e2 = (await post('/v1/employees', { full_name: 'WL Six', external_hr_id: 'WL-6', eligible: true })).json().data.id;

  const queued = await post(`/v1/trips/${trip}/waitlist`, { employee_id: e1 });
  assert.equal(queued.statusCode, 201); // a seat was free, so it promoted at once
  assert.equal(queued.json().promoted.length, 1);

  // Queue someone on a capped, full trip and then cancel their entry.
  const veh = (await post('/v1/vehicles', { plate_no: 'WL-1', capacity: 1, status: 'active' })).json().data.id;
  const drv = (await post('/v1/drivers', { full_name: 'WL Driver 2', verification_status: 'verified', availability: 'available' })).json().data.id;
  const capped = (await post('/v1/trips', { service_date: '2026-07-23', direction: 'inbound' })).json().data.id;
  await post(`/v1/trips/${capped}/assign`, { vehicleId: veh, driverId: drv });
  await post(`/v1/trips/${capped}/passengers`, { employee_id: e1 });

  const wl = await post(`/v1/trips/${capped}/waitlist`, { employee_id: e2 });
  assert.equal(wl.statusCode, 202);
  const entryId = wl.json().data.id as string;

  const cancelled = await app.inject({ method: 'DELETE', url: `/v1/trips/${capped}/waitlist/${entryId}`, headers: H });
  assert.equal(cancelled.statusCode, 200);
  assert.equal(cancelled.json().data.status, 'cancelled');

  // Freeing the seat now promotes nobody — the queue is empty.
  const manifest = (await app.inject({ method: 'GET', url: `/v1/trips/${capped}/manifest`, headers: H })).json().data;
  const pax = (manifest.passengers as Array<{ id: string }>)[0]!;
  const removed = await post(`/v1/trips/${capped}/passengers/${pax.id}/status`, { status: 'removed' });
  assert.equal(removed.json().promotedFromWaitlist.length, 0);

  // Cancelling twice is a conflict, not a silent success.
  const again = await app.inject({ method: 'DELETE', url: `/v1/trips/${capped}/waitlist/${entryId}`, headers: H });
  assert.equal(again.statusCode, 409);
});

test('ride requests: matchMyRoute keeps only the pickups inside the driver plan zones', opts, async () => {
  const session = (await login('admin@acme.com', 'Passw0rd!')).json();
  const H = { authorization: `Bearer ${session.access_token}` };
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, headers: H, payload });

  const siteId = (await post('/v1/sites', { name: 'Zone Site' })).json().data.id as string;
  // Two square zones ~1° apart: Salmiya around (29.33,48.07), Jahra around (29.33,47.65).
  const zones = await db!.withTenant(session.user.tenantId, session.user.id, (c) =>
    c.query(
      `INSERT INTO zone(tenant_id, site_id, name, boundary)
       VALUES (app_current_tenant(),$1,'Salmiya',
               ST_SetSRID(ST_MakeEnvelope(48.05, 29.31, 48.09, 29.35),4326)::geography),
              (app_current_tenant(),$1,'Jahra',
               ST_SetSRID(ST_MakeEnvelope(47.63, 29.31, 47.67, 29.35),4326)::geography)
       RETURNING id, name`,
      [siteId],
    ),
  );
  const salmiya = zones.rows.find((z) => z.name === 'Salmiya')!.id as string;

  // A driver who is logged in as this user and plans to cover Salmiya only.
  // Detach any driver an earlier test linked to this account, so "the caller's
  // driver record" resolves to exactly the one created here.
  await db!.withTenant(session.user.tenantId, session.user.id, (c) =>
    c.query('UPDATE driver SET user_id=NULL WHERE user_id=$1', [session.user.id]),
  );
  const drvId = (await post('/v1/drivers', {
    full_name: 'Zone Driver', user_id: session.user.id,
    verification_status: 'verified', availability: 'available',
  })).json().data.id as string;
  const plan = await post('/v1/driver-plans', {
    service_date: '2026-07-24', window_start: '06:00', window_end: '10:00', zone_ids: [salmiya],
  });
  assert.equal(plan.statusCode, 201);
  assert.equal((await post(`/v1/driver-plans/${plan.json().data.id}/approve`, {})).statusCode, 200);

  // Two riders: one inside Salmiya, one out in Jahra. Both broadcast.
  const rider = async (name: string, lat: number, lng: number): Promise<void> => {
    const created = await post('/v1/employees', { full_name: name, external_hr_id: `ZM-${name}`, eligible: true });
    assert.equal(created.statusCode, 201, created.body);
    const empId = created.json().data.id;
    await db!.withTenant(session.user.tenantId, session.user.id, (c) =>
      c.query('UPDATE employee SET user_id=NULL WHERE id=$1', [empId]),
    );
    await db!.withTenant(session.user.tenantId, session.user.id, (c) =>
      c.query(
        `INSERT INTO ride_request(tenant_id, employee_id, direction, service_date, pickup_mode,
                                  pickup_label, pickup_location)
         VALUES (app_current_tenant(),$1,'inbound','2026-07-24','per_request',$2,
                 ST_SetSRID(ST_MakePoint($4,$3),4326)::geography)
         RETURNING id`,
        [empId, name, lat, lng],
      ),
    );
  };
  await rider('OnRoute', 29.33, 48.07);
  await rider('OffRoute', 29.33, 47.65);
  // Offer both to this driver.
  await db!.withTenant(session.user.tenantId, session.user.id, (c) =>
    c.query(
      `INSERT INTO ride_request_offer(tenant_id, request_id, driver_id)
       SELECT app_current_tenant(), rr.id, $1 FROM ride_request rr
       WHERE rr.service_date='2026-07-24' AND rr.status='open'
       ON CONFLICT DO NOTHING`,
      [drvId],
    ),
  );

  const all = (await app.inject({
    method: 'GET', url: '/v1/ride-requests?mine=driver&date=2026-07-24', headers: H,
  })).json().data as Array<{ employee_name: string; matches_route: boolean | null }>;
  const byName = new Map(all.map((r) => [r.employee_name, r.matches_route]));
  assert.equal(byName.get('OnRoute'), true);
  assert.equal(byName.get('OffRoute'), false);

  const matched = (await app.inject({
    method: 'GET', url: '/v1/ride-requests?mine=driver&date=2026-07-24&matchMyRoute=true', headers: H,
  })).json().data as Array<{ employee_name: string }>;
  assert.deepEqual(matched.map((r) => r.employee_name), ['OnRoute']);
});

test('the operational report pack answers over a live database', opts, async () => {
  const token = (await login('admin@acme.com', 'Passw0rd!')).json().access_token as string;
  const H = { authorization: `Bearer ${token}` };
  const range = 'from=2026-07-01&to=2026-07-31';
  const names = [
    'driver-ops', 'vehicle-ops', 'trip-duration', 'inefficient-trips',
    'fuel-efficiency', 'route-cost', 'attendance-discipline', 'plan-adherence',
  ];
  for (const name of names) {
    const res = await app.inject({ method: 'GET', url: `/v1/reports/${name}?${range}`, headers: H });
    assert.equal(res.statusCode, 200, `${name} → ${res.statusCode} ${res.body}`);
    assert.deepEqual(res.json().data.range, { from: '2026-07-01', to: '2026-07-31' });
  }
});

test('fuel-efficiency flags the bus that burns far more than the fleet', opts, async () => {
  const session = (await login('admin@acme.com', 'Passw0rd!')).json();
  const H = { authorization: `Bearer ${session.access_token}` };
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, headers: H, payload });

  // Three buses fill twice each: two run 8 km/L, the third only 4.
  const fills: Array<[string, number, number, number]> = [
    ['FE-A', 10000, 10800, 100], ['FE-B', 20000, 20800, 100], ['FE-C', 30000, 30400, 100],
  ];
  for (const [plate, odoStart, odoEnd, liters] of fills) {
    const veh = (await post('/v1/vehicles', { plate_no: plate, capacity: 20, status: 'active' })).json().data.id;
    await post('/v1/fuel-logs', { vehicle_id: veh, liters: 1, cost_amount: 0.3, odometer_km: odoStart, filled_at: '2026-07-05T06:00:00Z' });
    await post('/v1/fuel-logs', { vehicle_id: veh, liters, cost_amount: 30, odometer_km: odoEnd, filled_at: '2026-07-20T06:00:00Z' });
  }

  const res = await app.inject({
    method: 'GET', url: '/v1/reports/fuel-efficiency?from=2026-07-01&to=2026-07-31', headers: H,
  });
  assert.equal(res.statusCode, 200);
  const data = res.json().data as {
    vehicles: Array<{ plateNo: string; kmPerLiter: number | null; anomaly: boolean; reasons: string[] }>;
  };
  const c = data.vehicles.find((v) => v.plateNo === 'FE-C')!;
  const a = data.vehicles.find((v) => v.plateNo === 'FE-A')!;
  assert.ok(c.kmPerLiter !== null && a.kmPerLiter !== null && c.kmPerLiter < a.kmPerLiter);
  assert.equal(c.anomaly, true);
  assert.ok(c.reasons.includes('low_km_per_liter'));
  assert.equal(a.anomaly, false);
});
