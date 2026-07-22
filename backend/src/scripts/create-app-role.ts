import { Client } from 'pg';

/**
 * Creates the LOGIN role the API connects as in deployment. It INHERITS the
 * `etms_app` role (created by migration V0011) but is NOT a superuser, so
 * Row-Level Security is enforced. Idempotent. Run once after migrations, with an
 * admin connection.
 *   MIGRATE_DATABASE_URL=postgres://admin@host/etms \
 *   APP_DB_USER=etms_app_login APP_DB_PASSWORD=*** node dist/scripts/create-app-role.js
 */
async function main(): Promise<void> {
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATE_DATABASE_URL (or DATABASE_URL) is required');
  const user = process.env.APP_DB_USER ?? 'etms_app_login';
  const password = process.env.APP_DB_PASSWORD;
  if (!password) throw new Error('APP_DB_PASSWORD is required');
  if (!/^[a-z_][a-z0-9_]*$/.test(user)) throw new Error('invalid APP_DB_USER');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const exists = (
      await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user])
    ).rowCount;
    // DDL cannot bind parameters; role name is validated and the password's
    // single quotes are escaped before inlining as a SQL string literal.
    const pw = `'${password.replace(/'/g, "''")}'`;
    if (exists) {
      await client.query(`ALTER ROLE ${user} WITH LOGIN PASSWORD ${pw}`);
      console.log(`role ${user} updated`);
    } else {
      await client.query(`CREATE ROLE ${user} LOGIN PASSWORD ${pw} IN ROLE etms_app`);
      console.log(`role ${user} created (inherits etms_app; RLS enforced)`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
