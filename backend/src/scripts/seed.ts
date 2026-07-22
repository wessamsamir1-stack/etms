import { Client } from 'pg';
import { hashPassword } from '../util/password';

/**
 * Seeds a demo tenant + admin user so you can log in immediately after
 * migrations. Idempotent (safe to re-run; refreshes the admin password). Run
 * with an ADMIN connection (bypasses RLS to create the first tenant).
 *   MIGRATE_DATABASE_URL=postgres://admin@host/etms node dist/scripts/seed.js
 * Override via SEED_TENANT_SLUG / SEED_TENANT_NAME / SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 */
async function main(): Promise<void> {
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATE_DATABASE_URL (or DATABASE_URL) is required');

  const slug = process.env.SEED_TENANT_SLUG ?? 'acme';
  const name = process.env.SEED_TENANT_NAME ?? 'Acme';
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@acme.com';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Passw0rd!';

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');

    const tenantId = await upsertId(
      client,
      'SELECT id FROM tenant WHERE slug=$1',
      [slug],
      'INSERT INTO tenant(name, slug) VALUES ($1,$2) RETURNING id',
      [name, slug],
    );

    const existingUser = (
      await client.query<{ id: string }>(
        'SELECT id FROM app_user WHERE tenant_id=$1 AND email=$2',
        [tenantId, email],
      )
    ).rows[0];
    const userId = existingUser
      ? existingUser.id
      : (
          await client.query<{ id: string }>(
            `INSERT INTO app_user(tenant_id, email, full_name, status, password_hash)
             VALUES ($1,$2,'Administrator','active',$3) RETURNING id`,
            [tenantId, email, hashPassword(password)],
          )
        ).rows[0]!.id;
    if (existingUser) {
      await client.query('UPDATE app_user SET password_hash=$2 WHERE id=$1', [
        userId,
        hashPassword(password),
      ]);
    }

    const roleId = await upsertId(
      client,
      "SELECT id FROM role WHERE tenant_id=$1 AND code='admin'",
      [tenantId],
      "INSERT INTO role(tenant_id, code, name) VALUES ($1,'admin','Administrator') RETURNING id",
      [tenantId],
    );

    // Grant the tenant admin role every permission (clone the company_admin template).
    await client.query(
      `INSERT INTO role_permission(role_id, permission_id)
       SELECT $1, rp.permission_id FROM role_permission rp
       JOIN role r ON r.id = rp.role_id
       WHERE r.code='company_admin' AND r.tenant_id IS NULL
       ON CONFLICT DO NOTHING`,
      [roleId],
    );
    await client.query(
      `INSERT INTO user_role(tenant_id, user_id, role_id) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [tenantId, userId, roleId],
    );

    await client.query('COMMIT');
    console.log(`seeded tenant '${slug}' + admin '${email}' (password: ${password})`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}

async function upsertId(
  client: Client,
  selectSql: string,
  selectParams: unknown[],
  insertSql: string,
  insertParams: unknown[],
): Promise<string> {
  const found = (await client.query<{ id: string }>(selectSql, selectParams)).rows[0];
  if (found) return found.id;
  return (await client.query<{ id: string }>(insertSql, insertParams)).rows[0]!.id;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
