import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildErpExport, CostLine } from './erp_export';

const lines: CostLine[] = [
  { tripId: 't1', costCenter: 'CC100', amount: 12.5, currency: 'KWD', serviceDate: '2026-07-01' },
  { tripId: 't2', costCenter: 'CC200', amount: 7.25, currency: 'KWD', serviceDate: '2026-07-01' },
];
const base = { periodStart: '2026-07-01', periodEnd: '2026-07-31', lines } as const;

test('totals and counts lines', () => {
  const r = buildErpExport({ ...base, format: 'csv' });
  assert.equal(r.total, 19.75);
  assert.equal(r.lineCount, 2);
  assert.equal(r.currency, 'KWD');
});

test('CSV has a header and one row per line', () => {
  const r = buildErpExport({ ...base, format: 'csv' });
  const rows = r.content.split('\n');
  assert.equal(rows[0], 'trip_id,cost_center,amount,currency,service_date');
  assert.equal(rows.length, 3);
});

test('idempotency key is deterministic and order-independent', () => {
  const a = buildErpExport({ ...base, format: 'csv' });
  const b = buildErpExport({ ...base, format: 'csv', lines: [lines[1]!, lines[0]!] });
  assert.equal(a.idempotencyKey, b.idempotencyKey); // same content, any order
  assert.match(a.idempotencyKey, /^erp_[0-9a-f]{32}$/);
});

test('changing the period changes the key', () => {
  const a = buildErpExport({ ...base, format: 'csv' });
  const b = buildErpExport({ ...base, format: 'csv', periodEnd: '2026-08-31' });
  assert.notEqual(a.idempotencyKey, b.idempotencyKey);
});

test('SAP IDoc envelope includes header + segments', () => {
  const r = buildErpExport({ ...base, format: 'sap_idoc' });
  assert.match(r.content, /MESTYP=ACC_DOCUMENT/);
  assert.match(r.content, /E1FISEG/);
});

test('rejects mixed currencies and empty batches', () => {
  assert.throws(() => buildErpExport({ ...base, format: 'csv', lines: [] }));
  assert.throws(() =>
    buildErpExport({
      ...base,
      format: 'csv',
      lines: [lines[0]!, { ...lines[1]!, currency: 'USD' }],
    }),
  );
});
