# ETMS — Project Status Review

A whole-project snapshot: what exists, what is **verified** (actually run) vs.
**reviewed** (code written but not executed here), and what remains.

> Honesty rule used throughout: **verified** = executed in this environment
> (PostgreSQL 16 + PostGIS, Node test suite, and — for the web consoles — driven
> in a real browser). **reviewed** = written to spec and statically checked, but
> not compiled/run (applies to the Flutter apps — no Flutter SDK here).

## 1. Layers at a glance

| Layer | Location | Size | Status | Verification |
|-------|----------|------|--------|--------------|
| Specification | `docs/etms/` | 19 docs + 64 screen specs | Complete | Reviewed |
| Database | `db/migrations/` | **33 migrations** (V0000–V0033; no V0030) | Complete for built features | **Verified** — applies clean on PG16+PostGIS; RLS proven |
| Backend API | `backend/` | 69 source + 26 test files, 18 route modules | Broad vertical coverage | **Verified** — **106/107** tests, live DB (the one failure predates this work: an integration test expects an 'Acme HQ' fixture the seed does not create) |
| Web consoles | `docs/etms/*.html` | 6 (incl. tenant admin + platform Super-Admin) | Working | **Verified** — driven in Chromium |
| Client apps | `etms_app/` | 110 Dart files | Skeleton + admin portal + feature slices | **Analyzer + unit tests verified** on Flutter 3.44.8 (`flutter analyze` clean, 25/25 tests); not yet driven on a device |

## 2. Backend capabilities (all verified against a live database)

| Area | Verified behavior |
|------|-------------------|
| **Auth** | login / rotating refresh / logout / TOTP MFA step-up; perms minted from DB |
| **SSO (OIDC + SAML)** | per-tenant OpenID Connect (Auth Code + PKCE, id_token verified via JWKS, V0027) **and** SAML 2.0 (SP-initiated POST; signed-assertion verification via @node-saml/node-saml, V0028); federated email → existing user → normal session |
| **Account security** | per-IP limiter + per-account progressive lockout + password policy |
| **RBAC + tenancy** | JWT perms → `requirePermission` → `Db.withTenant` → RLS; cross-tenant physically blocked |
| **Branch scoping (ABAC)** | `scope_site_ids` minted at login (V0025); branch-linked CRUD filtered on every read/write (out-of-scope → 404/403) |
| **CRUD** | ~13 resources incl. brands (V0022); RLS-scoped, soft-delete, PG errors → problem+json |
| **Org hierarchy** | Company → Brand → Branch (site) → Employees; tenant-isolated round-trip |
| **Dispatch + trips** | create / assign / start / complete; guarded state machine |
| **Daily-commute manifest** | `trip_passenger` attendance, stop arrival + admin waiting timer + auto No-Show, "I'm on the way" (V0021) |
| **Ride requests** | staff pickup → offer/broadcast → first-driver claim → rider added to the **manifest** (V0020 + V0024) |
| **Transport usage / payroll** | boarding ledger + MFA-gated idempotent deduction export (V0018) |
| **Self-registration** | employee-number match + selfie ref + OTP + review queue (V0019) |
| **Tracking** | GPS pings, last position, incidents/SOS (PostGIS); **realtime SSE stream** (Postgres LISTEN/NOTIFY → hub → clients), tenant-filtered |
| **Costing / SAP** | deterministic cost engine + idempotent ERP export |
| **Notifications** | template render → outbox; **worker delivers** the outbox with retry/backoff (V0026) |
| **Eligibility (AI-assisted)** | rules-first gates + weighted risk → green/amber/red; shadow vs live |
| **Feedback** | trip rating, lost & found, employee/vehicle history, white-label branding |
| **Super-Admin platform API** | cross-tenant (BYPASSRLS) company provisioning, subscriptions/plans, feature flags, audit (V0023) |
| **Feature-flag enforcement** | per-tenant flags gate the tenant API at runtime (opt-out, cached); `ride_requests` + `live_tracking` wired → disabled ⇒ 403 FEATURE_DISABLED |
| **Reports / dashboards** | operational + daily-commute metrics; RLS-scoped aggregates |
| **Trip waiting list** | capacity guard (trip override, else the assigned vehicle); a full bus queues the employee and auto-promotes them when a seat frees (V0031) |
| **Zone matching** | a ride request's pickup is tested with `ST_Covers` against the zones on the driver's approved daily plan; `matchMyRoute` filters the driver's list (V0032) |
| **Ops report pack** | driver-ops, vehicle-ops, trip-duration, inefficient-trips (detour detection from the GPS trail), fuel-efficiency (per-bus anomaly vs the fleet median), route-cost, attendance-discipline, plan-adherence (V0033) |
| **App screens for the above** | driver manifest shows seats left + the waiting list; a driver ride-request inbox badged on-route / off-route / no-plan with the "on my route only" filter; an operational-reports screen for all eight reports |

## 3. Security posture

- **Passwords:** scrypt; strength policy (≥10, upper/lower/digit, blocklist).
- **Brute-force:** per-IP rate limit **+ per-account progressive lockout** (also throttles email guessing).
- **Sessions:** short access JWT + rotating single-use refresh; password change revokes other sessions.
- **MFA:** TOTP step-up for sensitive actions (ERP export, policy change).
- **Tenant isolation:** Postgres RLS with FORCE; app role can't bypass; pre-auth via least-privilege `SECURITY DEFINER` functions.
- **Two separated surfaces:** the tenant API (RLS-enforced login role) and the Super-Admin platform API (BYPASSRLS role); `platform_admin` is revoked from the tenant role.
- **Audit:** immutable per-tenant audit log + a platform audit log.
- **PII at rest:** field-level AES-256-GCM encryption (versioned keyring, rotation, tamper-detecting) on the employee home/pickup address; the mechanism applies to any future column (e.g. gov-ID).

## 4. What is NOT yet done (honest gaps)

| Item | Category | Why / note |
|------|----------|-----------|
| **Real notification gateways** | needs your keys | Worker + retry pipeline are **built & verified**; every channel still uses the in-memory provider. Implement FCM / Twilio / SMTP adapters and register them in `providers.ts`. |
| **Face-match + object storage** | needs your keys | Selfie stored as a reference; face-match is a manual stub; no storage upload adapter. |
| **Real HRIS pull (SuccessFactors/OData)** | needs your creds | Adapter is a documented stub; transform/upsert is verified. |
| **Pre-arrival reminders (10/3-min)** | needs a model change | Arrival-driven model; `trip_stop` has no planned time to schedule against. |
| **Flutter apps driven on a device** | needs a device/emulator | `flutter analyze` (clean) and `flutter test` (25/25) now run here on 3.44.8, so the code compiles and the models are covered — but no screen has been exercised against a live API on a real device. |
| **Flutter Super-Admin & approvals UIs** | not built | Only the HTML platform console + tenant dashboards exist as UIs. |
| **Field encryption — home/pickup address done** | extend as needed | AES-256-GCM keyring applied to the address PII; apply the same util to a gov-ID column when one is added. |
| **Dedicated per-tenant AI model** | not built | Port + null adapter only. |
| **Redis-backed limiter** | infra | In-process today (fine single-instance). |
| **Deploy to a live environment** | infra | Production compose (db, pgBouncer transaction pooling, migrate, api, worker, SSE-aware nginx) + runbook in `deploy/`; compose and nginx configs validated locally, but **no cloud deploy / DR drill** was performed. |
| **Split ETMS into its own repo** | ops | Still inside `curvy-app`; pushing to a separate `etms` repo was blocked by session scope (`migrate-etms.bat` provided). |

## 5. How to verify locally
```bash
# Backend (fully runnable + tested here)
cd backend && npm install && npm run build && npm test          # 106/107 (see note above)
docker compose -f backend/docker-compose.yml up --build          # db + migrate + api + worker

# Platform + worker roles/seed (outside compose)
PLATFORM_DB_USER=etms_platform_login PLATFORM_DB_PASSWORD=*** node dist/scripts/create-platform-role.js
PLATFORM_ADMIN_EMAIL=root@you.example PLATFORM_ADMIN_PASSWORD=*** node dist/scripts/seed-platform.js
WORKER_DATABASE_URL=postgres://etms_platform_login:***@host/etms npm run worker

# Web consoles: open docs/etms/admin-dashboard-app.html or platform-admin-app.html,
# set the API box, sign in (run the API with CORS_ORIGIN=*).

# Flutter client (needs a local Flutter SDK)
cd etms_app && flutter pub get && flutter gen-l10n && flutter test
```

## 6. Suggested next steps (priority order)
1. **Real gateway adapters** behind `ChannelProvider` (FCM/Twilio/SMTP) — the worker is ready.
2. **Compile & drive the Flutter apps** end-to-end against the live API; build the Super-Admin & approvals screens.
3. **Real integrations:** SuccessFactors pull, face-match + object storage, per-tenant AI model.
4. Apply field encryption to any new gov-ID column; optional JIT user provisioning on first SSO login.
5. **Deploy** to staging + Redis limiter for multi-instance; run the DR/backup drill (docs/etms/09).
