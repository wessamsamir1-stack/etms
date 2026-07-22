import { Client } from 'pg';
import { hashPassword } from '../util/password';

/**
 * Bootstraps the first Super-Admin PLATFORM operator so you can call
 * `POST /v1/platform/login`. Platform admins are NOT tenant users — they live in
 * `platform_admin` (no tenant, no RLS). Idempotent (refreshes the password on
 * re-run). Run with an ADMIN connection.
 *   MIGRATE_DATABASE_URL=postgres://admin@host/etms \
 *   PLATFORM_ADMIN_EMAIL=root@etms.app PLATFORM_ADMIN_PASSWORD=*** \
 *     node dist/scripts/seed-platform.js
 */
async function main(): Promise<void> {
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATE_DATABASE_URL (or DATABASE_URL) is required');
  const email = process.env.PLATFORM_ADMIN_EMAIL ?? 'root@etms.app';
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? 'Platform0wner!';
  const name = process.env.PLATFORM_ADMIN_NAME ?? 'Platform Owner';

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO platform_admin(email, full_name, password_hash, status)
       VALUES ($1,$2,$3,'active')
       ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, full_name=EXCLUDED.full_name`,
      [email, name, hashPassword(password)],
    );
    console.log(`seeded platform admin '${email}' (password: ${password})`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
