import { createHash } from 'node:crypto';

/**
 * Employee Transport Usage — the deduction is deferred, not applied at trip time.
 * A company ride is never charged to the employee when they board; instead each
 * ride is recorded and this module (a) aggregates rides + distinct days per
 * employee and (b) builds an idempotent batch for Accounting / HR / payroll to
 * apply the deduction later. Pure + deterministic (mirrors db/V0018 and the
 * `v_employee_transport_usage` view).
 */
export type Direction = 'inbound' | 'outbound';
export type UsageExportFormat = 'csv' | 'json' | 'sap_idoc';

export interface UsageRow {
  employeeId: string;
  employeeNo?: string; // HR/payroll number (SuccessFactors) when known
  serviceDate: string; // YYYY-MM-DD
  direction: Direction;
}

export interface EmployeeUsage {
  employeeId: string;
  employeeNo?: string;
  rides: number;
  days: number; // distinct service dates — a round-trip on one day is still one day
  inbound: number;
  outbound: number;
}

export interface UsageSummary {
  perEmployee: EmployeeUsage[];
  totals: { employees: number; rides: number; days: number };
}

/** Aggregate raw ledger rows into per-employee ride/day counts (billable only). */
export function summarizeUsage(rows: readonly UsageRow[]): UsageSummary {
  const byEmp = new Map<string, { u: EmployeeUsage; dates: Set<string> }>();
  for (const r of rows) {
    let e = byEmp.get(r.employeeId);
    if (!e) {
      e = {
        u: { employeeId: r.employeeId, employeeNo: r.employeeNo, rides: 0, days: 0, inbound: 0, outbound: 0 },
        dates: new Set<string>(),
      };
      byEmp.set(r.employeeId, e);
    }
    if (r.employeeNo && !e.u.employeeNo) e.u.employeeNo = r.employeeNo;
    e.u.rides += 1;
    if (r.direction === 'inbound') e.u.inbound += 1;
    else e.u.outbound += 1;
    e.dates.add(r.serviceDate);
  }

  const perEmployee = [...byEmp.values()]
    .map(({ u, dates }) => ({ ...u, days: dates.size }))
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId));

  return {
    perEmployee,
    totals: {
      employees: perEmployee.length,
      rides: perEmployee.reduce((s, e) => s + e.rides, 0),
      days: perEmployee.reduce((s, e) => s + e.days, 0),
    },
  };
}

export interface UsageExportRequest {
  periodStart: string;
  periodEnd: string;
  target: 'payroll' | 'hr' | 'accounting' | 'sap_successfactors';
  format: UsageExportFormat;
  rows: readonly UsageRow[];
}

export interface UsageExportResult {
  idempotencyKey: string;
  target: string;
  format: UsageExportFormat;
  ridesCount: number;
  daysCount: number;
  employeesCount: number;
  content: string;
  summary: UsageSummary;
}

/**
 * Build an idempotent deduction batch. The key is a deterministic hash of the
 * period + target + per-employee counts, so re-exporting the same period is a
 * safe no-op on the payroll side (no double deduction).
 */
export function buildUsageExport(req: UsageExportRequest): UsageExportResult {
  if (req.rows.length === 0) throw new Error('nothing to export');
  const summary = summarizeUsage(req.rows);

  const content =
    req.format === 'csv'
      ? toCsv(summary)
      : req.format === 'json'
        ? JSON.stringify({
            period: [req.periodStart, req.periodEnd],
            target: req.target,
            totals: summary.totals,
            lines: summary.perEmployee,
          })
        : toIdoc(req, summary);

  return {
    idempotencyKey: deriveKey(req, summary),
    target: req.target,
    format: req.format,
    ridesCount: summary.totals.rides,
    daysCount: summary.totals.days,
    employeesCount: summary.totals.employees,
    content,
    summary,
  };
}

function deriveKey(req: UsageExportRequest, s: UsageSummary): string {
  const canonical = s.perEmployee
    .map((e) => `${e.employeeId}|${e.rides}|${e.days}`)
    .sort()
    .join('\n');
  const h = createHash('sha256')
    .update(`${req.periodStart}:${req.periodEnd}:${req.target}\n${canonical}`)
    .digest('hex');
  return `pay_${h.slice(0, 32)}`;
}

function toCsv(s: UsageSummary): string {
  const header = 'employee_id,employee_no,rides,days,inbound,outbound';
  const rows = s.perEmployee.map(
    (e) => `${e.employeeId},${e.employeeNo ?? ''},${e.rides},${e.days},${e.inbound},${e.outbound}`,
  );
  return [header, ...rows].join('\n');
}

/** Minimal SAP-style payroll wage-type envelope (deferred deduction, not a charge). */
function toIdoc(req: UsageExportRequest, s: UsageSummary): string {
  const segments = s.perEmployee.map(
    (e, i) =>
      `E1PLAText|SEQNR=${String(i + 1).padStart(3, '0')}|PERNR=${e.employeeNo ?? e.employeeId}` +
      `|RIDES=${e.rides}|DAYS=${e.days}`,
  );
  return [
    `EDI_DC40|MESTYP=HRPAYUSAGE|TARGET=${req.target.toUpperCase()}` +
      `|BEGDA=${req.periodStart.replace(/-/g, '')}|ENDDA=${req.periodEnd.replace(/-/g, '')}`,
    `E1PLAHF|EMPLOYEES=${s.totals.employees}|RIDES=${s.totals.rides}|DAYS=${s.totals.days}`,
    ...segments,
  ].join('\n');
}
