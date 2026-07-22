import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { InMemoryProvider, NotificationDispatcher } from '../domain/notifications/channels';
import {
  MessageTooLongError,
  NotificationService,
  TemplateNotFoundError,
} from '../domain/notifications/service';
import { ApiError, authenticate, getPrincipal, requirePermission } from './middleware/context';
import { parse } from './validate';
import type { Deps } from './routes';

/**
 * Notification send + history. A dispatcher is composed with one provider per
 * channel — here the in-memory provider (records instead of sending) so the flow
 * works end-to-end in this build; swap in real SMS/WhatsApp/email/push gateways
 * (each a ChannelProvider) without changing the service or routes.
 */
export async function registerNotificationRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  const auth = authenticate(config.jwtSecret);

  const dispatcher = new NotificationDispatcher()
    .register(new InMemoryProvider('push'))
    .register(new InMemoryProvider('sms'))
    .register(new InMemoryProvider('email'))
    .register(new InMemoryProvider('whatsapp'));

  app.post('/v1/notifications/send', { preHandler: [auth, requirePermission('notification.send')] }, async (req) => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    const b = parse(
      z.object({
        channel: z.enum(['push', 'sms', 'email', 'whatsapp']),
        templateCode: z.string(),
        locale: z.string().default('ar'),
        to: z.string().min(1),
        userId: z.string().uuid().optional(),
        vars: z.record(z.union([z.string(), z.number()])).default({}),
      }),
      req.body,
    );
    const p = getPrincipal(req);
    const service = new NotificationService(db, dispatcher);
    try {
      return await service.send(p.tenantId, p.userId, b);
    } catch (e) {
      if (e instanceof TemplateNotFoundError) throw new ApiError(422, 'VALIDATION_ERROR', e.message);
      if (e instanceof MessageTooLongError) throw new ApiError(422, 'VALIDATION_ERROR', e.message);
      throw e;
    }
  });

  app.get('/v1/notifications', { preHandler: [auth, requirePermission('notification.send')] }, async (req) => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    const q = parse(z.object({ status: z.string().optional() }), req.query);
    const p = getPrincipal(req);
    const rows = await db.withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `SELECT id, channel, template_code, status, created_at, sent_at
         FROM notification ${q.status ? 'WHERE status=$1' : ''}
         ORDER BY created_at DESC LIMIT 200`,
        q.status ? [q.status] : [],
      ),
    );
    return { data: rows.rows };
  });
}
