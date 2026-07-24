import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server';
import { Db } from './db/pool';
import { generateTotp } from '../util/totp';
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
