# 04 — Super-Admin (Platform) Console

Web, **expanded-first**. Operated by the platform team (**Super Admin**). By policy this
console has **no access to tenant business PII** — it manages tenants, plans, and platform
health only. Inherits [README.md](./README.md) globals; auth shared (with mandatory MFA).

Permissions: `tenant.read`, `tenant.manage`, `billing.manage`, `audit.read` (platform scope).

### Shared: platform CRUD pattern
Same as ops "standard CRUD" but **not** tenant-scoped (super-admin operates across tenants via
a `BYPASSRLS` platform role — see `db/migrations/V0011`). Every mutation is audited at the
platform level.

---

### S-01 Tenants List
- **Permission:** `tenant.read`. **Purpose:** all tenant companies at a glance.
- **Layout:** search + status filter; table (name, slug/domain, plan, status, region, active
  users, created); **New tenant**. **States:** loading = skeleton; empty = "Create the first
  tenant". **Business rules:** row → S-02; suspended tenants visually distinct.
- **Responsive:** table → cards on compact.

### S-02 Create / Onboard Tenant (wizard)
- **Permission:** `tenant.manage`. **Purpose:** provision a new tenant end-to-end.
- **Flow:** basics (name, slug, region, locale/currency) → plan (S-04) → invite Company Admin
  (email) → confirm → provision (seed roles/permissions/templates, apply RLS). Result: tenant
  live + admin invited.
- **Validation:** slug unique + URL-safe; valid region; admin email. **Business rules:**
  provisioning is idempotent; on failure it rolls back cleanly; audited. **States:**
  provisioning = progress steps; success summary with next steps (branding/import handled by
  the tenant admin in the ops console).
- **Errors:** slug taken → inline; partial provision → safe rollback + retry.

### S-03 Tenant Detail
- **Permission:** `tenant.read` (+`tenant.manage`). **Purpose:** manage one tenant.
- **Layout:** header (status, region, plan) + tabs: **Overview** (usage metrics: trips,
  active riders, storage, API calls — aggregate, no PII), **Subscription** (S-04), **Health**
  (error rate, queue depth for this tenant), **Actions** (suspend / resume / schedule
  deletion). **Business rules:** suspend disables tenant logins immediately (audited);
  deletion is soft + scheduled purge honoring retention & data-residency. **Errors:**
  action failures surfaced; destructive actions require typed confirmation + MFA.

### S-04 Plans & Billing
- **Permission:** `billing.manage` (**MFA**). **Purpose:** plan tiers, limits, metered usage.
- **Layout:** plan catalog (starter/business/enterprise/custom) with limits (seats, vehicles,
  sites); per-tenant subscription (status, period, limits) + metered usage (from
  `usage_record`); invoices/exports. **Validation:** limits ≥ 0; period end > start; single
  active subscription per tenant. **Business rules:** exceeding limits enforced at the gateway
  (tenant sees quota messages, not this console); plan changes audited. **Empty:** "No usage
  yet".

### S-05 Platform Health
- **Permission:** `tenant.read`. **Purpose:** system-wide operational view.
- **Layout:** SLO dashboards (API availability/latency, error rates), queue depths (sync,
  notifications, ERP DLQ), realtime-connection counts, active incidents. **States:** live with
  reconnect; degraded banners per subsystem. **Business rules:** read-only; deep-links to
  runbooks. **Responsive:** tiles + charts, horizontal-scroll containers.

### S-06 Feature Flags / Rollouts
- **Permission:** `tenant.manage`. **Purpose:** progressive rollout + kill-switches per
  flag, targetable by tenant/region/plan. **Layout:** flag list → editor (targeting rules,
  % rollout, on/off). **Business rules:** changes take effect fast (cache TTL) and are audited;
  kill-switch is immediate. **Validation:** rollout 0–100%.

### S-07 Platform Audit
- **Permission:** `audit.read` (platform). Immutable log of platform-level actions (tenant
  create/suspend/delete, plan changes, flag changes). Filters + before/after detail. Read-only.
