# ETMS — Database Schema

Production-grade PostgreSQL schema for the Employee Transportation Management System.
This is the **executable** companion to the design docs in
[`../docs/etms/03-database-design.md`](../docs/etms/03-database-design.md).

## Contents
| File | Purpose |
|------|---------|
| [`ERD.md`](./ERD.md) | Full entity-relationship diagrams (per context + cross-context) |
| `migrations/V0000__extensions_and_core_functions.sql` | Extensions, session context, `audit_row()`, `set_updated_at()`, `audit_entry` |
| `migrations/V0001__tenant_and_billing.sql` | Tenants, branding, settings, subscriptions, usage |
| `migrations/V0002__identity_access.sql` | Users, roles, permissions, sessions, MFA, SSO identities |
| `migrations/V0003__master_data.sql` | Sites, zones, shifts, cost centers, employees |
| `migrations/V0004__fleet.sql` | Vendors, vehicles, drivers, documents, rate cards |
| `migrations/V0005__planning.sql` | Routes, stops, schedules, holidays |
| `migrations/V0006__booking_dispatch_trips.sql` | Trips, assignments, bookings, seat allocations, trip events |
| `migrations/V0007__tracking_incidents.sql` | Partitioned GPS pings, last position, incidents, geofence events |
| `migrations/V0008__costing_finance.sql` | Trip cost, allocations, vendor invoices, lines, ERP export |
| `migrations/V0009__notifications.sql` | Templates, messages, device tokens, webhooks |
| `migrations/V0010__analytics_views.sql` | Materialized views + reporting views |
| `migrations/V0011__rls_and_grants.sql` | Row-Level Security policies + DB roles/grants |
| `migrations/V0012__seed_permissions_roles.sql` | Permission catalog + system role templates |

Migrations are **forward-only** and named `V<NNNN>__<name>.sql` (Flyway-compatible; the
same order works with any runner or plain `psql`).

## Requirements
- PostgreSQL **15+**
- Extensions: `postgis`, `pgcrypto`, `citext`, `btree_gist`, `pg_trgm`

## Apply
```bash
createdb etms
for f in migrations/V0*.sql; do
  psql -v ON_ERROR_STOP=1 -d etms -f "$f"
done
```
(Or point Flyway/Liquibase/your migration tool at `migrations/`.)

## Runtime tenant context (required for RLS)
The API connects as role **`etms_app`** (never the owner) and sets the tenant/user per
request from the validated JWT before running queries:
```sql
SELECT set_config('app.tenant_id', '<tenant-uuid>', false);
SELECT set_config('app.user_id',   '<user-uuid>',   false);
```
Row-Level Security then guarantees the connection can only see/modify that tenant's rows.
Platform provisioning/support uses the **`etms_platform`** (`BYPASSRLS`) role; reporting
uses read-only **`etms_readonly`**.

## Database roles
| Role | Use | RLS |
|------|-----|-----|
| `etms_app` | Application (per-request tenant context) | enforced (FORCE) |
| `etms_readonly` | BI / reporting | enforced, SELECT only |
| `etms_platform` | Tenant provisioning, support tooling | **bypass** |

## Key design guarantees (all verified against PostgreSQL 16)
- **Multi-tenant isolation** — 46 tables under RLS; a session scoped to tenant A cannot
  read or write tenant B's rows (cross-tenant INSERT/SELECT proven blocked).
- **Immutable audit** — every business INSERT/UPDATE/DELETE writes a before/after snapshot
  to `audit_entry`; UPDATE/DELETE on the log are revoked (tamper-proof).
- **Soft deletes** — `deleted_at` on reference data; partial unique indexes keep codes
  reusable after deletion.
- **Referential integrity** — 100+ foreign keys with deliberate `ON DELETE` behavior
  (CASCADE for owned children, SET NULL for optional references).
- **Data quality** — 400+ CHECK constraints (enums, ranges, currency/locale formats,
  capacity ≥ seats, valid time/period ordering).
- **Performance** — 160+ indexes: composite hot-path, GiST spatial, GIN trigram search;
  `vehicle_ping` is range-partitioned by day.
- **Idempotency** — offline trip-event replay and ERP posting are duplicate-safe.

## Validation
The full migration set was applied to a clean PostgreSQL 16 + PostGIS database and the
following were exercised and confirmed:
- all 13 migrations apply cleanly, in order, on an empty database;
- 52 tables, 3 views, 4 materialized views, 104 FKs, 403 CHECKs, 48 RLS policies,
  112 triggers, 56 permissions, 10 system roles, 182 role↔permission grants created;
- RLS isolation, cross-tenant write rejection, audit capture + immutability, the
  trip-capacity CHECK, and the `updated_at` trigger all behave as designed.

## Conventions
- Surrogate PK `id uuid DEFAULT gen_random_uuid()`; every tenant row has `tenant_id`.
- Timestamps `timestamptz`; money `numeric(14,4)` + ISO `currency_code`.
- Enum-like fields use `CHECK` constraints (not native enums) for painless evolution.
- Names are `snake_case`; indexes `ix_*`, unique `uq_*`, checks `ck_*`.
