import { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from './context';

/**
 * Fixed-window rate limiter (pure, deterministic with an injected clock — unit
 * tested). Suitable for protecting login/OTP from brute force. For multi-instance
 * deployments back this with Redis; the interface stays the same.
 */
export class FixedWindowLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  check(key: string, now: number): { allowed: boolean; retryAfterMs: number } {
    const e = this.hits.get(key);
    if (!e || now >= e.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (e.count >= this.max) {
      return { allowed: false, retryAfterMs: e.resetAt - now };
    }
    e.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }
}

/** Fastify preHandler that enforces a limiter, keyed by client IP by default. */
export function rateLimit(
  limiter: FixedWindowLimiter,
  keyFn: (req: FastifyRequest) => string = (req) => req.ip,
) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const { allowed, retryAfterMs } = limiter.check(keyFn(req), Date.now());
    if (!allowed) {
      reply.header('Retry-After', Math.ceil(retryAfterMs / 1000));
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests');
    }
  };
}
