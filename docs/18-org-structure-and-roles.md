# 18 — Organization Structure & User Roles

> Multi-brand company support: **Company (tenant) → Brand → Branch (restaurant) →
> Employees**, with full multi-tenant data isolation.

## Hierarchy

```
SaaS Platform
   └── Company (tenant)              ← Company ID  (the `tenant` row)
          ├── Brand                  ← Brand ID    (`brand`)
          │     └── Branch / Restaurant  ← Branch ID (`site`, with brand_id)
          └── Employees              (employee.brand_id + default_site_id)
```

- `brand` (V0022): per-tenant, RLS-isolated, with a unique code per company.
- A **branch/restaurant** is a `site` and now carries `brand_id`.
- An **employee** carries `brand_id` (its brand) + `default_site_id` (its branch).
- **Isolation:** every table is Row-Level-Security scoped to the company (tenant);
  one company can never read another's brands, branches, employees or trips.

Manage via the CRUD API: `/v1/brands`, `/v1/sites` (branches, with `brand_id`),
`/v1/employees` (with `brand_id`).

## User roles

Roles are RBAC permission sets (a user is assigned one via `/v1/users/:id/roles`).
Branch scoping uses `user_role.scope_site_ids` (a role limited to specific
branches). It is **enforced end-to-end** (V0025): login resolves the user's
effective scope — an unscoped role grants tenant-wide visibility, otherwise the
union of scoped sites — and mints it into the JWT, and the branch-linked CRUD
resources (sites, employees, shifts, routes) filter every list/create/update/
delete to those sites.

| Role | Purpose | Key permissions | Status |
|------|---------|-----------------|--------|
| **Super Admin** | Platform owner (across companies): create companies, subscriptions, feature flags, global settings | platform-level (cross-tenant) | ✅ **platform API built** — separate layer, see doc 19 |
| **Company Admin** | Group owner | **all** tenant permissions (incl. `brand.manage`) | ✅ |
| **Transport Admin** | Runs transport ops | vehicles, drivers (+verify), routes, schedules, dispatch/reassign/cancel, bookings & ride-requests (manage_any), manifest, route-plan approve, tracking, incidents, operational reports | ✅ (30 perms) |
| **HR Admin** | Employees & master data | employees (+import), sites/shifts/cost-centers, roster, registration review, `brand.read` | ✅ |
| **Branch Admin** *(optional)* | One branch | employees (read/manage), trips, tracking, operational reports, `brand.read`, `site.read` — **scoped** to its branches via `scope_site_ids` (enforced, V0025) | ✅ (8 perms) |
| **Driver** | Driver app | assigned trips, manifest, start/complete, arrival, board, GPS, SOS | ✅ |
| **Employee** | Rider app | own trips, bus ETA, "I'm on the way", ride requests, rating, lost & found | ✅ |

All seven role codes exist as system templates (`role` with `tenant_id IS NULL`);
a company re-seed clones the company-admin set (including the new `brand.*`) into
its tenant admin role.

## Super Admin — platform layer (note)

Super-Admin duties (create/suspend companies, manage subscriptions & plans,
toggle features) are **cross-tenant** and therefore live **outside** the
per-request tenant RLS context that the rest of the API uses. This **dedicated
platform API is now built** (V0023) — operator login, company provisioning,
subscription/plan management, per-tenant feature flags, and a platform audit trail
— connecting as the BYPASSRLS `etms_platform` role, kept strictly separate from the
tenant-scoped API. See **[doc 19 — Super-Admin Platform API](./19-platform-super-admin.md)**
for endpoints, the data model, deployment, and live verification.

## Verification (live, PostgreSQL 16 + PostGIS)

Confirmed end-to-end (suite **89/89**): V0022 applied; `transport_admin` (30
perms) and `branch_admin` (8 perms) seeded alongside the existing `super_admin`;
company admin picked up `brand.manage`; and a full hierarchy round-trip —
**brand → branch (site with brand_id) → employee (brand_id + default_site_id)** —
created and listed through the CRUD API, tenant-isolated.

### Next
- ~~The Super-Admin **platform API**~~ — **done** (V0023). See doc 19.
- ~~Enforce `branch_admin` scoping in queries from `scope_site_ids`~~ — **done**
  (V0025): login mints the effective scope into the JWT and the branch-linked
  CRUD resources filter every read and write to it. Verified live — a Branch
  Admin scoped to one branch sees/edits only that branch's sites & employees
  (out-of-scope update → 404, out-of-scope/new-branch create → 403), while an
  unscoped admin sees all. Suite **96/96**.
