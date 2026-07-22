import { FastifyReply, FastifyRequest } from 'fastify';
import { Principal } from '../../domain/access/rbac';
import { verifyJwt } from '../../util/jwt';

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

/** Problem+json error shape (RFC 9457), matching docs/etms/06 §3. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Authenticates the request from a Bearer JWT and attaches the [Principal].
 * Permissions + tenant + ABAC scope are carried as JWT claims (minted at login
 * from `v_user_effective_permissions`), keeping the API stateless.
 */
export function authenticate(jwtSecret: string) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Missing bearer token');
    }
    const now = Math.floor(Date.now() / 1000);
    const res = verifyJwt(header.slice(7), jwtSecret, now);
    if (!res.valid) {
      throw new ApiError(401, 'UNAUTHENTICATED', `Invalid token (${res.reason})`);
    }
    const { claims } = res;
    req.principal = {
      userId: claims.sub,
      tenantId: claims.tenant_id,
      permissions: new Set(claims.permissions ?? []),
      scopeSiteIds: claims.scope_site_ids ?? null,
      mfa: claims.mfa === true,
    };
  };
}

export function getPrincipal(req: FastifyRequest): Principal {
  if (!req.principal) throw new ApiError(401, 'UNAUTHENTICATED', 'Not authenticated');
  return req.principal;
}

/** Route guard: require a specific permission (RBAC). */
export function requirePermission(permission: string) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const principal = getPrincipal(req);
    if (!principal.permissions.has(permission)) {
      throw new ApiError(403, 'FORBIDDEN', `Requires ${permission}`);
    }
  };
}

/** Route guard: require a recent MFA step-up (docs/etms/04 §6 sensitive actions). */
export function requireMfa() {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!getPrincipal(req).mfa) {
      throw new ApiError(403, 'MFA_REQUIRED', 'Step-up authentication is required');
    }
  };
}
