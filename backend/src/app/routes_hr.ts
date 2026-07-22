import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { applyHrRecords } from '../domain/hr/hr_sync_service';
import { ApiError, authenticate, getPrincipal, requirePermission } from './middleware/context';
import { parse } from './validate';
import type { Deps } from './routes';

/**
 * HR sync (design §A.4.1). Accepts records directly (manual/file/SuccessFactors-
 * pushed) or, when none are supplied, pulls from the configured HrDirectoryPort
 * (the scheduled SuccessFactors delta). Upserts are idempotent → safe to re-run.
 */
export async function registerHrRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config, hrDirectory } = deps;
  const auth = authenticate(config.jwtSecret);

  app.post('/v1/hr/violations/sync', { preHandler: [auth, requirePermission('employee.import')] }, async (req) => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    const b = parse(
      z.object({
        records: z
          .array(
            z.object({
              externalRef: z.string(),
              transportBlock: z.boolean(),
              employmentEnded: z.boolean(),
              lastModified: z.string().optional(),
            }),
          )
          .optional(),
      }),
      req.body ?? {},
    );
    const p = getPrincipal(req);

    const records = b.records ?? (hrDirectory ? await hrDirectory.fetchChanges() : []);
    const summary = await db.withTenant(p.tenantId, p.userId, (c) =>
      applyHrRecords(c, p.tenantId, records),
    );
    return { source: b.records ? 'manual' : 'directory', ...summary };
  });
}
