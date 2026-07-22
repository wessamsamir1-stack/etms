import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, authenticate, getPrincipal, requireMfa, requirePermission } from './middleware/context';
import { parse } from './validate';
import type { Deps } from './routes';

const uuid = z.object({ id: z.string().uuid() });

/**
 * Permission catalog + per-role permission grants (the Roles matrix in the admin
 * portal). Roles CRUD is handled by the generic factory; here we expose the
 * catalog and grant/revoke on `role_permission`. Editing grants is sensitive →
 * requires role.manage + MFA, and only the tenant's own roles (not system
 * templates) may be modified.
 */
export async function registerRoleRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, config } = deps;
  const auth = authenticate(config.jwtSecret);
  const requireDb = () => {
    if (!db) throw new ApiError(503, 'INTERNAL', 'Database not configured');
    return db;
  };

  // Global permission catalog.
  app.get('/v1/permissions', { preHandler: [auth, requirePermission('role.read')] }, async (req) => {
    const p = getPrincipal(req);
    const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query('SELECT id, code, description FROM permission ORDER BY code'),
    );
    return { data: rows.rows };
  });

  // Permission ids granted to a role.
  app.get('/v1/roles/:id/permissions', { preHandler: [auth, requirePermission('role.read')] }, async (req) => {
    const { id } = parse(uuid, req.params);
    const p = getPrincipal(req);
    const rows = await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query('SELECT permission_id FROM role_permission WHERE role_id=$1', [id]),
    );
    return { data: rows.rows.map((r) => r.permission_id) };
  });

  // Ensure the role is the caller's own tenant role (not a system template).
  const assertTenantRole = async (
    tenantId: string,
    userId: string,
    roleId: string,
  ): Promise<void> => {
    const role = (
      await requireDb().withTenant(tenantId, userId, (c) =>
        c.query<{ tenant_id: string | null }>('SELECT tenant_id FROM role WHERE id=$1', [roleId]),
      )
    ).rows[0];
    if (!role) throw new ApiError(404, 'NOT_FOUND', 'Role not found');
    if (role.tenant_id === null) throw new ApiError(403, 'FORBIDDEN', 'System roles cannot be edited');
  };

  app.post('/v1/roles/:id/permissions', { preHandler: [auth, requirePermission('role.manage'), requireMfa()] }, async (req, reply) => {
    const { id } = parse(uuid, req.params);
    const b = parse(z.object({ permissionId: z.string().uuid() }), req.body);
    const p = getPrincipal(req);
    await assertTenantRole(p.tenantId, p.userId, id);
    await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query(
        `INSERT INTO role_permission(role_id, permission_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [id, b.permissionId],
      ),
    );
    reply.code(201);
    return { ok: true };
  });

  app.delete('/v1/roles/:id/permissions/:permissionId', { preHandler: [auth, requirePermission('role.manage'), requireMfa()] }, async (req, reply) => {
    const params = parse(z.object({ id: z.string().uuid(), permissionId: z.string().uuid() }), req.params);
    const p = getPrincipal(req);
    await assertTenantRole(p.tenantId, p.userId, params.id);
    await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query('DELETE FROM role_permission WHERE role_id=$1 AND permission_id=$2', [params.id, params.permissionId]),
    );
    reply.code(204);
    return null;
  });

  // ---- Assign / revoke a role to a user (user_role) -----------------------
  // The account→role link. Accepts a tenant role or a system template (driver /
  // rider / dispatcher …). Sensitive → user.manage + MFA.
  app.post('/v1/users/:id/roles', { preHandler: [auth, requirePermission('user.manage'), requireMfa()] }, async (req, reply) => {
    const { id } = parse(uuid, req.params);
    const b = parse(z.object({ roleId: z.string().uuid() }).or(z.object({ roleCode: z.string().min(1) })), req.body);
    const p = getPrincipal(req);
    await requireDb().withTenant(p.tenantId, p.userId, async (c) => {
      const user = (await c.query('SELECT id FROM app_user WHERE id=$1 AND deleted_at IS NULL', [id])).rows[0];
      if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
      const role = (
        'roleId' in b
          ? await c.query('SELECT id FROM role WHERE id=$1 AND (tenant_id=app_current_tenant() OR tenant_id IS NULL)', [b.roleId])
          : await c.query('SELECT id FROM role WHERE code=$1 AND (tenant_id=app_current_tenant() OR tenant_id IS NULL) ORDER BY tenant_id NULLS LAST LIMIT 1', [b.roleCode])
      ).rows[0];
      if (!role) throw new ApiError(422, 'VALIDATION_ERROR', 'Role not found');
      await c.query(
        `INSERT INTO user_role(tenant_id, user_id, role_id, granted_by)
         VALUES (app_current_tenant(),$1,$2,$3) ON CONFLICT DO NOTHING`,
        [id, role.id, p.userId],
      );
    });
    reply.code(201);
    return { ok: true };
  });

  app.delete('/v1/users/:id/roles/:roleId', { preHandler: [auth, requirePermission('user.manage'), requireMfa()] }, async (req, reply) => {
    const params = parse(z.object({ id: z.string().uuid(), roleId: z.string().uuid() }), req.params);
    const p = getPrincipal(req);
    await requireDb().withTenant(p.tenantId, p.userId, (c) =>
      c.query('DELETE FROM user_role WHERE user_id=$1 AND role_id=$2', [params.id, params.roleId]),
    );
    reply.code(204);
    return null;
  });
}
