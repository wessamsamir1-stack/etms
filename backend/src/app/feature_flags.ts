import { ApiError, getPrincipal } from './middleware/context';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db/pool';

/**
 * Runtime enforcement of the Super-Admin per-tenant feature flags (tenant_feature,
 * V0023). Features are **opt-out**: enabled for every company unless a flag row
 * explicitly sets enabled=false — so disabling a feature for one company (via the
 * platform API) blocks it here, while everyone else is unaffected.
 *
 * The per-tenant disabled set is cached briefly to keep this off the hot path;
 * a same-process toggle invalidates the cache immediately (invalidate()), and
 * cross-process changes take effect within the TTL.
 */
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; disabled: Set<string> }>();

/** Drop a tenant's cached flags (called when the platform API toggles a flag). */
export function invalidateFeatureCache(tenantId: string): void {
  cache.delete(tenantId);
}

/** Whether a feature is disabled for a tenant — for call sites that authenticate
 *  by hand (e.g. the SSE stream) rather than via the `authenticate` preHandler. */
export async function isFeatureDisabled(db: Db, tenantId: string, userId: string, name: string): Promise<boolean> {
  return (await disabledFeatures(db, tenantId, userId)).has(name);
}

async function disabledFeatures(db: Db, tenantId: string, userId: string): Promise<Set<string>> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.disabled;
  const rows = await db.withTenant(tenantId, userId, (c) =>
    c.query<{ feature: string }>(`SELECT feature FROM tenant_feature WHERE enabled = false`),
  );
  const disabled = new Set(rows.rows.map((r) => r.feature));
  cache.set(tenantId, { at: Date.now(), disabled });
  return disabled;
}

/**
 * Route guard: 403 when the caller's company has this feature disabled. Runs
 * after `authenticate` (needs the principal). A no-op when the DB is
 * unconfigured (tests) so it never blocks a DB-less server.
 */
export function requireFeature(db: Db | null | undefined, name: string) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!db) return;
    const p = getPrincipal(req);
    const disabled = await disabledFeatures(db, p.tenantId, p.userId);
    if (disabled.has(name)) {
      throw new ApiError(403, 'FEATURE_DISABLED', `The '${name}' feature is not enabled for your company`);
    }
  };
}
