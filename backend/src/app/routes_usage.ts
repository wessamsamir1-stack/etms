import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, authenticate, getPrincipal, requireMfa, requirePermission } from './middleware/context';
import { parse } from './validate';
import { buildUsageExport, type UsageRow } from '../domain/usage/transport_usage';
import type { Deps } from './routes';

const uuid = z.object({ id: z.string().uuid() });

/**
 * Transport usage → deferred payroll deduction (docs/etms/13). A company ride is
 * NOT charged to the employee at trip time. Each ride taken is recorded on the
 * `transport_usage` ledger (rides + distinct days), and Accounting/HR pull a
 * period batch (`/export`) so the deduction is applied later in payroll.
 * Everything is RLS-tenant-scoped; the export is idempotent + MFA-gated.
 */
export async function registerUsageRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  const auth = authenticate(config.jwtSecret);
  const requireDb = () => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    return db;
  };

  // Manual usage capture (e.g. a boarding without a QR scan). The QR check-in
  // path records usage automatically in routes.ts.
  app.post('/v1/transport-usage', { preHandler: [auth, requirePermission('trip.operate')] }, async (req, reply) => {
    const b = parse(
      z.object({
        employee_id: z.string().uuid(),
        service_date: z.string(),
        direction: z.enum(['inbound', 'outbound']),
        trip_id: z.string().uuid().optional(),
        note: z.string().max(500).optional(),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    const row = await requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const emp = (await c.query('SELECT id FROM employee WHERE id=$1 AND deleted_at IS NULL', [b.employee_id])).rows[0];
      if (!emp) throw new ApiError(422, 'VALIDATION_ERROR', 'Employee not found');
      const res = await c.query(
        `INSERT INTO transport_usage(tenant_id, employee_id, trip_id, service_date, direction, source, recorded_by)
         VALUES ($1,$2,$3,$4,$5,'manual',$6)
         ON CONFLICT (tenant_id, trip_id, employee_id, direction) DO NOTHING
         RETURNING *`,
        [p.tenantId, b.employee_id, b.trip_id ?? null, b.service_date, b.direction, p.userId],
      );
      if (res.rowCount === 0) throw new ApiError(409, 'CONFLICT', 'This ride is already recorded');
      if (b.note) await c.query('UPDATE transport_usage SET note=$2 WHERE id=$1', [res.rows[0].id, b.note]);
      return res.rows[0];
    });
    reply.code(201);
    return { data: row };
  });

  // Per-employee aggregate for a period — what HR/payroll deducts against.
  app.get('/v1/transport-usage', { preHandler: [auth, requirePermission('report.financial')] }, async (req) => {
    const q = parse(
      z.object({ from: z.string(), to: z.string(), employee_id: z.string().uuid().optional() }),
      req.query,
    );
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const { rows } = await c.query(
        `SELECT tu.employee_id, e.external_hr_id AS employee_no, e.full_name,
                count(*)::int                                        AS rides,
                count(DISTINCT tu.service_date)::int                 AS days,
                count(*) FILTER (WHERE tu.direction='inbound')::int  AS inbound,
                count(*) FILTER (WHERE tu.direction='outbound')::int AS outbound,
                count(*) FILTER (WHERE tu.deduction_status='pending')::int  AS pending,
                count(*) FILTER (WHERE tu.deduction_status='exported')::int AS exported
         FROM transport_usage tu
         JOIN employee e ON e.id = tu.employee_id
         WHERE tu.billable = true AND tu.service_date BETWEEN $1 AND $2
           AND ($3::uuid IS NULL OR tu.employee_id = $3)
         GROUP BY tu.employee_id, e.external_hr_id, e.full_name
         ORDER BY rides DESC`,
        [q.from, q.to, q.employee_id ?? null],
      );
      const totals = rows.reduce(
        (acc, r) => ({ employees: acc.employees + 1, rides: acc.rides + r.rides, days: acc.days + r.days }),
        { employees: 0, rides: 0, days: 0 },
      );
      return { data: rows, totals };
    });
  });

  // Trip-by-trip detail — "how many times, and the details of each ride". This is
  // the report HR reads to set the deduction; the system reports, it never
  // computes the amount (fixed monthly, or seasonal — HR decides).
  app.get('/v1/transport-usage/details', { preHandler: [auth, requirePermission('report.financial')] }, async (req) => {
    const q = parse(
      z.object({ from: z.string(), to: z.string(), employee_id: z.string().uuid().optional() }),
      req.query,
    );
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const { rows } = await c.query(
        `SELECT tu.id, tu.employee_id, e.external_hr_id AS employee_no, e.full_name,
                tu.service_date, tu.direction, tu.boarded_at, tu.source,
                tu.trip_id, r.name AS route_name, s.name AS site_name,
                tu.deduction_status, tu.note
         FROM transport_usage tu
         JOIN employee e ON e.id = tu.employee_id
         LEFT JOIN trip t ON t.id = tu.trip_id
         LEFT JOIN route r ON r.id = t.route_id
         LEFT JOIN site  s ON s.id = t.site_id
         WHERE tu.billable = true AND tu.service_date BETWEEN $1 AND $2
           AND ($3::uuid IS NULL OR tu.employee_id = $3)
         ORDER BY e.full_name, tu.service_date, tu.boarded_at`,
        [q.from, q.to, q.employee_id ?? null],
      );
      return { data: rows, count: rows.length };
    });
  });

  // Waive a recorded ride (kept on the ledger for audit; excluded from deduction).
  app.post('/v1/transport-usage/:id/waive', { preHandler: [auth, requirePermission('report.financial')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const b = parse(z.object({ reason: z.string().min(1).max(500) }), req.body);
    const p = getPrincipal(req);
    const res = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `UPDATE transport_usage
         SET billable=false, deduction_status='waived', waive_reason=$2
         WHERE id=$1 AND deduction_status IN ('pending')
         RETURNING *`,
        [id, b.reason],
      ),
    );
    if (res.rowCount === 0) {
      throw new ApiError(409, 'CONFLICT', 'Ride not found, already exported, or already waived');
    }
    return { data: res.rows[0] };
  });

  // Build + persist an idempotent deduction batch for Accounting/HR/payroll, and
  // mark the included rides 'exported'. Sensitive → MFA step-up.
  app.post(
    '/v1/transport-usage/export',
    { preHandler: [auth, requirePermission('erp.export'), requireMfa()] },
    async (req, reply) => {
      const b = parse(
        z.object({
          periodStart: z.string(),
          periodEnd: z.string(),
          target: z.enum(['payroll', 'hr', 'accounting', 'sap_successfactors']).default('payroll'),
          format: z.enum(['csv', 'json', 'sap_idoc']).default('csv'),
        }),
        req.body,
      );
      const p = getPrincipal(req);
      return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
        // Only still-pending billable rides in the window are exported.
        const ledger = (
          await c.query(
            `SELECT tu.id, tu.employee_id, e.external_hr_id AS employee_no, tu.service_date, tu.direction
             FROM transport_usage tu
             JOIN employee e ON e.id = tu.employee_id
             WHERE tu.billable = true AND tu.deduction_status = 'pending'
               AND tu.service_date BETWEEN $1 AND $2
             ORDER BY tu.service_date`,
            [b.periodStart, b.periodEnd],
          )
        ).rows;
        if (ledger.length === 0) throw new ApiError(422, 'VALIDATION_ERROR', 'No pending rides in this period');

        const rows: UsageRow[] = ledger.map((r) => ({
          employeeId: r.employee_id,
          employeeNo: r.employee_no ?? undefined,
          serviceDate: toDateStr(r.service_date),
          direction: r.direction,
        }));
        const batch = buildUsageExport({ ...b, rows });

        // Idempotent: same period + counts → same key → no double deduction.
        const existing = (
          await c.query('SELECT * FROM payroll_usage_export WHERE tenant_id=$1 AND idempotency_key=$2', [
            p.tenantId,
            batch.idempotencyKey,
          ])
        ).rows[0];
        if (existing) {
          reply.code(200);
          return { data: existing, summary: batch.summary, idempotent: true };
        }

        const exportRow = (
          await c.query(
            `INSERT INTO payroll_usage_export
               (tenant_id, period_start, period_end, target, format, idempotency_key,
                status, rides_count, days_count, employees_count, content, posted_at, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,'posted',$7,$8,$9,$10, now(), $11)
             RETURNING *`,
            [
              p.tenantId, b.periodStart, b.periodEnd, b.target, b.format, batch.idempotencyKey,
              batch.ridesCount, batch.daysCount, batch.employeesCount, batch.content, p.userId,
            ],
          )
        ).rows[0];

        await c.query(
          `UPDATE transport_usage
           SET deduction_status='exported', export_id=$3
           WHERE id = ANY($1::uuid[]) AND tenant_id=$2`,
          [ledger.map((r) => r.id), p.tenantId, exportRow.id],
        );

        reply.code(201);
        return { data: exportRow, summary: batch.summary, idempotent: false };
      });
    },
  );
}

function toDateStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
