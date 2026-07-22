import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, authenticate, getPrincipal, requirePermission } from './middleware/context';
import { parse } from './validate';
import type { Deps } from './routes';
import type { Db } from './db/pool';

interface ResourceRoute {
  path: string; // plural URL segment, e.g. 'sites'
  table: string; // DB table
  readPerm: string;
  writePerm: string;
  fields: readonly string[]; // whitelist of writable columns (code-defined, safe)
  softDelete: boolean;
  /**
   * Column that ties a row to a branch (site). When set, a branch-scoped
   * principal (JWT scope_site_ids) only sees/mutates rows whose site is in
   * scope. Unscoped principals (company/transport admin) are unaffected.
   */
  siteColumn?: string;
}

const RESOURCES: readonly ResourceRoute[] = [
  {
    path: 'users',
    table: 'app_user',
    readPerm: 'user.read',
    writePerm: 'user.manage',
    fields: ['full_name', 'email', 'phone', 'status', 'locale'],
    softDelete: true,
  },
  {
    // Brands sit between the company (tenant) and its branches (sites).
    path: 'brands',
    table: 'brand',
    readPerm: 'brand.read',
    writePerm: 'brand.manage',
    fields: ['name', 'code', 'status'],
    softDelete: true,
  },
  {
    // A "branch" / restaurant is a site; it belongs to a brand.
    path: 'sites',
    table: 'site',
    readPerm: 'site.read',
    writePerm: 'site.manage',
    fields: ['name', 'code', 'timezone', 'status', 'brand_id'],
    softDelete: true,
    siteColumn: 'id', // a branch admin sees/edits only its own branches
  },
  {
    path: 'vehicles',
    table: 'vehicle',
    readPerm: 'vehicle.read',
    writePerm: 'vehicle.manage',
    fields: ['vendor_id', 'plate_no', 'type', 'capacity', 'status', 'inspection_expiry', 'insurance_expiry'],
    softDelete: true,
  },
  {
    path: 'employees',
    table: 'employee',
    readPerm: 'employee.read',
    writePerm: 'employee.manage',
    fields: ['user_id', 'external_hr_id', 'full_name', 'department', 'brand_id', 'cost_center_id', 'default_site_id', 'default_shift_id', 'residence_id', 'eligible'],
    softDelete: true,
    siteColumn: 'default_site_id', // scoped to the employee's branch
  },
  {
    path: 'residences',
    table: 'residence',
    readPerm: 'site.read',
    writePerm: 'site.manage',
    fields: ['name', 'code', 'capacity', 'priority_weight', 'status'],
    softDelete: true,
  },
  {
    path: 'vendors',
    table: 'vendor',
    readPerm: 'vendor.read',
    writePerm: 'vendor.manage',
    fields: ['name', 'status'],
    softDelete: true,
  },
  {
    // Company branches (أفرع) and shops (محلات) with their codes. Residences
    // live in their own table (see /v1/residences).
    path: 'company-locations',
    table: 'company_location',
    readPerm: 'location.read',
    writePerm: 'location.manage',
    fields: ['kind', 'code', 'name', 'address', 'status'],
    softDelete: true,
  },
  {
    path: 'drivers',
    table: 'driver',
    readPerm: 'driver.read',
    writePerm: 'driver.manage',
    fields: ['vendor_id', 'user_id', 'full_name', 'phone', 'license_no', 'license_expiry', 'verification_status', 'availability'],
    softDelete: true,
  },
  {
    path: 'cost-centers',
    table: 'cost_center',
    readPerm: 'costcenter.read',
    writePerm: 'costcenter.manage',
    fields: ['code', 'name', 'parent_id'],
    softDelete: true,
  },
  {
    path: 'shifts',
    table: 'shift',
    readPerm: 'shift.read',
    writePerm: 'shift.manage',
    fields: ['site_id', 'name', 'start_time', 'end_time'],
    softDelete: true,
    siteColumn: 'site_id',
  },
  {
    path: 'routes',
    table: 'route',
    readPerm: 'route.read',
    writePerm: 'route.manage',
    fields: ['site_id', 'shift_id', 'name', 'direction', 'status'],
    softDelete: true,
    siteColumn: 'site_id',
  },
  {
    path: 'rate-cards',
    table: 'rate_card',
    readPerm: 'ratecard.read',
    writePerm: 'ratecard.manage',
    fields: ['vendor_id', 'name', 'model', 'rate', 'currency_code', 'min_charge', 'effective_from', 'effective_to'],
    softDelete: true,
  },
  {
    path: 'notification-templates',
    table: 'notification_template',
    readPerm: 'notification.template.manage',
    writePerm: 'notification.template.manage',
    fields: ['code', 'channel', 'locale', 'subject', 'body', 'active'],
    softDelete: false, // no deleted_at column
  },
  {
    // Tenant roles (RLS lets tenants read system templates but only write their own).
    path: 'roles',
    table: 'role',
    readPerm: 'role.read',
    writePerm: 'role.manage',
    fields: ['code', 'name', 'description'],
    softDelete: false,
  },
];

/** Maps Postgres error codes to the API error model (docs/etms/06 §3). */
function mapPgError(e: unknown): never {
  const code = (e as { code?: string }).code;
  switch (code) {
    case '23505':
      throw new ApiError(409, 'CONFLICT', 'Duplicate value');
    case '23502':
    case '23514':
    case '23503':
      throw new ApiError(422, 'VALIDATION_ERROR', (e as Error).message);
    case '42501':
      throw new ApiError(403, 'FORBIDDEN', 'Insufficient privilege');
    default:
      throw e as Error;
  }
}

function pick(body: unknown, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (body && typeof body === 'object') {
    for (const f of fields) {
      if (f in (body as Record<string, unknown>)) out[f] = (body as Record<string, unknown>)[f];
    }
  }
  return out;
}

/**
 * The branch-scope filter for a resource, or null when it does not apply
 * (resource not branch-linked, or an unscoped principal). Returns the SQL
 * fragment `<siteColumn> = ANY($n)` plus the value to bind, so callers can add
 * it to any query with the correct positional parameter index.
 */
export function siteScope(
  p: { scopeSiteIds?: readonly string[] | null },
  r: Pick<ResourceRoute, 'siteColumn'>,
  paramIndex: number,
): { clause: string; value: string[] } | null {
  const scope = p.scopeSiteIds;
  if (!r.siteColumn || !Array.isArray(scope) || scope.length === 0) return null;
  return { clause: `${r.siteColumn} = ANY($${paramIndex})`, value: [...scope] };
}

/**
 * Registers tenant-scoped, RBAC-guarded CRUD (list/create/update/delete) for
 * each configured resource. Every query runs inside `db.withTenant`, so Postgres
 * RLS enforces isolation and the caller never supplies tenant_id.
 */
export async function registerCrudRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  const auth = authenticate(config.jwtSecret);
  const requireDb = (): Db => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    return db;
  };

  for (const r of RESOURCES) {
    // LIST
    app.get(
      `/v1/${r.path}`,
      { preHandler: [auth, requirePermission(r.readPerm)] },
      async (req) => {
        const p = getPrincipal(req);
        const conds: string[] = [];
        const params: unknown[] = [];
        if (r.softDelete) conds.push('deleted_at IS NULL');
        const scope = siteScope(p, r, params.length + 1);
        if (scope) {
          params.push(scope.value);
          conds.push(scope.clause);
        }
        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
          c.query(`SELECT * FROM ${r.table} ${where} ORDER BY created_at DESC LIMIT 200`, params),
        );
        return { data: rows.rows };
      },
    );

    // CREATE
    app.post(
      `/v1/${r.path}`,
      { preHandler: [auth, requirePermission(r.writePerm)] },
      async (req, reply) => {
        const p = getPrincipal(req);
        const data = pick(req.body, r.fields);
        if (Object.keys(data).length === 0) {
          throw new ApiError(422, 'VALIDATION_ERROR', 'No writable fields provided');
        }
        // A branch-scoped principal may only create rows inside its branches. For
        // resources keyed on their own id (e.g. sites) this blocks creation
        // outright — a branch admin cannot mint new branches.
        if (siteScope(p, r, 0)) {
          const site = r.siteColumn === 'id' ? undefined : data[r.siteColumn!];
          if (!site || !(p.scopeSiteIds as string[]).includes(String(site))) {
            throw new ApiError(403, 'FORBIDDEN', 'Outside your branch scope');
          }
        }
        const cols = ['tenant_id', ...Object.keys(data)];
        const vals = [p.tenantId, ...Object.values(data)];
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
        try {
          const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
            c.query(
              `INSERT INTO ${r.table} (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`,
              vals,
            ),
          );
          reply.code(201);
          return { data: rows.rows[0] };
        } catch (e) {
          mapPgError(e);
        }
      },
    );

    // UPDATE
    app.patch(
      `/v1/${r.path}/:id`,
      { preHandler: [auth, requirePermission(r.writePerm)] },
      async (req) => {
        const p = getPrincipal(req);
        const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
        const data = pick(req.body, r.fields);
        if (Object.keys(data).length === 0) {
          throw new ApiError(422, 'VALIDATION_ERROR', 'No writable fields provided');
        }
        const values = Object.values(data);
        // A branch-scoped principal may not move a row to a branch outside scope.
        if (siteScope(p, r, 0) && r.siteColumn !== 'id' && r.siteColumn! in data) {
          const site = data[r.siteColumn!];
          if (!site || !(p.scopeSiteIds as string[]).includes(String(site))) {
            throw new ApiError(403, 'FORBIDDEN', 'Outside your branch scope');
          }
        }
        const sets = Object.keys(data).map((k, i) => `${k}=$${i + 2}`).join(',');
        const delFilter = r.softDelete ? 'AND deleted_at IS NULL' : '';
        // ...and may only update a row already inside its branches.
        const scope = siteScope(p, r, values.length + 2);
        const scopeFilter = scope ? `AND ${scope.clause}` : '';
        const scopeParams = scope ? [scope.value] : [];
        try {
          const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
            c.query(
              `UPDATE ${r.table} SET ${sets} WHERE id=$1 ${delFilter} ${scopeFilter} RETURNING *`,
              [id, ...values, ...scopeParams],
            ),
          );
          if (rows.rowCount === 0) throw new ApiError(404, 'NOT_FOUND', 'Not found');
          return { data: rows.rows[0] };
        } catch (e) {
          if (e instanceof ApiError) throw e;
          mapPgError(e);
        }
      },
    );

    // DELETE (soft where supported)
    app.delete(
      `/v1/${r.path}/:id`,
      { preHandler: [auth, requirePermission(r.writePerm)] },
      async (req, reply) => {
        const p = getPrincipal(req);
        const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
        const scope = siteScope(p, r, 2);
        const scopeFilter = scope ? `AND ${scope.clause}` : '';
        const params: unknown[] = scope ? [id, scope.value] : [id];
        const sql = r.softDelete
          ? `UPDATE ${r.table} SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL ${scopeFilter} RETURNING id`
          : `DELETE FROM ${r.table} WHERE id=$1 ${scopeFilter} RETURNING id`;
        const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) => c.query(sql, params));
        if (rows.rowCount === 0) throw new ApiError(404, 'NOT_FOUND', 'Not found');
        reply.code(204);
        return null;
      },
    );
  }
}
