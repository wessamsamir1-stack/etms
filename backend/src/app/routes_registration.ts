import { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ApiError, authenticate, getPrincipal, requireMfa, requirePermission } from './middleware/context';
import { parse } from './validate';
import { hashPassword, validatePasswordStrength } from '../util/password';
import { generateOtp, hashOtp, verifyOtp, OTP_TTL_SECONDS, OTP_MAX_ATTEMPTS } from '../domain/registration/otp';
import { StubOtpDelivery, ManualReviewFaceMatch, type OtpDeliveryPort, type FaceMatchPort } from '../domain/registration/ports';
import type { Deps } from './routes';

const uuid = z.object({ id: z.string().uuid() });

/**
 * Self-registration by employee number (docs/etms/14). Two onboarding paths
 * coexist: admins still provision accounts directly, and here a driver/staff/rider
 * self-registers — the system recognizes them from the HR-uploaded roster by their
 * employee number, takes a selfie + an OTP sent to their phone/email, and an
 * authorized reviewer approves. On approval the account is created, linked to the
 * driver/employee record, and given the matching role.
 *
 * The public endpoints run pre-auth: a SECURITY DEFINER resolver (reg_tenant_id,
 * db/V0019) turns the tenant slug into an id, then everything runs RLS-scoped.
 */
export async function registerRegistrationRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  const otpDelivery: OtpDeliveryPort = deps.otpDelivery ?? new StubOtpDelivery();
  const faceMatch: FaceMatchPort = deps.faceMatch ?? new ManualReviewFaceMatch();
  const devCodes = config.env !== 'production'; // surface OTP in non-prod so the flow is testable
  const requireDb = () => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    return db;
  };
  const auth = authenticate(config.jwtSecret);

  // Resolve a public tenant slug → id (pre-auth), then run RLS-scoped as no user.
  async function inTenant<T>(slug: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const rows = await requireDb().query<{ id: string }>('SELECT reg_tenant_id($1) AS id', [slug]);
    const tenantId = rows[0]?.id;
    if (!tenantId) throw new ApiError(404, 'NOT_FOUND', 'Unknown tenant');
    return requireDb().withTenant(tenantId, '', fn);
  }

  // ---- Public: is my employee number recognized? --------------------------
  app.post('/v1/register/lookup', async (req) => {
    const b = parse(z.object({ tenantSlug: z.string().min(1), employeeNo: z.string().min(1) }), req.body);
    return inTenant(b.tenantSlug, async (c) => {
      const r = (
        await c.query(
          `SELECT full_name, kind, phone, email, registered_user_id
           FROM hr_roster WHERE employee_no=$1 AND status='active'`,
          [b.employeeNo],
        )
      ).rows[0];
      if (!r) return { found: false };
      if (r.registered_user_id) throw new ApiError(409, 'CONFLICT', 'This employee is already registered');
      const channels: Array<{ channel: string; masked: string }> = [];
      if (r.phone) channels.push({ channel: 'sms', masked: maskPhone(r.phone) });
      if (r.email) channels.push({ channel: 'email', masked: maskEmail(r.email) });
      return { found: true, fullName: r.full_name, kind: r.kind, channels };
    });
  });

  // ---- Public: start registration → sends the OTP -------------------------
  app.post('/v1/register/start', async (req, reply) => {
    const b = parse(
      z.object({
        tenantSlug: z.string().min(1),
        employeeNo: z.string().min(1),
        channel: z.enum(['sms', 'email']),
        photoRef: z.string().min(1), // selfie reference (client uploads to storage)
        password: z.string().min(1),
      }),
      req.body,
    );
    const strength = validatePasswordStrength(b.password);
    if (!strength.ok) throw new ApiError(422, 'VALIDATION_ERROR', `Weak password: ${strength.issues.join(', ')}`);

    return inTenant(b.tenantSlug, async (c) => {
      const roster = (
        await c.query(
          `SELECT * FROM hr_roster WHERE employee_no=$1 AND status='active'`,
          [b.employeeNo],
        )
      ).rows[0];
      if (!roster) throw new ApiError(404, 'NOT_FOUND', 'Employee number not found in the HR roster');
      if (roster.registered_user_id) throw new ApiError(409, 'CONFLICT', 'This employee is already registered');
      const to = b.channel === 'sms' ? roster.phone : roster.email;
      if (!to) throw new ApiError(422, 'VALIDATION_ERROR', `No ${b.channel} on file for this employee`);

      const code = generateOtp(6);
      const expires = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

      // Upsert the live request (unique partial index keeps one live row per employee_no).
      await c.query(
        `DELETE FROM registration_request
         WHERE employee_no=$1 AND status IN ('pending_otp','pending_review')`,
        [b.employeeNo],
      );
      const reqRow = (
        await c.query(
          `INSERT INTO registration_request
             (tenant_id, roster_id, employee_no, channel, contact, photo_ref, password_hash,
              otp_hash, otp_expires_at, status)
           VALUES (app_current_tenant(),$1,$2,$3,$4,$5,$6,$7,$8,'pending_otp')
           RETURNING id, otp_expires_at`,
          [roster.id, b.employeeNo, b.channel, to, b.photoRef, hashPassword(b.password),
           hashOtp(code, config.jwtSecret), expires],
        )
      ).rows[0];

      await otpDelivery.send(b.channel, to, code);
      reply.code(201);
      return {
        requestId: reqRow.id,
        expiresAt: reqRow.otp_expires_at,
        sentTo: b.channel === 'sms' ? maskPhone(to) : maskEmail(to),
        ...(devCodes ? { devCode: code } : {}),
      };
    });
  });

  // ---- Public: verify the OTP → moves to review ---------------------------
  app.post('/v1/register/verify-otp', async (req) => {
    const b = parse(
      z.object({ tenantSlug: z.string().min(1), requestId: z.string().uuid(), code: z.string().min(4) }),
      req.body,
    );
    return inTenant(b.tenantSlug, async (c) => {
      const r = (await c.query('SELECT * FROM registration_request WHERE id=$1', [b.requestId])).rows[0];
      if (!r) throw new ApiError(404, 'NOT_FOUND', 'Registration not found');
      if (r.status !== 'pending_otp') throw new ApiError(409, 'CONFLICT', `Registration is ${r.status}`);
      if (new Date(r.otp_expires_at).getTime() < Date.now()) {
        await c.query("UPDATE registration_request SET status='expired' WHERE id=$1", [r.id]);
        throw new ApiError(410, 'GONE', 'Code expired — start again');
      }
      if (r.otp_attempts >= OTP_MAX_ATTEMPTS) {
        await c.query("UPDATE registration_request SET status='expired' WHERE id=$1", [r.id]);
        throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts — start again');
      }
      if (!verifyOtp(b.code, r.otp_hash, config.jwtSecret)) {
        await c.query('UPDATE registration_request SET otp_attempts = otp_attempts + 1 WHERE id=$1', [r.id]);
        throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid code');
      }

      // Optional face match (stub → manual). Score stored for the reviewer.
      const roster = (await c.query('SELECT photo_ref FROM hr_roster WHERE id=$1', [r.roster_id])).rows[0];
      const fm = await faceMatch.match(roster?.photo_ref ?? null, r.photo_ref);
      await c.query(
        `UPDATE registration_request
         SET status='pending_review', otp_verified_at=now(), face_match_score=$2
         WHERE id=$1`,
        [r.id, fm.score],
      );
      return { status: 'pending_review', faceMatch: fm.decision };
    });
  });

  // ---- Review queue (authenticated) ---------------------------------------
  app.get('/v1/registrations', { preHandler: [auth, requirePermission('registration.review')] }, async (req) => {
    const q = parse(z.object({ status: z.string().optional() }), req.query);
    const p = getPrincipal(req);
    const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `SELECT rr.id, rr.employee_no, rr.channel, rr.contact, rr.photo_ref, rr.status,
                rr.face_match_score, rr.otp_verified_at, rr.created_at,
                hr.full_name, hr.kind
         FROM registration_request rr
         LEFT JOIN hr_roster hr ON hr.id = rr.roster_id
         WHERE ($1::text IS NULL OR rr.status=$1)
         ORDER BY rr.created_at DESC LIMIT 200`,
        [q.status ?? 'pending_review'],
      ),
    );
    return { data: rows.rows };
  });

  // ---- Approve → provision the account ------------------------------------
  app.post(
    '/v1/registrations/:id/approve',
    { preHandler: [auth, requirePermission('registration.review'), requireMfa()] },
    async (req) => {
      const { id } = parse(uuid, req.params);
      const p = getPrincipal(req);
      return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
        const r = (await c.query('SELECT * FROM registration_request WHERE id=$1', [id])).rows[0];
        if (!r) throw new ApiError(404, 'NOT_FOUND', 'Registration not found');
        if (r.status !== 'pending_review') throw new ApiError(409, 'CONFLICT', `Registration is ${r.status}`);
        const roster = (await c.query('SELECT * FROM hr_roster WHERE id=$1', [r.roster_id])).rows[0];
        if (!roster) throw new ApiError(422, 'VALIDATION_ERROR', 'Roster entry missing');

        let userId: string;
        try {
          userId = (
            await c.query(
              `INSERT INTO app_user(tenant_id, email, phone, full_name, status, password_hash)
               VALUES (app_current_tenant(),$1,$2,$3,'active',$4) RETURNING id`,
              [roster.email ?? null, roster.phone ?? null, roster.full_name, r.password_hash],
            )
          ).rows[0].id;
        } catch (e) {
          if ((e as { code?: string }).code === '23505') {
            throw new ApiError(409, 'CONFLICT', 'An account with this email/phone already exists');
          }
          throw e;
        }

        // Link the entity + assign the matching system role.
        const roleCode = roster.kind === 'driver' ? 'driver' : roster.kind === 'rider' ? 'rider' : null;
        if (roster.kind === 'driver') {
          await c.query(
            `INSERT INTO driver(tenant_id, user_id, full_name, phone, verification_status)
             VALUES (app_current_tenant(),$1,$2,$3,'pending')`,
            [userId, roster.full_name, roster.phone ?? null],
          );
        } else if (roster.kind === 'rider') {
          await c.query(
            `INSERT INTO employee(tenant_id, user_id, external_hr_id, full_name)
             VALUES (app_current_tenant(),$1,$2,$3)`,
            [userId, roster.employee_no, roster.full_name],
          );
        }
        if (roleCode) {
          const role = (await c.query('SELECT id FROM role WHERE code=$1 AND tenant_id IS NULL', [roleCode])).rows[0];
          if (role) {
            await c.query(
              `INSERT INTO user_role(tenant_id, user_id, role_id, granted_by)
               VALUES (app_current_tenant(),$1,$2,$3) ON CONFLICT DO NOTHING`,
              [userId, role.id, p.userId],
            );
          }
        }

        await c.query('UPDATE hr_roster SET registered_user_id=$2 WHERE id=$1', [roster.id, userId]);
        await c.query(
          `UPDATE registration_request
           SET status='approved', reviewed_by=$2, created_user_id=$3 WHERE id=$1`,
          [id, p.userId, userId],
        );
        return { data: { id, status: 'approved', userId, role: roleCode ?? 'unassigned' } };
      });
    },
  );

  // ---- Reject -------------------------------------------------------------
  app.post('/v1/registrations/:id/reject', { preHandler: [auth, requirePermission('registration.review')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const b = parse(z.object({ reason: z.string().min(1).max(500) }), req.body);
    const p = getPrincipal(req);
    const res = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `UPDATE registration_request SET status='rejected', review_note=$2, reviewed_by=$3
         WHERE id=$1 AND status='pending_review' RETURNING id`,
        [id, b.reason, p.userId],
      ),
    );
    if (res.rowCount === 0) throw new ApiError(409, 'CONFLICT', 'Not found or not awaiting review');
    return { data: { id, status: 'rejected' } };
  });

  // ---- HR roster upload (authenticated) -----------------------------------
  const rosterRow = z.object({
    employee_no: z.string().min(1),
    full_name: z.string().min(1),
    kind: z.enum(['driver', 'staff', 'rider']),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    department: z.string().optional(),
    photo_ref: z.string().optional(),
  });

  app.post('/v1/roster', { preHandler: [auth, requirePermission('roster.manage')] }, async (req, reply) => {
    const rows = parse(z.union([rosterRow, z.object({ rows: z.array(rosterRow).min(1).max(5000) })]), req.body);
    const list = 'rows' in rows ? rows.rows : [rows];
    const p = getPrincipal(req);
    const n = await requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      let count = 0;
      for (const e of list) {
        if (!e.phone && !e.email) throw new ApiError(422, 'VALIDATION_ERROR', `Row ${e.employee_no} needs a phone or email`);
        await c.query(
          `INSERT INTO hr_roster(tenant_id, employee_no, full_name, kind, phone, email, department, photo_ref)
           VALUES (app_current_tenant(),$1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (tenant_id, employee_no) DO UPDATE
             SET full_name=EXCLUDED.full_name, kind=EXCLUDED.kind, phone=EXCLUDED.phone,
                 email=EXCLUDED.email, department=EXCLUDED.department, photo_ref=EXCLUDED.photo_ref`,
          [e.employee_no, e.full_name, e.kind, e.phone ?? null, e.email ?? null, e.department ?? null, e.photo_ref ?? null],
        );
        count++;
      }
      return count;
    });
    reply.code(201);
    return { data: { upserted: n } };
  });

  app.get('/v1/roster', { preHandler: [auth, requirePermission('roster.manage')] }, async (req) => {
    const p = getPrincipal(req);
    const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `SELECT id, employee_no, full_name, kind, phone, email, department, status,
                registered_user_id IS NOT NULL AS registered
         FROM hr_roster ORDER BY full_name LIMIT 500`,
      ),
    );
    return { data: rows.rows };
  });
}

function maskPhone(p: string): string {
  return p.length <= 4 ? '****' : `${'*'.repeat(p.length - 4)}${p.slice(-4)}`;
}
function maskEmail(e: string): string {
  const [u, d] = e.split('@');
  if (!d || !u) return '***';
  const head = u.length <= 1 ? u : `${u[0]}***`;
  return `${head}@${d}`;
}
