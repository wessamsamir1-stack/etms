import type { PoolClient } from 'pg';
import type { HrRecord } from './hr_directory';

export interface SyncSummary {
  processed: number;
  matched: number;
  blocksActive: number;
  cleared: number;
  skipped: number;
}

/**
 * Applies HR records to `hr_violation` idempotently. Each employee yields two
 * blocking-signal rows keyed by `<externalRef>:<type>`, so re-running a sync
 * only flips status (active/cleared) — never duplicates. Must run inside a
 * tenant-scoped transaction (RLS enforces isolation).
 */
export async function applyHrRecords(
  c: PoolClient,
  tenantId: string,
  records: readonly HrRecord[],
): Promise<SyncSummary> {
  let matched = 0;
  let blocksActive = 0;
  let cleared = 0;
  let skipped = 0;

  for (const r of records) {
    const emp = (
      await c.query<{ id: string }>(
        'SELECT id FROM employee WHERE tenant_id=$1 AND external_hr_id=$2 AND deleted_at IS NULL',
        [tenantId, r.externalRef],
      )
    ).rows[0];
    if (!emp) {
      skipped += 1;
      continue;
    }
    matched += 1;

    const signals: [string, boolean][] = [
      ['transport_block', r.transportBlock],
      ['employment_ended', r.employmentEnded],
    ];
    for (const [type, active] of signals) {
      await c.query(
        `INSERT INTO hr_violation(tenant_id, employee_id, external_ref, type, severity, status, synced_at)
         VALUES ($1,$2,$3,$4,'blocking',$5, now())
         ON CONFLICT (tenant_id, external_ref)
           DO UPDATE SET status = EXCLUDED.status, synced_at = now()`,
        [tenantId, emp.id, `${r.externalRef}:${type}`, type, active ? 'active' : 'cleared'],
      );
      if (active) blocksActive += 1;
      else cleared += 1;
    }
  }

  return { processed: records.length, matched, blocksActive, cleared, skipped };
}
