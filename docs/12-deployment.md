# 12 — Deployment Guide

How to deploy the ETMS backend (and its database) to staging/production. The
Flutter clients are shipped separately (app stores / web hosting) and are out of
scope here.

> **Status:** the artifacts below are built and, where possible, **verified**
> (migration runner + app-role script run against real PostgreSQL; image builds in
> CI). **No live cloud deploy was performed** in this environment — wire the
> placeholders to your target.

## 1. Topology
```
            ┌────────────┐     ┌──────────────────────────┐
  clients → │ API (N×)   │ ──► │ PostgreSQL 16 + PostGIS   │
            │ Fastify    │     │ (managed, HA, backups)    │
            └────────────┘     └──────────────────────────┘
                 │  stateless, horizontally scalable
                 └─ optional: Redis (rate limit/queue), object storage, log/metrics sink
```
- The API is **stateless** → run ≥2 replicas behind a load balancer; scale on CPU/RPS.
- Postgres is the single stateful dependency → use a managed, HA instance with PITR backups.

## 2. Database roles (security-critical)
- **Migrations** run as an **admin** role (they create roles + `SECURITY DEFINER`
  functions): `MIGRATE_DATABASE_URL`.
- **The API** connects as **`etms_app_login`** — a LOGIN role that INHERITS `etms_app`
  but is **not** a superuser, so **Row-Level Security is enforced** (a superuser would
  bypass it). Created by `scripts/create-app-role.js`.

## 3. Migrations (idempotent, forward-only)
```bash
# once per release, before rolling out the new image:
MIGRATE_DATABASE_URL=postgres://admin@host:5432/etms \
MIGRATIONS_DIR=/app/migrations \
  node dist/scripts/migrate.js          # applies pending V*.sql, records schema_migrations

# once (or when rotating the app password):
MIGRATE_DATABASE_URL=postgres://admin@host:5432/etms \
APP_DB_USER=etms_app_login APP_DB_PASSWORD='***' \
  node dist/scripts/create-app-role.js
```
Both are idempotent and safe to re-run. `npm run migrate` is the shortcut.
**Verified here:** applies all 18 migrations on a fresh DB, second run reports
"up to date"; the app role is created as a non-superuser login role (RLS enforced).

## 4. Configuration & secrets
Set via the platform's secret manager (never in the image). See `.env.example`.

| Var | Who | Purpose |
|-----|-----|---------|
| `DATABASE_URL` | API | `etms_app_login` connection (RLS-enforced) |
| `MIGRATE_DATABASE_URL` | migrate job | admin connection for DDL |
| `APP_DB_USER` / `APP_DB_PASSWORD` | migrate job | the app login role |
| `JWT_SECRET` | API | verifies access tokens (rotate carefully) |
| `QR_SECRET` | API | HMAC for QR check-in tokens |
| `PORT` | API | listen port (default 8080) |

Rotate `JWT_SECRET` with an overlap window (accept old+new) to avoid mass logout.

## 5. Health & readiness (probes)
- `GET /health` — liveness (+ DB status string).
- `GET /ready` — readiness: **503 when a configured DB is unreachable**, else 200.
  Wire k8s `readinessProbe` → `/ready`, `livenessProbe` → `/health`.

## 6. Container image
```bash
# build (context = repo root so db/migrations are bundled)
docker build -f backend/Dockerfile -t etms-backend:<tag> .
```
Multi-stage, runs as non-root `node`, has a HEALTHCHECK on `/ready`, and bundles
the migrations at `/app/migrations`. CI (`.github/workflows/backend-ci.yml`)
type-checks, tests, and builds it; `backend-deploy.yml` publishes it to GHCR on a
`v*` tag.

## 7. Local full stack
```bash
docker compose -f backend/docker-compose.yml up --build
# db → migrate (applies migrations + creates etms_app_login) → api (as that role)
```

## 8. Rollout sequence (staging/prod)
1. Build + push the image (CI on tag → GHCR).
2. **Run migrations** against the target DB (pre-deploy step, admin creds).
3. Roll out the new image (rolling update; readiness gates traffic).
4. Verify `/ready` on new pods; watch error rate + p95.
5. **Rollback:** migrations are expand-contract/forward-only, so a rollback deploys
   the **previous image** (which is compatible with the current schema); never
   auto-drop columns in the same release you stop using them.

## 9. Scaling & resilience
- Scale API replicas horizontally; DB read-replicas for heavy reporting.
- Add **Redis** for a shared rate limiter (multi-instance) and async queues.
- Circuit-break/timeout every external dependency (mapping, SMS, ERP, SF).
- Region-pin per data-residency needs (docs/etms/09 §Privacy).

## 10. Backups & DR
- Managed Postgres with automated backups + **PITR** (WAL). Target RPO ≤ 15 min,
  RTO ≤ 1 h (docs/etms/09). **Test restores on a schedule** — an untested backup
  is not a backup.
- Object storage (proofs/docs) versioned + cross-region replicated.

## 11. Observability
- Ship structured logs (PII-scrubbed) + RED metrics + traces to your stack.
- Alert on SLO burn (availability, p95, `/ready` failures, SOS ack time).

## 12. Pre-go-live checklist
- [ ] Secrets in the secret manager (no defaults from `.env.example`).
- [ ] `MIGRATE_DATABASE_URL` (admin) ≠ `DATABASE_URL` (app login role).
- [ ] Migrations applied; `schema_migrations` current.
- [ ] Probes wired (`/ready`, `/health`); ≥2 replicas.
- [ ] Backups + PITR on; a restore has been tested.
- [ ] TLS at the edge; rate limits/WAF; log scrubbing verified.
- [ ] `JWT_SECRET`/`QR_SECRET` are strong and rotated from any default.
