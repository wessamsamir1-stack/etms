import { Db } from '../app/db/pool';
import { OutboxWorker } from '../domain/notifications/worker';
import { buildDispatcher } from '../domain/notifications/providers';

/**
 * Standalone notification worker: drains the `notification` outbox table and
 * delivers each message via the channel provider. The endpoints only ENQUEUE
 * (bus arrived, No-Show, OTP, ride offers, template sends); this process is what
 * actually SENDS them.
 *
 * Connects with a BYPASSRLS role so it works across all tenants (like the
 * platform layer). Point it at that connection:
 *   WORKER_DATABASE_URL=postgres://etms_platform_login:***@host/etms \
 *     node dist/scripts/notification-worker.js
 * Falls back to PLATFORM_DATABASE_URL, then DATABASE_URL.
 *
 * Env: WORKER_INTERVAL_MS (default 2000), WORKER_BATCH (default 50),
 *      WORKER_MAX_ATTEMPTS (default 5), WORKER_ONCE=1 to run a single tick.
 */
async function main(): Promise<void> {
  const url =
    process.env.WORKER_DATABASE_URL ?? process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('WORKER_DATABASE_URL (or PLATFORM_DATABASE_URL / DATABASE_URL) is required');

  const db = Db.fromUrl(url);
  const worker = new OutboxWorker(db, buildDispatcher(), {
    batchSize: Number(process.env.WORKER_BATCH ?? 50),
    maxAttempts: Number(process.env.WORKER_MAX_ATTEMPTS ?? 5),
  });

  if (process.env.WORKER_ONCE === '1') {
    const r = await worker.tick();
    console.log(`outbox tick: picked=${r.picked} sent=${r.sent} requeued=${r.requeued} failed=${r.failed}`);
    await db.close();
    return;
  }

  const controller = new AbortController();
  const stop = async (): Promise<void> => {
    controller.abort();
    await db.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  console.log('notification worker started (in-memory providers; set gateway keys to deliver for real)');
  await worker.run(controller.signal, Number(process.env.WORKER_INTERVAL_MS ?? 2000), (m) => console.log(m));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
