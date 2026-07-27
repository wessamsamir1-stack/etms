import type { PoolClient } from 'pg';

/**
 * Enqueue a push notification per recipient into the `notification` outbox
 * (status 'queued'). A worker + push provider delivers queued rows — see
 * domain/notifications/worker.ts. Recipients without a linked login are skipped.
 */
export async function enqueuePush(
  c: PoolClient,
  recipients: ReadonlyArray<{ user_id: string | null }>,
  templateCode: string,
  tripId: string,
  message: { ar: string; en: string },
  extra: Record<string, unknown> = {},
): Promise<number> {
  let n = 0;
  for (const r of recipients) {
    if (!r.user_id) continue;
    await c.query(
      `INSERT INTO notification(tenant_id, user_id, channel, template_code, payload, status)
       VALUES (app_current_tenant(), $1, 'push', $2, $3::jsonb, 'queued')`,
      [r.user_id, templateCode, JSON.stringify({ tripId, message, ...extra })],
    );
    n++;
  }
  return n;
}
