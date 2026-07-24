# ETMS Backend (REST API service)

TypeScript + Fastify service implementing the ETMS API and core engines, in Clean
Architecture (framework-free `domain/`, thin `app/` HTTP layer). It is the spine the
Rider / Driver / Manager portals consume.

> Contract: [`openapi.yaml`](./openapi.yaml) + [`../docs/etms/06-api-spec.md`](../docs/etms/06-api-spec.md).
> Data: [`../db`](../db). Architecture: [`../docs/etms/02-architecture.md`](../docs/etms/02-architecture.md).

## What this delivers (from the requested feature list)
| Requested item | Where | Status |
|----------------|-------|--------|
| **REST APIs** | `src/app` (Fastify, auth, RBAC, problem+json) | ✅ built + tested |
| **Route Optimization Engine** | `src/domain/optimization` | ✅ built + unit-tested |
| **QR Check-in / Check-out** | `src/domain/checkin` + `/v1/checkin/*` | ✅ built + tested |
| **SAP Integration** | `src/domain/sap` + `/v1/exports/erp` | ✅ built + tested |
| **Notification System** | `src/domain/notifications` + `/v1/notifications/preview` | ✅ engine built + tested |
| **Reports** | `/v1/reports/operational` (RLS-scoped SQL) | ✅ built |
| **Dashboard** | `/v1/dashboard/kpis` (RLS-scoped counts) | ✅ built + live-verified |
| **Deployment** | `Dockerfile`, `docker-compose.yml`, `.env.example` | ✅ |
| **Testing** | `node --test` unit + Fastify `inject` + live-DB integration | ✅ 42 passing |
| **Login / token minting** | `/v1/auth/login` (scrypt + SECURITY DEFINER lookup) | ✅ built + live-verified |
| **Refresh tokens + logout** | `/v1/auth/{refresh,logout}` (rotating, single-use) | ✅ built + live-verified |
| **Login rate limiting** | fixed-window limiter (10/min/IP) | ✅ built + tested |
| **MFA step-up (TOTP)** | `/v1/auth/mfa/{enroll,verify,challenge}` + `requireMfa()` guard | ✅ built + live-verified |
| **CRUD resource APIs** | `/v1/{sites,vehicles,employees,vendors,drivers,cost-centers,shifts,routes,rate-cards,notification-templates}` | ✅ built + live-verified |
| **Dispatch + trip lifecycle** | `/v1/trips`, `/v1/trips/{id}/{assign,start,complete}` | ✅ built + live-verified |
| **Driver verification** | `/v1/drivers/{id}/verify` (sensitive action) | ✅ built + live-verified |
| **Bookings** | `/v1/bookings` + `.../cancel` (eligibility, capacity, waitlist, promotion) | ✅ built + live-verified |
| **Tracking + SOS** | `/v1/tracking/{pings,vehicles}`, `/v1/incidents/*` | ✅ built + live-verified |
| **Notification System** | `/v1/notifications/{send,preview}` (template→queue→dispatch) | ✅ built + live-verified |
| **Eligibility engine (AI-ready)** | `/v1/eligibility/evaluate` — rules-first hard gates + weighted risk → band | ✅ built + live-verified |
| **HR sync (SuccessFactors)** | `/v1/hr/violations/sync` (idempotent) + `HrDirectoryPort` | ✅ built + live-verified |
| **Approvals: decisions + queue** | `/v1/eligibility/{decisions,queue,decisions/:id/override,policy}`; shadow/live auto-approve | ✅ built + live-verified |
| **Company residences** | `residence` + `employee.residence_id`; weighted routing priority | ✅ built + live-verified |
| **Transport usage report → payroll** | `transport_usage` ledger + `/v1/transport-usage`, `/details`, `/export`; company-owned (no vendor/rate-card), records rides+days & trip details, reports for HR to set a fixed-monthly/seasonal deduction (system never computes the amount), MFA-gated idempotent batch | ✅ built + live-verified |
| **Self-registration & onboarding** | HR roster + `/v1/register/{lookup,start,verify-otp}` (employee-no match + selfie + OTP), `/v1/registrations/*` review+approve (provisions account & role), `/v1/users/:id/roles` assign/revoke | ✅ built + live-verified |
| **Company branches/shops + driver route plans** | `/v1/company-locations` (branches/shops with codes), `/v1/driver-plans` (driver proposes zones+time window → dispatcher approves) | ✅ built + live-verified |
| **Ride requests** | `/v1/my-pickup` (fixed/temporary), `/v1/ride-requests` (per-request pickup, targeted or broadcast), `/claim` (atomic first-wins → rider added to the driver's trip seats), `/cancel` | ✅ built + live-verified |
| **Daily-commute manifest** | `/v1/trips/:id/{manifest,passengers,stops}`, stop `/arrive` (admin waiting timer) + `/depart` (auto No-Show), `/on-the-way`, `/board`, `/transport-policy`; no seat reservation | ✅ built + live-verified |
| **Ratings · lost&found · history · white-label · ops metrics** | `/v1/trips/:id/rating`, `/v1/ratings/summary`, `/v1/lost-items`, `/v1/{employees,vehicles}/:id/history`, `/v1/branding`, `/v1/dashboard/operational` | ✅ built + live-verified |
| Cost engine (supports Reports/SAP) | `src/domain/costing` | ✅ built + tested |
| RBAC/ABAC | `src/domain/access` + `app/middleware` | ✅ built + tested |

The three **Portals** (Driver / Employee / Transportation Manager) are the Flutter
clients in [`../etms_app`](../etms_app) (rider + driver apps and the admin portal); they
call this API.

## Layout
```
src/
├─ domain/                 # pure, framework-free engines (fully unit-tested)
│  ├─ optimization/        # capacitated nearest-neighbour route optimizer
│  ├─ checkin/             # HMAC-signed QR check-in/out tokens
│  ├─ costing/             # deterministic trip cost from rate card
│  ├─ notifications/       # {{var}} templating + pluggable channel dispatcher
│  ├─ sap/                 # idempotent ERP/SAP export (CSV / IDoc / JSON)
│  └─ access/              # RBAC + ABAC checks
├─ app/                    # HTTP layer
│  ├─ server.ts            # Fastify app + problem+json error handler
│  ├─ routes.ts            # all endpoints (zod-validated, RBAC-guarded)
│  ├─ middleware/          # JWT auth → Principal, requirePermission
│  └─ db/pool.ts           # Postgres with per-request RLS tenant context
├─ util/                   # jwt (HS256), geo (haversine)
├─ config.ts               # env-resolved config
└─ index.ts                # composition root
```

## Security model
- **AuthN:** Bearer HS256 JWT; claims carry `sub`, `tenant_id`, `permissions[]`,
  `scope_site_ids` (minted at login from `v_user_effective_permissions`).
- **AuthZ:** `requirePermission()` per route (RBAC); ABAC scope available to handlers.
- **Tenant isolation:** DB routes run inside `Db.withTenant()`, which opens a transaction
  and sets `app.tenant_id`/`app.user_id` so Postgres **Row-Level Security** filters every
  query. The API physically cannot read another tenant's data.

## Run
```bash
npm install
npm run build          # tsc → dist/
npm test               # unit + integration tests
npm run migrate        # apply db/migrations idempotently (admin creds)
npm start              # needs DATABASE_URL + secrets (see .env.example)
```

### The whole stack locally (DB → migrate + roles + seed → API + worker)

Compose reads `backend/.env`, which is gitignored — create it from the template
first. The template's `NODE_ENV=development` matters here: the api/worker services
default to `production`, and the guards in `src/config.ts` reject `CORS_ORIGIN='*'`
and the default JWT/QR secrets in that mode, so the container would exit at boot.

```bash
cp .env.example .env          # gitignored; keep NODE_ENV=development for local runs
docker compose -f docker-compose.yml up --build -d
curl localhost:8080/health    # {"status":"ok","db":"ok"} once migrate has finished
```

`migrate` runs once and exits: it applies `db/migrations`, creates the RLS-enforced
app login role and the BYPASSRLS platform role, then seeds tenant `acme` with
`admin@acme.com` / `Passw0rd!` and platform admin `root@etms.app` / `Platform0wner!`.

To point the Flutter clients ([`../etms_app`](../etms_app)) at it — `CORS_ORIGIN=*`
covers the dev origin, and `TENANT_SLUG` is the tenant the build authenticates against:

```bash
cd ../etms_app
flutter run -d chrome -t lib/main_development.dart \
  --dart-define=API_BASE_URL=http://localhost:8080/v1 \
  --dart-define=TENANT_SLUG=acme
```

Deploy guide: [`../docs/etms/12-deployment.md`](../docs/etms/12-deployment.md).

> The live-DB integration tests are **not idempotent** — they create fixtures with
> unique constraints (plate numbers, emails), so a second run against the same
> database fails on collisions. Recreate the volume between runs:
> ```bash
> docker compose -f docker-compose.yml down -v && docker compose -f docker-compose.yml up -d
> docker compose -f docker-compose.yml exec -T \
>   -e TEST_DATABASE_URL=postgres://etms_app_login:app-dev-pass@db:5432/etms \
>   api node --test 'dist/app/integration.test.js'
> ```

## Login & token minting
`POST /v1/auth/login {tenantSlug,email,password}` verifies the scrypt password hash and
mints an HS256 JWT whose claims carry the user's `tenant_id` + **effective permissions**
resolved from the DB. The lookup uses the `SECURITY DEFINER` functions in
`db/migrations/V0014` (`auth_lookup`, `auth_permissions`) so the RLS-bound app role can
authenticate a user before any tenant context exists — without gaining broad table access.

## Auth flow across the stack
```
client → POST /v1/auth/login → JWT{sub,tenant_id,permissions[]}
       → Authorization: Bearer <jwt> on every /v1 call
       → authenticate() → Principal → requirePermission() (RBAC)
       → Db.withTenant(tenant,user) → Postgres RLS (tenant isolation)
```

## Verification (actually executed here)
- `npm run build` → **clean** (strict TS, `noUncheckedIndexedAccess`).
- `npm test` → **76/76 passing**: engines (route optimizer, QR tokens, cost, notifications,
  queue, SAP export, RBAC, password, TOTP incl. the RFC 6238 vector, rate limiter) + Fastify
  integration + **live-DB integration** (login/refresh/MFA, RLS-isolated CRUD, dispatch +
  trip lifecycle, bookings waitlist/promotion, GPS tracking + SOS, notification send).
- **Live end-to-end:** booted the API against a real PostgreSQL 16 + PostGIS with the full
  `db/migrations` applied, seeded two tenants, and confirmed:
  - `GET /v1/dashboard/kpis` for Acme returns **its** counts only — never Globex's.
  - `POST /v1/auth/login` mints a JWT whose permissions come from the user's roles.
  - a full sites CRUD round-trip is tenant-isolated: the Acme caller sees "Acme HQ" and
    **never** "Globex HQ" (RLS through the API).
  - A real bug was found and fixed: transaction-local `set_config` needs an explicit
    transaction, else the tenant context is lost under autocommit → `app/db/pool.ts`.

## Release hardening
- **CORS:** `CORS_ORIGIN` must be the exact dashboard origin in production — `'*'` is
  rejected at boot (`src/config.ts`) and allowed only in dev/test.
- **Flutter release builds** ([`../etms_app`](../etms_app)) must be obfuscated, with the
  debug symbols kept out of the shipped binary so crashes stay de-obfuscatable:
  ```bash
  flutter build apk --obfuscate --split-debug-info=build/symbols
  flutter build appbundle --obfuscate --split-debug-info=build/symbols
  ```
  Archive `build/symbols` alongside each release — without it, obfuscated stack traces
  cannot be symbolicated.

## Notes / next
- Notification `preview` renders + limit-checks; wiring real SMS/WhatsApp/email providers
  is a `ChannelProvider` implementation + a queue/worker (interface already in place).
- Login, refresh-token rotation, logout, login rate-limiting, and CRUD for 9 tenant
  resources are built + live-verified. Remaining resources follow the same
  `routes_crud.ts` config pattern.
- MFA step-up and a Redis-backed limiter (for multi-instance) are the next auth steps.
- The route optimizer is a fast heuristic; swap in OR-Tools/2-opt behind the same signature.
