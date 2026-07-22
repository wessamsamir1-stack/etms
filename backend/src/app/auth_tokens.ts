import { signJwt } from '../util/jwt';
import { hashToken, newOpaqueToken } from '../util/tokens';
import type { Config } from '../config';
import type { Db } from './db/pool';

export const ACCESS_TTL_SECONDS = 8 * 3600;
export const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;

/** Effective permission codes for a user (auth_permissions, V0014). */
export async function loadPermissions(db: Db, userId: string): Promise<string[]> {
  const rows = await db.query<{ code: string }>('SELECT p AS code FROM auth_permissions($1) p', [userId]);
  return rows.map((r) => r.code);
}

/** Effective branch scope: null = tenant-wide, else the limited sites (V0025). */
export async function loadScope(db: Db, userId: string): Promise<string[] | null> {
  const rows = await db.query<{ scope: string[] | null }>('SELECT auth_scope_site_ids($1) AS scope', [userId]);
  return rows[0]?.scope ?? null;
}

export function mintAccess(
  userId: string,
  tenantId: string,
  perms: string[],
  scope: string[] | null,
  secret: string,
): string {
  const exp = Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS;
  return signJwt({ sub: userId, tenant_id: tenantId, permissions: perms, scope_site_ids: scope, exp }, secret);
}

export async function issueRefresh(db: Db, tenantId: string, userId: string): Promise<string> {
  const token = newOpaqueToken();
  await db.withTenant(tenantId, userId, (c) =>
    c.query(
      `INSERT INTO user_session(tenant_id, user_id, refresh_token_hash, expires_at) VALUES ($1,$2,$3,$4)`,
      [tenantId, userId, hashToken(token), new Date(Date.now() + REFRESH_TTL_MS)],
    ),
  );
  return token;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  permissions: string[];
}

/**
 * Mint a full session (access JWT + rotating refresh token) for a user. Shared by
 * password login and SSO so both paths produce identical, permission-scoped
 * sessions.
 */
export async function issueSession(db: Db, config: Config, userId: string, tenantId: string): Promise<Session> {
  const permissions = await loadPermissions(db, userId);
  const scope = await loadScope(db, userId);
  const refresh_token = await issueRefresh(db, tenantId, userId);
  return {
    access_token: mintAccess(userId, tenantId, permissions, scope, config.jwtSecret),
    refresh_token,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SECONDS,
    permissions,
  };
}
