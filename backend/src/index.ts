import { loadConfig } from './config';
import { buildServer } from './app/server';
import { Db } from './app/db/pool';
import { FieldCrypto } from './util/field_crypto';

/** Composition root: resolve config, connect DB (if configured), start server. */
async function main(): Promise<void> {
  const config = loadConfig();
  // Queries go through the connection pooler; the realtime LISTEN/NOTIFY
  // connection goes straight to Postgres (see Config.listenerDatabaseUrl).
  const db = config.databaseUrl ? Db.fromUrl(config.databaseUrl, config.listenerDatabaseUrl) : null;
  // Cross-tenant platform (Super-Admin) connection — a BYPASSRLS role. Reuse the
  // main pool when both URLs resolve to the same connection string.
  const platformDb =
    config.platformDatabaseUrl && config.platformDatabaseUrl !== config.databaseUrl
      ? Db.fromUrl(config.platformDatabaseUrl)
      : db;

  const fieldCrypto = FieldCrypto.fromEnv(config.fieldEncryptionKeys);
  const app = await buildServer({ config, db, platformDb, fieldCrypto });
  await app.listen({ port: config.port, host: '0.0.0.0' });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await db?.close();
    if (platformDb && platformDb !== db) await platformDb.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
