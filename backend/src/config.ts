/** Environment-resolved configuration (no secrets in code). */
export interface Config {
  port: number;
  databaseUrl: string | undefined;
  /**
   * Connection for the cross-tenant Super-Admin platform API. Should point at a
   * BYPASSRLS role (etms_platform_login). Falls back to databaseUrl when unset —
   * convenient for local/dev where the connection is already an owner/superuser.
   */
  platformDatabaseUrl?: string | undefined;
  jwtSecret: string;
  qrSecret: string;
  env: string;
  /** CORS allowed origin for the web dashboard (e.g. '*'); off when unset. */
  corsOrigin?: string | undefined;
  /**
   * Field-encryption keyring for sensitive PII (home/pickup address). Spec:
   * `id:base64key[,id2:base64key2]` — first key is active, rest decrypt-only
   * (rotation). Unset → encryption off (plaintext passthrough).
   */
  fieldEncryptionKeys?: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8080),
    databaseUrl: env.DATABASE_URL,
    platformDatabaseUrl: env.PLATFORM_DATABASE_URL ?? env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET ?? 'dev-jwt-secret-change-me',
    qrSecret: env.QR_SECRET ?? 'dev-qr-secret-change-me',
    env: env.NODE_ENV ?? 'development',
    corsOrigin: env.CORS_ORIGIN,
    fieldEncryptionKeys: env.FIELD_ENCRYPTION_KEYS,
  };
}
