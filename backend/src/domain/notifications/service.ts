import type { Db } from '../../app/db/pool';
import { NotificationDispatcher, OutboundMessage } from './channels';
import { InMemoryQueue } from './queue';
import { Channel, render, withinLimit } from './template';

export interface SendRequest {
  channel: Channel;
  templateCode: string;
  locale: string;
  to: string;
  userId?: string;
  vars: Record<string, string | number>;
}

interface Queued {
  id: string;
  tenantId: string;
  userId: string;
  msg: OutboundMessage;
}

export class TemplateNotFoundError extends Error {}
export class MessageTooLongError extends Error {}

/**
 * Notification System composition (docs/etms/05 §9):
 *   DB template → render({{vars}}) → persist (queued) → enqueue → worker drains
 *   → dispatch via the channel provider → update delivery status.
 * The queue makes delivery async and retryable; here send() also drains inline
 * so callers get the final status (a standalone worker calls drain() in prod).
 */
export class NotificationService {
  private readonly queue = new InMemoryQueue<Queued>();

  constructor(
    private readonly db: Db,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  async send(tenantId: string, actorUserId: string, req: SendRequest): Promise<{ id: string; status: string }> {
    const tpl = (
      await this.db.withTenant(tenantId, actorUserId, (c) =>
        c.query<{ subject: string | null; body: string }>(
          `SELECT subject, body FROM notification_template
           WHERE tenant_id=$1 AND code=$2 AND channel=$3 AND locale=$4 AND active`,
          [tenantId, req.templateCode, req.channel, req.locale],
        ),
      )
    ).rows[0];
    if (!tpl) throw new TemplateNotFoundError(`No active template ${req.templateCode}/${req.channel}/${req.locale}`);

    const { text } = render(tpl.body, req.vars);
    if (!withinLimit(req.channel, text)) throw new MessageTooLongError(`Body exceeds ${req.channel} limit`);

    const row = (
      await this.db.withTenant(tenantId, actorUserId, (c) =>
        c.query<{ id: string }>(
          `INSERT INTO notification(tenant_id, user_id, channel, template_code, payload, status)
           VALUES ($1,$2,$3,$4,$5,'queued') RETURNING id`,
          [tenantId, req.userId ?? null, req.channel, req.templateCode, JSON.stringify({ to: req.to, text })],
        ),
      )
    ).rows[0]!;

    this.queue.enqueue({
      id: row.id,
      tenantId,
      userId: actorUserId,
      msg: { channel: req.channel, to: req.to, subject: tpl.subject ?? undefined, body: text },
    });

    await this.drain();

    const status = (
      await this.db.withTenant(tenantId, actorUserId, (c) =>
        c.query<{ status: string }>('SELECT status FROM notification WHERE id=$1', [row.id]),
      )
    ).rows[0]!.status;
    return { id: row.id, status };
  }

  /** Drain the queue: dispatch each message and record its delivery outcome. */
  async drain(): Promise<number> {
    return this.queue.drain(async (item) => {
      const result = await this.dispatcher.dispatch(item.msg);
      await this.db.withTenant(item.tenantId, item.userId, (c) =>
        c.query(
          `UPDATE notification
           SET status=$2, provider_ref=$3, error=$4, sent_at = CASE WHEN $2='sent' THEN now() ELSE sent_at END
           WHERE id=$1`,
          [item.id, result.ok ? 'sent' : 'failed', result.providerRef ?? null, result.error ?? null],
        ),
      );
    });
  }
}
