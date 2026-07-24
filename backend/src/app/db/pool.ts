import { Client, Pool, PoolClient } from 'pg';
import { ApiError } from '../middleware/context';

/**
 * Postgres access with per-request tenant context. Every query runs inside a
 * connection that has `app.tenant_id` / `app.user_id` set, so the database's
 * Row-Level Security policies (db/migrations/V0011) enforce tenant isolation —
 * the API physically cannot read another tenant's rows.
 */
export class Db {
  private url?: string;
  constructor(private readonly pool: Pool) {}

  static fromUrl(databaseUrl: string): Db {
    const db = new Db(new Pool({ connectionString: databaseUrl, max: 10 }));
    db.url = databaseUrl;
    return db;
  }

  /**
   * A dedicated standalone connection for Postgres LISTEN/NOTIFY (realtime
   * tracking). It is NOT drawn from the pool — a listener must hold its
   * connection open for the process's lifetime, so keeping it off the pool
   * avoids starving request handlers. Caller issues `LISTEN`, wires
   * `client.on('notification', …)`, and closes it on shutdown.
   */
  async createListener(): Promise<Client> {
    if (!this.url) throw new Error('Db has no connection string for a listener');
    const client = new Client({ connectionString: this.url });
    await client.connect();
    return client;
  }

  /**
   * Run `fn` on a connection scoped to the given tenant/user (RLS-enforced).
   * Wrapped in a transaction so the transaction-local `set_config` context
   * persists across all queries in `fn` and is cleanly reset on release —
   * critical with a pooled connection (no tenant context leaks between requests).
   *
   * Rejects with 401 when the tenant is not visible under RLS — the token names
   * a tenant that was deleted, or outlived the database it was minted against.
   * Checked here rather than per route so the whole tenant-scoped API answers
   * the same way: without it each route degrades differently, returning empty
   * lists or nulls as if the caller legitimately had no data.
   */
  async withTenant<T>(
    tenantId: string,
    userId: string,
    fn: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1,$2,true), set_config($3,$4,true)', [
        'app.tenant_id',
        tenantId,
        'app.user_id',
        userId,
      ]);
      // Costs one indexed lookup per tenant-scoped request. Must be its own
      // statement: the RLS policy on `tenant` reads app_current_tenant(), so it
      // cannot share a statement with the set_config that establishes it.
      const known = await client.query('SELECT 1 FROM tenant WHERE id = app_current_tenant()');
      if (known.rowCount === 0) {
        throw new ApiError(401, 'UNAUTHENTICATED', 'Token references an unknown tenant');
      }
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Run `fn` inside a transaction with NO tenant context. Used by the platform
   * (Super-Admin) layer, which connects as a BYPASSRLS role and operates across
   * tenants (e.g. provisioning a company + its admin + subscription atomically).
   */
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Run a query with no tenant context (for the login bootstrap, which calls the
   * SECURITY DEFINER auth_lookup/auth_permissions functions — see V0014).
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const res = await this.pool.query(sql, params);
    return res.rows as T[];
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
