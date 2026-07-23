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

const DEFAULT_JWT_SECRET = 'dev-jwt-secret-change-me';
const DEFAULT_QR_SECRET = 'dev-qr-secret-change-me';
const MIN_SECRET_LENGTH = 32;

/**
 * Resolves a security-critical secret. In production the value must be set,
 * differ from the built-in default, and be at least 32 chars — otherwise we
 * throw at boot rather than run with a weak/known secret. In dev/test the
 * default is allowed as a convenience.
 */
function resolveSecret(
  name: string,
  value: string | undefined,
  defaultValue: string,
  isProduction: boolean,
): string {
  if (!isProduction) return value ?? defaultValue;

  if (!value) {
    throw new Error(`${name} must be set in production.`);
  }
  if (value === defaultValue) {
    throw new Error(`${name} must not use the default value in production.`);
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} must be at least ${MIN_SECRET_LENGTH} characters in production.`,
    );
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  return {
    port: Number(env.PORT ?? 8080),
    databaseUrl: env.DATABASE_URL,
    platformDatabaseUrl: env.PLATFORM_DATABASE_URL ?? env.DATABASE_URL,
    jwtSecret: resolveSecret('JWT_SECRET', env.JWT_SECRET, DEFAULT_JWT_SECRET, isProduction),
    qrSecret: resolveSecret('QR_SECRET', env.QR_SECRET, DEFAULT_QR_SECRET, isProduction),
    env: nodeEnv,
    corsOrigin: env.CORS_ORIGIN,
    fieldEncryptionKeys: env.FIELD_ENCRYPTION_KEYS,
  };
}
