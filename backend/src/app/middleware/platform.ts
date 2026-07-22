import { FastifyReply, FastifyRequest } from 'fastify';
import { verifyJwt } from '../../util/jwt';
import { ApiError } from './context';

/** The authenticated platform (Super-Admin) operator, from a `platform:true` JWT. */
export interface PlatformPrincipal {
  adminId: string;
  mfa: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    platform?: PlatformPrincipal;
  }
}

/**
 * Authenticates a cross-tenant platform request. Platform tokens are minted by
 * `POST /v1/platform/login` and carry `platform:true` (and NO tenant_id) — a
 * tenant user's token can never satisfy this guard, and vice-versa, keeping the
 * Super-Admin surface strictly separate from the tenant-scoped API.
 */
export function authenticatePlatform(jwtSecret: string) {
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
    if (res.claims.platform !== true) {
      throw new ApiError(403, 'FORBIDDEN', 'Platform (Super-Admin) token required');
    }
    req.platform = { adminId: res.claims.sub, mfa: res.claims.mfa === true };
  };
}

export function getPlatform(req: FastifyRequest): PlatformPrincipal {
  if (!req.platform) throw new ApiError(401, 'UNAUTHENTICATED', 'Not authenticated');
  return req.platform;
}
