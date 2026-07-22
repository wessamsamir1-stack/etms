import { createHash, randomBytes } from 'node:crypto';

/** Opaque refresh token (never stored in plaintext — only its hash is). */
export function newOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
