import { Client } from 'pg';

/**
 * Creates the LOGIN role the SUPER-ADMIN PLATFORM API connects as. It is a member
 * of `etms_platform` (created by V0011), inheriting its cross-tenant table grants,
 * and is itself granted the **BYPASSRLS** attribute — because in Postgres
 * BYPASSRLS is a role attribute that is NOT inherited through membership, so it
 * must be set on the login role directly for it to operate ACROSS tenants
 * (company provisioning, plan management, feature flags). Keep this connection
 * isolated to the platform API. Idempotent. Run once after migrations, with an
 * admin connection.
 *   MIGRATE_DATABASE_URL=postgres://admin@host/etms \
 *   PLATFORM_DB_USER=etms_platform_login PLATFORM_DB_PASSWORD=*** \
 *     node dist/scripts/create-platform-role.js
 */
async function main(): Promise<void> {
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATE_DATABASE_URL (or DATABASE_URL) is required');
  const user = process.env.PLATFORM_DB_USER ?? 'etms_platform_login';
  const password = process.env.PLATFORM_DB_PASSWORD;
  if (!password) throw new Error('PLATFORM_DB_PASSWORD is required');
  if (!/^[a-z_][a-z0-9_]*$/.test(user)) throw new Error('invalid PLATFORM_DB_USER');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user])).rowCount;
    // DDL cannot bind parameters; role name is validated and the password's
    // single quotes are escaped before inlining as a SQL string literal.
    const pw = `'${password.replace(/'/g, "''")}'`;
    if (exists) {
      await client.query(`ALTER ROLE ${user} WITH LOGIN BYPASSRLS PASSWORD ${pw}`);
      console.log(`role ${user} updated (BYPASSRLS)`);
    } else {
      await client.query(`CREATE ROLE ${user} LOGIN BYPASSRLS PASSWORD ${pw} IN ROLE etms_platform`);
      console.log(`role ${user} created (member of etms_platform; BYPASSRLS — cross-tenant)`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
