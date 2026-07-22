# 19 — Super-Admin Platform API (cross-tenant)

> The Super-Admin duties — **provisioning companies, managing subscriptions/plans,
> and toggling per-tenant feature flags** — are **cross-tenant**, so they live in a
> **separate platform layer** outside the per-request tenant RLS context the rest
> of the API uses. A tenant user can never reach these routes, and a platform
> operator carries no tenant and can never reach the tenant-scoped routes.

## Why a separate layer

The tenant API connects as `etms_app_login` (a non-superuser role — **RLS is
enforced**, so a request physically cannot read another company's rows). The
platform API instead connects as `etms_platform_login`, which is granted the
**BYPASSRLS** attribute, so it can read and write **across every company** — which
is exactly what provisioning and support need, and exactly why it is kept apart
from the tenant surface.

> **Postgres detail (and a real bug we hit):** `BYPASSRLS` is a *role attribute*,
> **not** a privilege inherited through role membership. Making the login role a
> member of the BYPASSRLS `etms_platform` role inherits its table **grants** but
> **not** BYPASSRLS — the attribute must be set on the login role itself. The
> `create-platform-role` script does this (`CREATE ROLE … LOGIN BYPASSRLS`).

## Authentication

`POST /v1/platform/login` `{email, password}` authenticates a **platform operator**
(a row in `platform_admin` — *not* a tenant user) and mints a short-lived (1h) JWT
carrying `platform:true` and **no tenant**. Every other platform route is guarded
by `authenticatePlatform`, which rejects any token lacking `platform:true` (403).
Login is rate-limited (10/min/IP) like the tenant login.

## Endpoints

| Method & path | Purpose | Perm |
|---|---|---|
| `POST /v1/platform/login` | Operator → platform JWT | public (rate-limited) |
| `GET /v1/platform/companies` | List all companies + active plan | platform |
| `POST /v1/platform/companies` | Provision a company (tenant + optional bootstrap admin + optional plan) | platform |
| `GET /v1/platform/companies/:id` | Company detail (all subscriptions + feature flags) | platform |
| `POST /v1/platform/companies/:id/suspend` | `status → suspended` (blocks every login for that company) | platform |
| `POST /v1/platform/companies/:id/activate` | `status → active` | platform |
| `PUT /v1/platform/companies/:id/subscription` | Set the plan + limits (`starter/business/enterprise/custom`); the old active row is cancelled so exactly one stays active | platform |
| `GET /v1/platform/companies/:id/features` | List the company's feature flags | platform |
| `PUT /v1/platform/companies/:id/features` | Upsert one flag `{feature, enabled, config?}` | platform |

**Provisioning** (`POST …/companies`) creates the `tenant` and, optionally, a
bootstrap **admin user** (an `admin` role cloning the full `company_admin`
permission set + a user) so the company can sign in immediately on the tenant API,
and an initial **subscription**. It runs in one transaction; a duplicate slug → 409.

**Suspend** flips `tenant.status`; because `auth_lookup` only returns users of an
**active** tenant, suspending a company immediately blocks all of its logins.

## Data model (`db/migrations/V0023`)

- **`platform_admin`** — the platform operators. No `tenant_id`, no RLS; and the
  tenant app role (`etms_app`) is explicitly **REVOKE**d from it, so tenant code
  can never read platform staff password hashes.
- **`tenant_feature`** — per-tenant flags. **Tenant-scoped with RLS**, so a company
  reads *its own* flags through the normal API, while the platform (BYPASSRLS)
  writes them across all companies. Flags are **enforced at runtime** (opt-out —
  enabled unless a row sets `enabled=false`): `requireFeature`/`isFeatureDisabled`
  (app/feature_flags, briefly cached, invalidated on toggle) gate the tenant API.
  Wired today on `ride_requests` (the ride-request surface) and `live_tracking`
  (the realtime SSE stream) → a disabled feature returns `403 FEATURE_DISABLED`.
- **`platform_event`** — append-only audit of every platform action
  (`company.create` / `company.suspend` / `company.activate` / `subscription.set`
  / `feature.set`), with the acting `admin_id` and target `tenant_id`.

Subscriptions/plans reuse the existing `subscription` table (V0001) and its
`uq_subscription_active` (one active per tenant).

## Operating it (deployment)

```bash
# 1) the BYPASSRLS login role (once, admin connection)
PLATFORM_DB_USER=etms_platform_login PLATFORM_DB_PASSWORD=*** \
  node dist/scripts/create-platform-role.js
# 2) the first platform operator
PLATFORM_ADMIN_EMAIL=root@you.example PLATFORM_ADMIN_PASSWORD=*** \
  node dist/scripts/seed-platform.js
# 3) point the API at it
PLATFORM_DATABASE_URL=postgres://etms_platform_login:***@host/etms
```

`PLATFORM_DATABASE_URL` falls back to `DATABASE_URL` when unset (fine for local/dev
where the connection is already an owner/superuser). In production it should be the
dedicated BYPASSRLS role above, separate from the tenant app connection.

## Console (UI)

A self-contained, bilingual (AR/EN, RTL) web console — **`docs/etms/platform-admin-app.html`**
— drives this API end-to-end: operator sign-in, the companies list with live KPIs
(total / active / suspended / on-a-plan), a **provision** form (company + optional
bootstrap admin + plan), and a per-company drawer for suspend/activate, changing
the plan & limits, and toggling feature flags. Open the file, point the **API**
box at the backend, and sign in with a seeded platform operator. It embeds the
Cairo font and needs no build step or network beyond the API (start the backend
with `CORS_ORIGIN=*` for local use).

## Verification (live, PostgreSQL 16 + PostGIS)

End-to-end and passing (suite **93/93**, incl. 4 new platform-guard unit tests):

- **Login & separation:** platform login works; wrong password → 401; a **tenant**
  token on a platform route → **403**; a **platform** token carries no tenant.
- **Provision:** created a company with a `business` plan + limits and a bootstrap
  admin — that admin then **logged in on the tenant API** with the full 75-perm
  `company_admin` set (incl. `brand.manage`); duplicate slug → **409**.
- **Subscriptions:** changed `business → enterprise`; exactly one active row
  remained (old one `cancelled`).
- **Feature flags:** enabled `live_tracking` (with config) and disabled
  `ride_requests`; the owning tenant can read them under RLS.
- **Lifecycle:** **suspend** blocked the company's tenant login; **activate**
  restored it.
- **Audit:** `platform_event` recorded all six actions in order.
- **Isolation (DB-level):** the tenant app role got **`permission denied`** on
  `platform_admin`, while the BYPASSRLS platform role reads it — the two surfaces
  are physically separated.
- **Console (browser):** `platform-admin-app.html` driven live in Chromium
  (Playwright) — sign-in → companies list + KPIs → provision → detail drawer →
  feature toggle, all with **zero console errors** (two RTL layout bugs found and
  fixed in the process).
