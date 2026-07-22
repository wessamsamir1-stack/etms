# ETMS — Screen Specifications

Exhaustive, screen-by-screen UI/UX specification for every screen in the platform.
Read this file first: it defines the **global conventions** (states, responsive rules,
error handling, validation, permissions) that every screen inherits. Per-screen specs
then describe only what is specific or deviates.

## Documents
| File | App / Surface | Screens |
|------|---------------|---------|
| [01-rider-app.md](./01-rider-app.md) | Rider (employee) — phone-first | R-01 … R-13 |
| [02-driver-app.md](./02-driver-app.md) | Driver — phone-first, offline-critical | D-01 … D-10 |
| [03-ops-console.md](./03-ops-console.md) | Operations / Admin — web/tablet | O-01 … O-30 |
| [04-super-admin.md](./04-super-admin.md) | Platform super-admin — web | S-01 … S-07 |

Cross-references: information architecture → [../07-uiux.md](../07-uiux.md);
permissions → [../04-roles-rbac.md](../04-roles-rbac.md);
API per action → [../06-api-spec.md](../06-api-spec.md);
data → [../../db](../../db).

Screen-spec template (each screen): **Route · Persona/Permission · Purpose · Layout &
elements · States · Validation · Business rules · User flow · Errors · Responsive.**

---

## 1. Global State Model
Every data-bearing screen implements this state machine (maps to the Flutter
`AsyncValue` + `SyncState` in `etms_app`). A screen spec only lists **deviations**.

| State | Trigger | Default UI |
|-------|---------|-----------|
| **Loading (initial)** | First fetch, no cache | Skeleton placeholders matching final layout (never a bare spinner for lists); primary actions disabled |
| **Loading (refresh)** | Pull-to-refresh / revalidate | Keep current content, show top progress bar; content stays interactive |
| **Loaded** | Data present | Normal content |
| **Empty** | Success, zero items | `EmptyState`: icon + one-line title + a single primary CTA (or guidance if none) |
| **Partial/Offline** | Served from cache while offline | Cached content + `OfflineBanner` + `SyncStatusChip` = pending |
| **Error (recoverable)** | Fetch failed, cache empty | `ErrorView`: icon + human message + **Retry** |
| **Error (inline)** | Action failed | Snackbar/toast (transient) or inline field error (validation); never a full-screen takeover for a background action |
| **Submitting** | Mutation in flight | Button shows spinner + disabled; form locked; optimistic where safe (offline writes) |
| **Success (action)** | Mutation ok | Snackbar confirmation + state refresh; navigate only when the task is complete |

**Loading budget:** show cached/optimistic content in < 100 ms; skeletons appear only if
no cache. Spinners are for actions, skeletons for content.

## 2. Empty States (rules)
- Always: neutral icon, a title, and **exactly one** obvious next action when the user can
  create the missing thing (else concise guidance on who provisions it).
- Distinguish "empty because new" from "empty because filtered" (the latter offers *Clear
  filters*).

## 3. Error Handling (rules)
- **Localized, human, recoverable.** Never surface stack traces or codes to end users
  (a support `request_id` may appear in a collapsible "details").
- **Network/offline** → non-blocking banner; field apps keep working from cache.
- **401** → silent token refresh (one retry); on failure, route to login preserving intent.
- **403** → "You don't have access to this" + hide the entry point next time (don't dangle).
- **404** (in-tenant) → "Not found or removed"; offer back/refresh.
- **409 conflict** (e.g., seat taken, trip reassigned) → explain + auto-refresh the stale view.
- **422 validation** → map `errors[]` to fields inline; focus the first invalid field.
- **5xx** → generic message + Retry + `request_id`; auto-retry idempotent GETs with backoff.
- **SOS and safety actions never fail silently** — if send fails, escalate to phone dialer.

## 4. Validation (conventions)
- Validate **on blur** and **on submit**; never block typing. Show one message per field.
- Server is authoritative: client validation is UX, server `422` is truth.
- Common rules: email RFC-basic + `@`; phone E.164 (`^\+?[0-9]{6,15}$`); required fields
  marked with `*`; dates within allowed window; numeric ranges enforced (e.g., capacity ≥ 1).
- Destructive actions require explicit confirmation; sensitive actions (verify driver, ERP
  export, role change) require MFA step-up per tenant policy.

## 5. Permissions (how screens react)
- Navigation is **RBAC-driven**: a destination is hidden if the user lacks the permission.
- **ABAC scope**: lists are pre-filtered to the user's sites/cost-centers; out-of-scope
  deep links return 403 → §3.
- Riders/Drivers only ever see **their own** records (ownership predicate), regardless of role.
- Read-only roles (Auditor) render all mutating controls disabled with a tooltip.

## 6. Responsive Behavior (global)
Material 3 breakpoints; one Flutter codebase adapts layout, not content.

| Class | Width | Nav pattern | Typical layout |
|-------|-------|-------------|----------------|
| Compact | < 600 | Bottom nav (≤5) | Single column, full-width cards, bottom sheets |
| Medium | 600–840 | Nav rail | 2-column where useful; dialogs instead of full-page |
| Expanded | 840–1240 | Nav rail + optional drawer | Master–detail (list + detail pane) |
| Large | ≥ 1240 | Persistent drawer | Multi-pane (list + detail + context), data tables |

- **Rider/Driver** apps are **compact-first**; they scale up gracefully but are designed for
  one-handed phone use with large tap targets (≥ 48 dp).
- **Ops/Super-admin** are **expanded-first** (web/tablet); on phones they collapse tables to
  cards and master–detail to drill-down navigation.
- **RTL:** all layouts mirror for Arabic (start/end, not left/right); maps and charts keep
  geographic orientation but UI chrome mirrors.
- Text scales with OS font settings; no fixed-height text containers (content may wrap/scroll
  inside `overflow` containers).

## 7. Accessibility (applies to every screen)
WCAG 2.1 AA: semantic labels on all controls, logical focus order, 4.5:1 contrast, visible
focus, no color-only status (icon + text), announced live-region updates (ETA, sync, SOS).

## 8. Cross-app shared screens
Auth (login/OTP/SSO/MFA), Notifications list, SOS, and Profile/Settings share one
implementation and one spec — defined in [01-rider-app.md](./01-rider-app.md) §Auth &
§Shared and referenced by the other apps.

---

## 9. Complete Screen Inventory
Every screen in the platform, with primary permission and target device class.

### Shared / Auth
| ID | Screen | Permission | Class |
|----|--------|-----------|-------|
| AU-01 | Splash / Bootstrap | — | all |
| AU-02 | Login | — | all |
| AU-03 | OTP request/verify | — | all |
| AU-04 | SSO (OIDC/SAML) | — | all |
| AU-05 | MFA step-up | — | all |
| AU-06 | Forgot / Reset password | — | all |

### Rider App (compact-first)
| ID | Screen | Permission |
|----|--------|-----------|
| R-01 | Home (Today) | trip.read |
| R-02 | Book a Seat | booking.create |
| R-03 | Recurring Bookings | booking.create |
| R-04 | My Bookings | booking.read |
| R-05 | My Trips / Trip Detail | trip.read |
| R-06 | Live Tracking (embedded) | tracking.read |
| R-07 | Notifications (shared) | — |
| R-08 | SOS (shared) | sos.raise |
| R-09 | Profile & Settings (shared) | — |
| R-10 | Eligibility / No-Access | — |

### Driver App (compact-first, offline-critical)
| ID | Screen | Permission |
|----|--------|-----------|
| D-01 | Splash / Login | — |
| D-02 | Permissions Primer | — |
| D-03 | Today (Assigned Trips) | trip.read |
| D-04 | Trip Detail / Manifest | trip.operate |
| D-05 | Stop Action Flow | trip.operate |
| D-06 | Navigate (hand-off) | trip.read |
| D-07 | Offline Queue / Sync Center | trip.operate |
| D-08 | Incidents / SOS | sos.raise |
| D-09 | Verification Blocked | — |
| D-10 | Profile & Documents | trip.read |

### Operations / Admin Console (expanded-first)
| ID | Screen | Permission |
|----|--------|-----------|
| O-01 | Dashboard | report.operational |
| O-02 | Control Tower | tracking.read |
| O-03 | Sites | site.manage |
| O-04 | Zones (geofence editor) | site.manage |
| O-05 | Shifts | shift.manage |
| O-06 | Cost Centers | costcenter.manage |
| O-07 | Routes & Stops | route.manage |
| O-08 | Schedules & Trip Generation | schedule.manage |
| O-09 | Holidays | site.manage |
| O-10 | Dispatch Board | trip.dispatch |
| O-11 | Assign Vehicle + Driver | trip.dispatch |
| O-12 | Bookings Management | booking.manage_any |
| O-13 | Waitlists | booking.manage_any |
| O-14 | Vehicles | vehicle.manage |
| O-15 | Drivers | driver.manage |
| O-16 | Driver Verification | driver.verify |
| O-17 | Vendors | vendor.manage |
| O-18 | Documents & Compliance | document.read |
| O-19 | Rate Cards | ratecard.manage |
| O-20 | Employees | employee.manage |
| O-21 | Employee Import (wizard) | employee.import |
| O-22 | HRIS Sync | employee.import |
| O-23 | Trip Costs | cost.read |
| O-24 | Vendor Invoices | invoice.read |
| O-25 | Reconciliation | invoice.reconcile |
| O-26 | ERP / SAP Export | erp.export |
| O-27 | Budgets | report.financial |
| O-28 | Reports | report.* |
| O-29 | Notification Templates | notification.template.manage |
| O-30 | Administration (users/roles/branding/integrations/settings) | user.manage / role.manage / branding.manage / tenant.manage |
| O-31 | Audit Log | audit.read |

### Super-Admin Console (expanded-first)
| ID | Screen | Permission |
|----|--------|-----------|
| S-01 | Tenants List | tenant.read |
| S-02 | Create / Onboard Tenant | tenant.manage |
| S-03 | Tenant Detail | tenant.read |
| S-04 | Plans & Billing | billing.manage |
| S-05 | Platform Health | tenant.read |
| S-06 | Feature Flags / Rollouts | tenant.manage |
| S-07 | Platform Audit | audit.read |

**Totals:** 6 shared/auth · 10 rider · 10 driver · 31 ops · 7 super-admin = **64 screens**.
