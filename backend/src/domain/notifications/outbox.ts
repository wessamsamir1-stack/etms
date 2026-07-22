import { Channel } from './template';
import { OutboundMessage } from './channels';

/** A `notification` outbox row as the worker reads it. */
export interface NotificationRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  channel: Channel;
  template_code: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * Build a deliverable message from an outbox row. Two producers write the
 * payload: NotificationService (`{ to, text, subject? }`) and the manifest /
 * ride-request endpoints (`{ tripId, message: { ar, en } }`). This normalizes
 * both into one OutboundMessage. Pure — unit-tested without a DB.
 */
export function messageFromRow(row: NotificationRow): OutboundMessage {
  const p = (row.payload ?? {}) as {
    to?: string;
    text?: string;
    subject?: string;
    message?: { ar?: string; en?: string };
  };
  const recipient = p.to ?? row.user_id ?? 'unknown';
  let body: string;
  if (typeof p.text === 'string') body = p.text;
  else if (p.message && (p.message.ar || p.message.en)) {
    body = [p.message.ar, p.message.en].filter(Boolean).join('\n');
  } else body = JSON.stringify(p);
  return { channel: row.channel, to: recipient, subject: p.subject, body };
}

/** Exponential backoff (seconds) for the Nth retry: base·2^attempts, capped. */
export function nextBackoffSeconds(attempts: number, baseSeconds = 30, capSeconds = 3600): number {
  const n = Math.max(0, attempts);
  return Math.min(capSeconds, baseSeconds * 2 ** n);
}

export interface RetryOutcome {
  status: 'sent' | 'failed' | 'queued';
  attempts: number;
  /** seconds until the next attempt when re-queued; null otherwise */
  retryInSeconds: number | null;
}

/**
 * Decide the row's next state after a delivery attempt. Success → sent. Failure
 * → re-queued with backoff until `maxAttempts` is reached, then failed (dead).
 */
export function planRetry(prevAttempts: number, ok: boolean, maxAttempts = 5): RetryOutcome {
  const attempts = prevAttempts + 1;
  if (ok) return { status: 'sent', attempts, retryInSeconds: null };
  if (attempts >= maxAttempts) return { status: 'failed', attempts, retryInSeconds: null };
  return { status: 'queued', attempts, retryInSeconds: nextBackoffSeconds(attempts) };
}
