# 05 — Business Workflows

Each workflow lists trigger, actors, pre/post-conditions, the happy path, and key
exceptions. Diagrams use Mermaid.

## 1. Tenant Onboarding (white-label)

**Actors:** Super Admin, Company Admin.
**Pre:** Signed contract & plan selected. **Post:** Tenant live with branding + admin user.

```mermaid
sequenceDiagram
  participant SA as Super Admin
  participant Sys as Platform
  participant CA as Company Admin
  SA->>Sys: Create tenant (name, region, plan)
  Sys->>Sys: Provision tenant, seed roles/permissions/templates
  Sys->>CA: Invite Company Admin (email/OTP)
  CA->>Sys: Set branding (logo, colors, domain)
  CA->>Sys: Configure providers (map, SMS/WhatsApp, SSO)
  CA->>Sys: Import employees, sites, shifts (or HRIS sync)
  Sys-->>CA: Tenant ready → go live
```
**Exceptions:** custom-domain DNS not verified → tenant stays on `slug.app`; plan limits
exceeded during import → blocked with a clear quota message.

## 2. Master Data Setup & HRIS Sync
```mermaid
flowchart TD
  A[HR uploads CSV / HRIS webhook] --> B[Validate + dedupe by external_hr_id]
  B --> C{Valid?}
  C -->|No| D[Show error report, no commit]
  C -->|Yes| E[Dry-run preview: adds/updates/deactivations]
  E --> F[HR confirms]
  F --> G[Upsert employees, map zones by home location]
  G --> H[Audit + notify affected riders]
```

## 3. Route & Shift Planning
**Actors:** Operations Manager.
```mermaid
flowchart TD
  S[Select site + shift + direction] --> Z[Cluster eligible employees by zone]
  Z --> R[Draft route: ordered stops + capacity]
  R --> O{Use optimizer?}
  O -->|Yes| OPT[RouteOptimizerPort suggests stop order/vehicle mix]
  O -->|No| MAN[Manual stop ordering]
  OPT --> P[Publish route]
  MAN --> P
  P --> SCH[Attach schedule RRULE working days/holidays]
  SCH --> GEN[Scheduler generates trips per service_date]
```
**Exceptions:** demand exceeds fleet capacity → surplus riders waitlisted + alert to add a
vehicle; holiday calendar suppresses generation.

## 4. Booking & Seat Allocation
**Actors:** Rider, System.
**Pre:** Employee eligible; booking window open. **Post:** Seat confirmed or waitlisted.
```mermaid
sequenceDiagram
  participant Rider
  participant Sys as Booking Service
  participant Trip
  Rider->>Sys: Request seat (date, shift, direction)
  Sys->>Sys: Check eligibility + policy (distance cap, shift)
  Sys->>Trip: Find trip by zone/route with free capacity
  alt capacity available
    Sys->>Trip: Allocate seat, seats_taken++
    Sys-->>Rider: Confirmed (stop, pickup time)
  else full
    Sys-->>Rider: Waitlisted (position N)
  end
  Note over Sys: On cancellation, next waitlisted auto-promoted + notified
```
**Recurring:** rider sets an RRULE; system pre-books each service date at window open.

## 5. Dispatch (assign vehicle + driver)
**Actors:** Dispatcher.
```mermaid
flowchart TD
  T[Trip = SCHEDULED] --> V[Pick vehicle: capacity ≥ seats_taken, available, docs valid]
  V --> D[Pick driver: verified, available, license valid]
  D --> CHK{Conflicts? double-book / expired doc}
  CHK -->|Yes| FIX[Block + suggest alternatives]
  CHK -->|No| ASSIGN[Create assignment → trip ASSIGNED]
  ASSIGN --> N[Notify driver + riders]
```
**Exceptions:** no vehicle/driver available → trip flagged `exception`, escalated to Ops.

## 6. Trip Execution (field, offline-capable)
**Actors:** Driver, Riders, System.
```mermaid
stateDiagram-v2
  [*] --> ASSIGNED
  ASSIGNED --> STARTED: driver accepts + starts (geostamp)
  STARTED --> IN_PROGRESS: first stop reached
  IN_PROGRESS --> IN_PROGRESS: pickup/dropoff per stop (+proof)
  IN_PROGRESS --> COMPLETED: last drop-off at site
  ASSIGNED --> CANCELLED: cancelled before start
  STARTED --> EXCEPTION: breakdown/accident/SOS
  IN_PROGRESS --> EXCEPTION: off-route/SOS
  EXCEPTION --> IN_PROGRESS: resolved / reassigned
  COMPLETED --> [*]
```
- **Offline:** driver marks events into a local **outbox**; GPS buffered; everything
  syncs on reconnect with `client_event_id` idempotency (no duplicates).
- **Proof of pickup:** rider check-in (QR/tap) or driver photo; recorded on `seat_allocation`.
- **No-show:** after configurable wait, driver flags no-show → seat released, logged, rider notified.

## 7. Live Tracking & Exception Handling (Control Tower)
```mermaid
sequenceDiagram
  participant Drv as Driver App
  participant RT as Tracking
  participant CT as Control Tower
  participant Rider
  Drv->>RT: GPS ping (buffered offline, streamed online)
  RT->>RT: Detect delay / off-route / missed stop (geofence)
  RT-->>CT: Raise exception (severity)
  RT-->>Rider: Live ETA / position
  CT->>CT: Ops triages: call driver / reassign / notify riders
  Note over Drv,CT: SOS → high-priority incident, pages on-call, shares location
```

## 8. Costing & Invoice Reconciliation
**Actors:** System, Finance.
```mermaid
flowchart TD
  TC[Trip COMPLETED event] --> CC[Compute cost from rate card]
  CC --> AL[Allocate to cost-center by riders/site]
  AL --> STORE[trip_cost recorded]
  INV[Vendor uploads invoice] --> MATCH[Match invoice lines to trip_costs]
  MATCH --> V{Within tolerance?}
  V -->|Yes| OK[Line = matched]
  V -->|No| FLAG[Line = variance → dispute]
  OK --> APπR[Finance approves]
  FLAG --> DISP[Finance disputes with vendor]
  APπR --> EXP[Export/post to ERP/SAP + CSV]
```
**Rules:** costing is deterministic and reproducible from rate card + trip facts; variance
threshold is tenant-configurable; disputes track resolution to closure.

## 9. Notifications (event-driven)
| Event | Recipients | Channels |
|-------|-----------|----------|
| Booking confirmed / waitlisted | Rider | push, WhatsApp |
| Trip assigned | Driver, Riders | push |
| Driver arriving (geofence) | Rider | push, SMS |
| Trip cancelled / reassigned | Riders | push, SMS, WhatsApp |
| SOS / incident | Ops on-call | push, SMS, call escalation |
| Document expiring | Vendor Mgr, Ops | email, push |
| Invoice variance | Finance | email |

Templates are tenant-, channel-, and locale-specific; delivery is retried with receipts.

## 10. Reporting Cycle
Operational dashboards update near-real-time from read models; financial and safety
reports run on schedule and can be exported/emailed. All report reads respect ABAC scope.

## 11. Exception & Escalation Summary
| Situation | Detection | Automatic action | Human escalation |
|-----------|-----------|------------------|------------------|
| Overbooked shift | Booking capacity check | Waitlist surplus | Ops adds vehicle |
| No vehicle/driver | Dispatch check | Trip → exception | Dispatcher/Ops |
| Delay / off-route | Geofence + ETA | Notify riders | Control tower |
| SOS | Panic button | Incident + page | On-call ops |
| Doc expired | Nightly job | Block assignment | Vendor manager |
| Invoice variance | Reconciliation | Flag line | Finance dispute |
