import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeUsage, buildUsageExport, type UsageRow } from './transport_usage';

const rows: UsageRow[] = [
  // Employee A: two rides on the same day (round trip) → 2 rides, 1 day
  { employeeId: 'A', employeeNo: 'E-1', serviceDate: '2026-07-01', direction: 'inbound' },
  { employeeId: 'A', employeeNo: 'E-1', serviceDate: '2026-07-01', direction: 'outbound' },
  // ...plus one more ride on another day → 3 rides, 2 days
  { employeeId: 'A', employeeNo: 'E-1', serviceDate: '2026-07-02', direction: 'inbound' },
  // Employee B: one ride
  { employeeId: 'B', employeeNo: 'E-2', serviceDate: '2026-07-01', direction: 'inbound' },
];

test('summarizeUsage counts rides and distinct days (round-trip = one day)', () => {
  const s = summarizeUsage(rows);
  const a = s.perEmployee.find((e) => e.employeeId === 'A')!;
  assert.equal(a.rides, 3);
  assert.equal(a.days, 2);
  assert.equal(a.inbound, 2);
  assert.equal(a.outbound, 1);
  assert.deepEqual(s.totals, { employees: 2, rides: 4, days: 3 });
});

test('the ride is never charged at trip time — usage is only counted for later deduction', () => {
  const s = summarizeUsage(rows);
  // No monetary amount is produced here; the engine yields counts only.
  assert.ok(!('amount' in (s.perEmployee[0] as object)));
  assert.ok(!('cost' in (s.totals as object)));
});

test('buildUsageExport is idempotent: same period + counts → same key', () => {
  const req = {
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    target: 'payroll' as const,
    format: 'csv' as const,
    rows,
  };
  const a = buildUsageExport(req);
  const b = buildUsageExport({ ...req, rows: [...rows].reverse() });
  assert.equal(a.idempotencyKey, b.idempotencyKey);
  assert.equal(a.ridesCount, 4);
  assert.equal(a.daysCount, 3);
  assert.equal(a.employeesCount, 2);
  assert.match(a.content, /employee_id,employee_no,rides,days/);
});

test('sap_idoc export carries the payroll wage-type envelope, not a charge', () => {
  const r = buildUsageExport({
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    target: 'sap_successfactors',
    format: 'sap_idoc',
    rows,
  });
  assert.match(r.content, /MESTYP=HRPAYUSAGE/);
  assert.match(r.content, /RIDES=4\|DAYS=3/);
});

test('empty export is rejected', () => {
  assert.throws(() => buildUsageExport({
    periodStart: '2026-07-01', periodEnd: '2026-07-31', target: 'payroll', format: 'csv', rows: [],
  }), /nothing to export/);
});
