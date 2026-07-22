import { createHash } from 'node:crypto';

/**
 * SAP / ERP Integration — builds an idempotent, postable batch of cost lines
 * (mirrors the `erp_export` schema + docs/etms/02 §8). Supports a flat CSV and a
 * simple SAP IDoc-style structured document. The idempotency key is a
 * deterministic hash of the period + content, so re-posting the same batch is a
 * safe no-op on the ERP side.
 */
export type ExportFormat = 'csv' | 'sap_idoc' | 'json';

export interface CostLine {
  tripId: string;
  costCenter: string;
  amount: number;
  currency: string;
  serviceDate: string; // YYYY-MM-DD
}

export interface ExportRequest {
  periodStart: string;
  periodEnd: string;
  format: ExportFormat;
  lines: readonly CostLine[];
}

export interface ExportResult {
  idempotencyKey: string;
  format: ExportFormat;
  total: number;
  currency: string;
  lineCount: number;
  content: string;
}

export function buildErpExport(req: ExportRequest): ExportResult {
  if (req.lines.length === 0) throw new Error('nothing to export');
  const currency = req.lines[0]!.currency;
  if (!req.lines.every((l) => l.currency === currency)) {
    throw new Error('mixed currencies in one export');
  }

  const total = round2(req.lines.reduce((s, l) => s + l.amount, 0));
  const idempotencyKey = deriveKey(req);
  const content =
    req.format === 'csv'
      ? toCsv(req.lines)
      : req.format === 'json'
        ? JSON.stringify({ period: [req.periodStart, req.periodEnd], lines: req.lines })
        : toIdoc(req, total, currency);

  return {
    idempotencyKey,
    format: req.format,
    total,
    currency,
    lineCount: req.lines.length,
    content,
  };
}

function deriveKey(req: ExportRequest): string {
  // Order-independent: sort a canonical projection so the key is stable.
  const canonical = [...req.lines]
    .map((l) => `${l.tripId}|${l.costCenter}|${l.amount}|${l.serviceDate}`)
    .sort()
    .join('\n');
  const h = createHash('sha256')
    .update(`${req.periodStart}:${req.periodEnd}:${req.format}\n${canonical}`)
    .digest('hex');
  return `erp_${h.slice(0, 32)}`;
}

function toCsv(lines: readonly CostLine[]): string {
  const header = 'trip_id,cost_center,amount,currency,service_date';
  const rows = lines.map(
    (l) => `${l.tripId},${l.costCenter},${l.amount},${l.currency},${l.serviceDate}`,
  );
  return [header, ...rows].join('\n');
}

/** Minimal SAP IDoc-ish envelope (ACC_DOCUMENT-style line items). */
function toIdoc(req: ExportRequest, total: number, currency: string): string {
  const segments = req.lines.map(
    (l, i) =>
      `E1FISEG|POSNR=${String(i + 1).padStart(3, '0')}|KOSTL=${l.costCenter}` +
      `|WRBTR=${l.amount.toFixed(2)}|WAERS=${currency}|BUDAT=${l.serviceDate.replace(/-/g, '')}`,
  );
  return [
    `EDI_DC40|MESTYP=ACC_DOCUMENT|BEGDA=${req.periodStart.replace(/-/g, '')}|ENDDA=${req.periodEnd.replace(/-/g, '')}`,
    `E1FIKPF|TOTAL=${total.toFixed(2)}|WAERS=${currency}|ITEMS=${req.lines.length}`,
    ...segments,
  ].join('\n');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
