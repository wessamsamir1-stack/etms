import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import {
  EligibilityInput,
  EligibilityPolicy,
  EligibilityResult,
  evaluateEligibility,
} from '../domain/eligibility/eligibility_engine';
import { EligibilityAiPort, NullEligibilityAi } from '../domain/eligibility/ai_port';
import { ApiError, authenticate, getPrincipal, requireMfa, requirePermission } from './middleware/context';
import { parse } from './validate';
import type { Deps } from './routes';

const uuid = z.object({ id: z.string().uuid() });

interface Evaluation {
  result: EligibilityResult;
  policyMode: 'shadow' | 'live';
  aiModelVersion: string;
}

/** Gather the decision facts for one employee (RLS-scoped) and run the engine. */
async function evaluateEmployee(
  c: PoolClient,
  tenantId: string,
  employeeId: string,
  ai: EligibilityAiPort,
): Promise<Evaluation> {
  const emp = (
    await c.query<{ eligible: boolean; has_hr_id: boolean; is_res: boolean; has_home: boolean; deleted_at: Date | null }>(
      `SELECT eligible, external_hr_id IS NOT NULL AS has_hr_id, residence_id IS NOT NULL AS is_res,
              home_location IS NOT NULL AS has_home, deleted_at
       FROM employee WHERE id=$1`,
      [employeeId],
    )
  ).rows[0];
  if (!emp) throw new ApiError(404, 'NOT_FOUND', 'Employee not found');

  const v = (
    await c.query<{ transport_block: boolean | null; employment_ended: boolean | null; minor: number }>(
      `SELECT bool_or(type='transport_block'  AND status='active') AS transport_block,
              bool_or(type='employment_ended' AND status='active') AS employment_ended,
              count(*) FILTER (WHERE status='active' AND severity='minor')::int AS minor
       FROM hr_violation WHERE employee_id=$1`,
      [employeeId],
    )
  ).rows[0]!;

  const dist =
    (
      await c.query<{ dist_km: number | null }>(
        `SELECT MIN(ST_Distance(e.home_location, s.location))/1000.0 AS dist_km
         FROM employee e CROSS JOIN site s
         WHERE e.id=$1 AND e.home_location IS NOT NULL AND s.location IS NOT NULL AND s.deleted_at IS NULL`,
        [employeeId],
      )
    ).rows[0]?.dist_km ?? null;

  const pol = (
    await c.query<{ service_radius_km: number; green_max: number; amber_max: number; weights: object; auto_approve_mode: 'shadow' | 'live' }>(
      `SELECT service_radius_km, green_max, amber_max, weights, auto_approve_mode
       FROM eligibility_policy WHERE tenant_id=$1`,
      [tenantId],
    )
  ).rows[0];

  const policy: EligibilityPolicy = {
    serviceRadiusKm: pol ? Number(pol.service_radius_km) : 40,
    greenMax: pol?.green_max ?? 20,
    amberMax: pol?.amber_max ?? 60,
    weights: (pol?.weights as EligibilityPolicy['weights']) ?? undefined,
  };

  const findings = await ai.analyzeProfile({ tenantId, employeeId });
  const input: EligibilityInput = {
    employeeStatus: emp.deleted_at ? 'disabled' : 'active',
    eligibleFlag: emp.eligible,
    employeeNumberMatches: emp.has_hr_id,
    hasActiveTransportBlock: v.transport_block === true,
    employmentEnded: v.employment_ended === true,
    isResidenceMember: emp.is_res,
    homeLocationKnown: emp.has_home,
    homeDistanceKm: dist,
    activeMinorViolations: v.minor,
    aiDocumentMismatch: findings.documentMismatch,
    missingOrExpiredDoc: findings.missingOrExpiredDoc,
  };

  return {
    result: evaluateEligibility(input, policy),
    policyMode: pol?.auto_approve_mode ?? 'shadow',
    aiModelVersion: findings.modelVersion,
  };
}

export async function registerEligibilityRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  const auth = authenticate(config.jwtSecret);
  const ai = deps.eligibilityAi ?? new NullEligibilityAi();
  const requireDb = () => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    return db;
  };

  // Evaluate only (no side effects).
  app.post('/v1/eligibility/evaluate', { preHandler: [auth, requirePermission('employee.manage')] }, async (req) => {
    const b = parse(z.object({ employeeId: z.string().uuid() }), req.body);
    const p = getPrincipal(req);
    const ev = await requireDb().withTenant(p.tenantId, p.userId, (c) => evaluateEmployee(c, p.tenantId, b.employeeId, ai));
    return { employeeId: b.employeeId, ...ev.result, policyMode: ev.policyMode, aiModelVersion: ev.aiModelVersion };
  });

  // Persist a decision. GREEN auto-approves ONLY in `live` mode; in `shadow` it
  // is recorded as a recommendation for human review (rollout guardrail).
  app.post('/v1/eligibility/decisions', { preHandler: [auth, requirePermission('employee.manage')] }, async (req) => {
    const b = parse(z.object({ employeeId: z.string().uuid() }), req.body);
    const p = getPrincipal(req);
    return requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const ev = await evaluateEmployee(c, p.tenantId, b.employeeId, ai);
      const { band } = ev.result;
      let outcome: 'approved' | 'rejected' | 'needs_review';
      if (band === 'red') outcome = 'rejected';
      else if (band === 'green' && ev.policyMode === 'live') outcome = 'approved';
      else outcome = 'needs_review'; // amber, or green-in-shadow

      const row = (
        await c.query(
          `INSERT INTO eligibility_decision
             (tenant_id, employee_id, outcome, band, decision_source, risk_score,
              hard_gate_results, risk_breakdown, ai_model_version, decided_by)
           VALUES ($1,$2,$3,$4,'auto_rules',$5,$6,$7,$8,NULL) RETURNING id, outcome, band, risk_score`,
          [
            p.tenantId, b.employeeId, outcome, band, ev.result.riskScore,
            JSON.stringify(ev.result.hardGateResults), JSON.stringify(ev.result.riskBreakdown),
            ev.aiModelVersion,
          ],
        )
      ).rows[0];
      return { ...row, policyMode: ev.policyMode, autoApproved: outcome === 'approved' };
    });
  });

  // Human review queue (pending decisions).
  app.get('/v1/eligibility/queue', { preHandler: [auth, requirePermission('employee.manage')] }, async (req) => {
    const q = parse(z.object({ band: z.string().optional() }), req.query);
    const p = getPrincipal(req);
    const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `SELECT id, employee_id, band, outcome, risk_score, created_at
         FROM eligibility_decision
         WHERE outcome='needs_review' ${q.band ? 'AND band=$1' : ''}
         ORDER BY created_at DESC LIMIT 200`,
        q.band ? [q.band] : [],
      ),
    );
    return { data: rows.rows };
  });

  // Human override of a decision.
  app.post('/v1/eligibility/decisions/:id/override', { preHandler: [auth, requirePermission('employee.manage')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const b = parse(z.object({ outcome: z.enum(['approved', 'rejected']) }), req.body);
    const p = getPrincipal(req);
    const res = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `UPDATE eligibility_decision SET outcome=$2, decision_source='human', reviewed_by=$3
         WHERE id=$1 RETURNING id, outcome, decision_source`,
        [id, b.outcome, p.userId],
      ),
    );
    if (res.rowCount === 0) throw new ApiError(404, 'NOT_FOUND', 'Decision not found');
    return { data: res.rows[0] };
  });

  // Policy read + update (enabling auto-approval is sensitive → MFA step-up).
  app.get('/v1/eligibility/policy', { preHandler: [auth, requirePermission('employee.manage')] }, async (req) => {
    const p = getPrincipal(req);
    const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query('SELECT * FROM eligibility_policy WHERE tenant_id=$1', [p.tenantId]),
    );
    return { data: rows.rows[0] ?? { auto_approve_mode: 'shadow', service_radius_km: 40, green_max: 20, amber_max: 60, ai_enabled: false } };
  });

  app.patch('/v1/eligibility/policy', { preHandler: [auth, requirePermission('employee.manage'), requireMfa()] }, async (req) => {
    const b = parse(
      z.object({
        serviceRadiusKm: z.number().positive().optional(),
        greenMax: z.number().int().nonnegative().optional(),
        amberMax: z.number().int().positive().optional(),
        autoApproveMode: z.enum(['shadow', 'live']).optional(),
        aiEnabled: z.boolean().optional(),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `INSERT INTO eligibility_policy(tenant_id, service_radius_km, green_max, amber_max, auto_approve_mode, ai_enabled)
         VALUES ($1, coalesce($2,40), coalesce($3,20), coalesce($4,60), coalesce($5,'shadow'), coalesce($6,false))
         ON CONFLICT (tenant_id) DO UPDATE SET
           service_radius_km = coalesce($2, eligibility_policy.service_radius_km),
           green_max         = coalesce($3, eligibility_policy.green_max),
           amber_max         = coalesce($4, eligibility_policy.amber_max),
           auto_approve_mode = coalesce($5, eligibility_policy.auto_approve_mode),
           ai_enabled        = coalesce($6, eligibility_policy.ai_enabled)
         RETURNING *`,
        [p.tenantId, b.serviceRadiusKm ?? null, b.greenMax ?? null, b.amberMax ?? null, b.autoApproveMode ?? null, b.aiEnabled ?? null],
      ),
    );
    return { data: rows.rows[0] };
  });
}
