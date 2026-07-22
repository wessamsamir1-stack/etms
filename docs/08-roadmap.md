# 08 — Development Roadmap

Delivery is **incremental and vertical** — each phase ships an end-to-end slice that a
real tenant could use, not horizontal layers. Estimates assume one cross-functional squad
(2 backend, 2 Flutter, 1 QA, 0.5 design, 0.5 DevOps); adjust by staffing.

## Phase 0 — Foundations & Design Sign-off (2–3 weeks)
**Goal:** platform skeleton + this specification approved.
- Approve SRS, architecture, data model, API contract (this `docs/etms/` set).
- Repo & module scaffolding (Clean Architecture layers, DI, lint, CI/CD gates).
- Provision infra (Postgres+PostGIS, Redis, object storage) via IaC; environments.
- AuthN/Z skeleton: JWT, RBAC/ABAC guards, RLS baseline, audit-entry plumbing.
- Design-system package (tokens, theming, i18n, RTL) + Figma library.
**Exit:** CI green, one protected sample endpoint end-to-end, spec signed off.

## Phase 1 — Tenant + Master Data + Identity (3–4 weeks)
**Goal:** a tenant can be onboarded and its master data loaded.
- Super-admin: create/suspend tenant; branding; plans.
- Users, roles, permissions, ABAC scoping; SSO/OTP login; MFA.
- Master data CRUD: sites, zones (geofence), shifts, cost centers.
- Employees: CRUD + CSV import (dry-run) + basic HRIS sync adapter.
- Fleet: vendors, vehicles, drivers, documents, verification, rate cards.
- Audit log UI (read).
**Exit:** onboard a real tenant, load employees & fleet, RBAC enforced, audited.

## Phase 2 — Planning + Booking (3–4 weeks)
**Goal:** routes exist and riders get seats.
- Routes & stops; schedules (RRULE); trip generation job (calendar/holidays).
- Capacity model; booking service (request/confirm/waitlist/cancel); recurring bookings.
- Rider app v1: home, book, my trips, notifications, profile, i18n/RTL.
- Eligibility & policy enforcement.
**Exit:** rider books a seat for a generated trip and is confirmed/waitlisted correctly.

## Phase 3 — Dispatch + Driver App + Offline (4–5 weeks)
**Goal:** trips run in the field, offline-safe.
- Dispatch board: assign/reassign vehicle+driver with conflict/doc checks.
- Trip lifecycle state machine; trip events (idempotent).
- Driver app v1: today's trips, manifest, stop flow, proof capture, start/complete.
- **Offline-first**: local store + outbox + conflict-safe sync (`client_event_id`).
- No-show handling; rider check-in (QR/tap).
**Exit:** a full trip executed offline on the driver app, synced and reconciled server-side.

## Phase 4 — Live Tracking + Control Tower + SOS (3–4 weeks)
**Goal:** operations see and steer the fleet in real time.
- GPS ingest (batched, buffered), realtime channels (WS/SSE), ETA computation.
- Control tower: live map, fleet list, exception feed; geofence events.
- SOS/panic + incident management + on-call escalation.
- Rider live ETA/tracking.
**Exit:** live map with moving vehicles, exceptions surfaced, SOS paged end-to-end.

## Phase 5 — Costing + Invoice Reconciliation + ERP (3–4 weeks)
**Goal:** every trip is costed and vendor invoices are verified.
- Deterministic trip costing from rate cards; cost-center allocation.
- Invoice import; reconciliation with variance flagging; dispute flow.
- ERP/SAP export/posting adapter (idempotent, retried, DLQ); CSV/Excel export.
- Budget vs. actual alerts.
**Exit:** import a vendor invoice, catch a variance, export approved costs to ERP.

## Phase 6 — Analytics + Notifications polish + Hardening (3–4 weeks)
**Goal:** decision-grade reporting and production hardening.
- Operational / financial / safety dashboards; scheduled report delivery.
- Notification templates (channel/locale), delivery receipts, retries.
- Performance, load & chaos testing; security review (OWASP ASVS L2); pen-test fixes.
- Observability: tracing, metrics, alerting, runbooks; DR drill (backup/restore).
**Exit:** SLAs met under load; security sign-off; DR restore validated.

## Phase 7 — GA & Scale (ongoing)
- Multi-region/data-residency deployments; extract Tracking & Notifications to services
  if scale demands; route-optimization engine (pluggable ML); white-label app store builds
  per tenant; marketplace of integrations.

## Milestone Summary
| Phase | Outcome | Approx. duration |
|-------|---------|------------------|
| 0 | Foundations + design sign-off | 2–3 wk |
| 1 | Tenant, identity, master data | 3–4 wk |
| 2 | Planning + booking | 3–4 wk |
| 3 | Dispatch + driver app + offline | 4–5 wk |
| 4 | Tracking + control tower + SOS | 3–4 wk |
| 5 | Costing + invoicing + ERP | 3–4 wk |
| 6 | Analytics + hardening | 3–4 wk |
| **MVP (usable)** | End of Phase 3 | ~**3–4 months** |
| **Enterprise GA** | End of Phase 6 | ~**6–7 months** |

## Cross-Cutting Tracks (run every phase)
- **Security & compliance** — threat modeling per feature, audit coverage, secret hygiene.
- **Testing** — unit (domain >80%), use-case, contract (OpenAPI), integration, e2e, load.
- **DevEx/DevOps** — trunk-based, PR checks, preview envs, automated migrations.
- **Docs** — keep `docs/etms/` and OpenAPI in lockstep with code; changelog per release.
- **Localization** — every user-facing string translated (AR/EN) before phase exit.

## Requirements → Phase Traceability (excerpt)
| Requirements | Phase |
|--------------|-------|
| FR-1..5 (tenant), FR-6..11 (identity) | 0–1 |
| FR-12..18 (master data & fleet) | 1 |
| FR-19..28 (planning & booking) | 2 |
| FR-29..34 (dispatch & trips), FR-52..54 (offline) | 3 |
| FR-35..39 (tracking & SOS) | 4 |
| FR-40..44 (costing & finance) | 5 |
| FR-45..51 (notifications & reporting) | 2/4/6 (event wiring per phase; polish in 6) |
| NFR-1..12 | cross-cutting; validated in 6 |

## Definition of Done (per feature)
Code + tests pass CI · permission & ABAC enforced · audited · localized (AR/EN) ·
offline behavior defined · OpenAPI updated · observability in place · reviewed & merged.
