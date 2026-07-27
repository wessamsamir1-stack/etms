# ETMS — production deployment

The stack in `deploy/docker-compose.prod.yml` is the whole system: Postgres +
PostGIS, a pgBouncer pooler, a one-shot migration job, the API, the notification
worker, and nginx in front.

```
        internet
           │  443 (TLS)
        ┌──▼───┐   SSE: buffering OFF
        │nginx │────────────────┐
        └──┬───┘                │
           │ 8080               │
      ┌────▼─────┐  queries  ┌──▼────────┐
      │   api    │──────────▶│ pgbouncer │──┐ transaction pooling
      │ (xN)     │           └───────────┘  │
      └────┬─────┘                          │
           │ LISTEN/NOTIFY (direct, 5432)   │
           └────────────────┬───────────────┘
                       ┌────▼────┐        ┌────────┐
                       │   db    │◀───────│ worker │
                       └─────────┘        └────────┘
```

## 1. First deployment

### The fast path

On a fresh Ubuntu/Debian server, with your domain's A record already pointing
at it:

```bash
curl -fsSL https://raw.githubusercontent.com/wessamsamir1-stack/etms/main/deploy/bootstrap.sh \
  | sudo bash -s -- --domain api.example.com --email you@example.com
```

`deploy/bootstrap.sh` installs Docker if it is missing, generates every secret
once into `deploy/.env.prod`, points nginx at your domain, brings the stack up,
requests a Let's Encrypt certificate, and prints the API URL and the platform
admin credentials. Re-running it is the upgrade path — secrets are kept and the
migrations are idempotent.

Everything below is the same thing done by hand.

### By hand

```bash
git clone <repo> && cd etms
cp deploy/.env.prod.example deploy/.env.prod
# fill in every blank; generate secrets with: openssl rand -base64 36
$EDITOR deploy/.env.prod
```

TLS certificates go in `deploy/nginx/certs/` as `fullchain.pem` + `privkey.pem`.
For Let's Encrypt, bring the stack up first (HTTP only answers the ACME
challenge), then:

```bash
certbot certonly --webroot -w deploy/nginx/certbot -d api.etms.example.com
cp /etc/letsencrypt/live/api.etms.example.com/{fullchain,privkey}.pem deploy/nginx/certs/
docker compose -f deploy/docker-compose.prod.yml exec nginx nginx -s reload
```

Set your real hostname in `deploy/nginx/conf.d/etms.conf` (`server_name`), then:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
```

The `migrate` service runs to completion before `api` and `worker` start: it
applies `db/migrations/V*.sql`, creates the two login roles, and seeds the first
platform operator. It is idempotent — every later deploy re-runs it and applies
only what is pending.

Verify:

```bash
curl -fsS https://api.etms.example.com/health
curl -fsS https://api.etms.example.com/ready      # 503 while the DB is unreachable
docker compose -f deploy/docker-compose.prod.yml ps
```

## 2. Why pgBouncer, and why the API keeps a second connection

pgBouncer runs in **transaction pooling** mode: a Postgres backend is held only
for the duration of a transaction, so a few dozen real connections serve
hundreds of concurrent API requests. This is safe for this codebase because
every tenant-scoped request already runs inside one transaction — `Db.withTenant`
does `BEGIN`, sets the RLS context with `set_config(..., true)` (transaction-local)
and `COMMIT`s, so no session state survives to leak into the next client.

Transaction pooling **cannot carry `LISTEN`**. A `LISTEN` lives for the session,
but the pooler hands the backend to somebody else the moment the transaction
ends, so notifications are delivered to whoever happens to hold it. Live
tracking would go quiet with nothing in the logs.

So the API is given two connection strings:

| Variable                | Points at   | Used for                                    |
|-------------------------|-------------|---------------------------------------------|
| `DATABASE_URL`          | pgbouncer:6432 | every normal query                       |
| `LISTENER_DATABASE_URL` | db:5432     | the tracking hub's `LISTEN etms_track`      |
| `PLATFORM_DATABASE_URL` | db:5432     | cross-tenant Super-Admin (BYPASSRLS role)   |

`LISTENER_DATABASE_URL` falls back to `DATABASE_URL` when unset, which is what
you want for a direct-to-Postgres development run.

Sizing: `DEFAULT_POOL_SIZE` (25) × the number of distinct DB users is the real
backend count — keep it comfortably under the server's `max_connections` (200).
Each API replica additionally holds **one** direct listener connection.

## 3. Server-Sent Events

`GET /v1/tracking/stream` is an endless response. In `deploy/nginx/conf.d/etms.conf`
that location turns off every form of buffering — `proxy_buffering off`,
`proxy_cache off`, `chunked_transfer_encoding off`, `gzip off` — and raises the
read timeout to 24 h. Without that, nginx holds the frames in its buffer and the
control tower shows a frozen map. The API also sends `X-Accel-Buffering: no` and
a heartbeat comment every 25 s, so an idle stream stays alive through any
intermediate proxy.

If you put a cloud load balancer in front of nginx, disable response buffering
there too (ALB is fine; some CDNs buffer by default).

## 4. Routine operations

```bash
# Deploy a new version
git pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build

# Migrations only (they also run automatically on every up)
docker compose -f deploy/docker-compose.prod.yml run --rm migrate

# Logs
docker compose -f deploy/docker-compose.prod.yml logs -f api
docker compose -f deploy/docker-compose.prod.yml logs -f worker

# Scale the API
API_REPLICAS=4 docker compose -f deploy/docker-compose.prod.yml up -d --no-deps api

# Pooler state
docker compose -f deploy/docker-compose.prod.yml exec pgbouncer \
  psql -h 127.0.0.1 -p 6432 -U etms_app_login pgbouncer -c 'SHOW POOLS'
```

### Backups

```bash
docker compose -f deploy/docker-compose.prod.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" -Fc etms > etms-$(date +%F).dump
```

Restore into an empty database with `pg_restore -d etms etms-<date>.dump`. Take
a dump before every deploy that carries a migration; the `db_data` volume is the
only stateful thing in the stack.

### GPS partitions

`vehicle_ping` is range-partitioned by day and the migrations bootstrap only a
couple of months. Add partitions ahead of time (or install `pg_partman`) —
without one, pings land in the default partition and queries slow down:

```sql
CREATE TABLE vehicle_ping_2026_09 PARTITION OF vehicle_ping
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
```

## 5. Security checklist

- [ ] Every secret in `.env.prod` set, 32+ chars, and never committed.
- [ ] `CORS_ORIGIN` is the exact dashboard origin — the API refuses to boot in
      production with `*`.
- [ ] The API connects as `etms_app_login`, never as the Postgres superuser:
      RLS is what keeps tenants apart.
- [ ] Postgres and pgBouncer are on `expose:` only — no host port published.
- [ ] `FIELD_ENCRYPTION_KEYS` set, so home/pickup addresses are encrypted at rest.
- [ ] TLS certificates renewed (certbot timer) and nginx reloaded afterwards.
- [ ] Database backups running and a restore actually tested.
