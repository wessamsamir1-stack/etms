import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

/**
 * Idempotent, forward-only migration runner for production/CI (dev used the
 * Postgres image's one-shot initdb). Applies pending `db/migrations/V*.sql` in
 * order inside a transaction each, and records them in `schema_migrations` so
 * re-runs are safe no-ops.
 *
 * Run with an ADMIN connection (migrations create roles + SECURITY DEFINER
 * functions): the app itself connects as the non-superuser `etms_app` role.
 *   MIGRATE_DATABASE_URL=postgres://admin@host/etms \
 *   MIGRATIONS_DIR=/app/migrations node dist/scripts/migrate.js
 */
async function main(): Promise<void> {
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATE_DATABASE_URL (or DATABASE_URL) is required');

  const dir = process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), '../db/migrations');
  const files = readdirSync(dir)
    .filter((f) => /^V\d+.*\.sql$/.test(f))
    .sort();

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const applied = new Set(
      (await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map(
        (r) => r.version,
      ),
    );

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(resolve(dir, file), 'utf8');
      process.stdout.write(`applying ${file} ... `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        process.stdout.write('ok\n');
        count += 1;
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(e as Error).message}`);
      }
    }
    console.log(count === 0 ? 'up to date — no pending migrations' : `applied ${count} migration(s)`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
