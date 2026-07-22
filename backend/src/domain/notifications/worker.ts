import type { Db } from '../../app/db/pool';
import { NotificationDispatcher, OutboundMessage } from './channels';
import { messageFromRow, planRetry, NotificationRow } from './outbox';

export interface OutboxTickResult {
  picked: number;
  sent: number;
  failed: number;
  requeued: number;
}

export interface OutboxWorkerOptions {
  batchSize?: number;
  maxAttempts?: number;
  /** Visibility lease: claimed rows are hidden this long so a crash re-delivers. */
  leaseSeconds?: number;
}

/**
 * Drains the `notification` outbox table and delivers each row via the channel
 * dispatcher. Runs as a STANDALONE process (scripts/notification-worker), so it
 * connects with a BYPASSRLS role and works across all tenants — the endpoints
 * only enqueue; this is what actually sends.
 *
 * Concurrency-safe: each tick claims a batch with `FOR UPDATE SKIP LOCKED`, so
 * several worker replicas never deliver the same row twice. Transient failures
 * are re-queued with exponential backoff (V0026) until `maxAttempts`.
 */
export class OutboxWorker {
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly leaseSeconds: number;

  constructor(
    private readonly db: Db,
    private readonly dispatcher: NotificationDispatcher,
    opts: OutboxWorkerOptions = {},
  ) {
    this.batchSize = opts.batchSize ?? 50;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.leaseSeconds = opts.leaseSeconds ?? 60;
  }

  /** Resolve the deliverable message; for push, look up the user's device token. */
  private async buildMessage(row: NotificationRow): Promise<OutboundMessage> {
    const msg = messageFromRow(row);
    if (row.channel === 'push' && row.user_id && (msg.to === row.user_id || msg.to === 'unknown')) {
      const t = await this.db.query<{ token: string }>(
        `SELECT token FROM device_token WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [row.user_id],
      );
      if (t[0]?.token) msg.to = t[0].token;
    }
    return msg;
  }

  /**
   * Process one batch. Rows are CLAIMED in a short transaction (leased by pushing
   * next_attempt_at forward so peers skip them), then delivered OUTSIDE any
   * transaction — a slow/hung provider never holds row locks or a pooled
   * connection, and a crash mid-batch re-delivers once the lease expires
   * (at-least-once).
   */
  async tick(): Promise<OutboxTickResult> {
    const claimed = await this.db.tx(async (c) => {
      const { rows } = await c.query<NotificationRow>(
        `UPDATE notification
            SET next_attempt_at = now() + ($2::int * interval '1 second')
          WHERE id IN (
            SELECT id FROM notification
             WHERE status='queued' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
             ORDER BY created_at
             FOR UPDATE SKIP LOCKED
             LIMIT $1)
          RETURNING id, tenant_id, user_id, channel, template_code, payload, attempts`,
        [this.batchSize, this.leaseSeconds],
      );
      return rows;
    });

    const res: OutboxTickResult = { picked: claimed.length, sent: 0, failed: 0, requeued: 0 };
    for (const row of claimed) {
      const result = await this.dispatcher.dispatch(await this.buildMessage(row));
      const plan = planRetry(row.attempts, result.ok, this.maxAttempts);
      await this.db.query(
        `UPDATE notification
            SET status=$2,
                attempts=$3,
                provider_ref=$4,
                error=$5,
                next_attempt_at = CASE WHEN $6::int IS NULL THEN NULL
                                       ELSE now() + ($6::int * interval '1 second') END,
                sent_at = CASE WHEN $2='sent' THEN now() ELSE sent_at END
          WHERE id=$1`,
        [row.id, plan.status, plan.attempts, result.providerRef ?? null, result.ok ? null : (result.error ?? 'delivery failed'), plan.retryInSeconds],
      );
      if (plan.status === 'sent') res.sent++;
      else if (plan.status === 'failed') res.failed++;
      else res.requeued++;
    }
    return res;
  }

  /**
   * Poll forever until `signal` aborts, sleeping `intervalMs` between empty
   * ticks. Never throws out of the loop — a tick error is logged and retried.
   */
  async run(signal: AbortSignal, intervalMs = 2000, log: (m: string) => void = () => {}): Promise<void> {
    while (!signal.aborted) {
      try {
        const r = await this.tick();
        if (r.picked > 0) log(`outbox: picked=${r.picked} sent=${r.sent} requeued=${r.requeued} failed=${r.failed}`);
      } catch (e) {
        log(`outbox tick error: ${(e as Error).message}`);
      }
      if (signal.aborted) break;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
