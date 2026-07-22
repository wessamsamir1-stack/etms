# 07 — UI/UX Structure

## 1. Design Principles
- **Material 3**, responsive (mobile → tablet → desktop web) from a single Flutter codebase.
- **Offline-first UX** — every field screen works without connectivity and shows sync state.
- **Role-tailored** — each persona sees only what they can act on (RBAC-driven navigation).
- **White-label** — theme (colors, logo, typography, app name) is per-tenant at runtime.
- **Bilingual first** — full **RTL (Arabic)** and **LTR (English)**; layouts mirror correctly.
- **Accessibility** — WCAG 2.1 AA: contrast, focus order, screen-reader labels, large tap targets.
- **Clarity over density** — the driver and rider apps are glanceable and one-handed.

## 2. Applications & Surfaces
| App / Surface | Primary users | Platforms |
|---------------|---------------|-----------|
| **Rider App** | Employees | Android, iOS (Web fallback) |
| **Driver App** | Drivers | Android, iOS |
| **Operations Console** | Ops Mgr, Dispatcher, HR, Finance, Vendor | Web (tablet/desktop) |
| **Super-Admin Console** | Platform ops | Web |

All share a common Flutter design-system package (tokens, components, theming, i18n).

## 3. Design System
- **Tokens:** color roles (primary/secondary/surface/error…), spacing scale (4/8pt),
  radius, elevation, typography ramp — all overridable per tenant via `theme_json`.
- **Core components:** app scaffold, adaptive nav (bottom bar mobile / rail+drawer web),
  data table (sortable, paginated), map panel, trip card, status chip, timeline,
  bottom sheets, empty/loading/error states, offline banner, form fields with inline
  validation, confirmation dialogs, toast/snackbar, SOS button.
- **Status color language:** scheduled (neutral), assigned (info), in-progress (primary),
  completed (success), exception/SOS (error), waitlisted (warning).
- **Iconography & motion:** Material symbols; motion used only to communicate state changes.

## 4. Information Architecture

### 4.1 Rider App
```
Home (today's trip: status, ETA, live map)
├─ Book (date, shift, direction → confirm/waitlist)
│   └─ Recurring bookings
├─ My Trips (upcoming / history)
│   └─ Trip detail (stop, pickup time, live tracking, check-in, rate)
├─ Notifications
├─ SOS (always reachable)
└─ Profile & language / theme
```

### 4.2 Driver App
```
Today (assigned trips list, next up highlighted)
├─ Trip detail
│   ├─ Manifest (riders per stop, check-in status)
│   ├─ Navigate (hand-off to maps)
│   ├─ Stop actions: arrived → pickup/no-show → drop-off (+proof)
│   └─ Start / Complete trip
├─ Offline queue (pending events, sync status)
├─ Incidents / SOS
└─ Profile & documents
```

### 4.3 Operations Console (role-tailored)
```
Dashboard (KPIs: on-time %, utilization, exceptions, no-shows)
├─ Control Tower (live map, fleet list, exception feed, SOS)
├─ Planning
│   ├─ Sites / Zones / Shifts
│   ├─ Routes & Stops (+ optimize)
│   └─ Schedules → Trip generation calendar
├─ Dispatch (trips board by date/status → assign vehicle+driver)
├─ Bookings (manage any, waitlists)
├─ Fleet (vehicles, drivers, vendors, documents, verification)
├─ Employees (list, import, HRIS status, eligibility)
├─ Finance (rate cards, trip costs, invoices, reconciliation, ERP export)
├─ Reports (operational / financial / safety, scheduled)
├─ Notifications (templates per channel/locale)
├─ Administration (users, roles & scopes, branding, integrations, settings)
└─ Audit log
```

### 4.4 Super-Admin Console
```
Tenants (list, create, suspend) → Tenant detail (plan, usage, health)
├─ Plans & Billing
├─ Platform health (uptime, error rates, queues)
└─ Feature flags / rollouts
```

## 5. Key Screen Specs (selected)

### Control Tower (Ops)
- Split view: **live map** (vehicle markers colored by status) + **right rail** exception
  feed (delays, off-route, SOS, no-vehicle) sorted by severity.
- Click a vehicle → trip drawer: manifest, ETA, actions (call driver, reassign, notify riders).
- SOS pins pulse and pin to top; one-click acknowledge → resolve flow.

### Dispatch Board
- Columns by status; each **trip card** shows route, shift, seats_taken/capacity, warnings
  (expired doc, capacity mismatch). Assign via searchable vehicle/driver picker that
  greys out invalid options with the reason inline.

### Rider Trip Detail
- Big **live ETA** + map, stop & pickup time, **Check-in** button (QR/tap), status timeline,
  **SOS** pinned. Offline: shows last-known state with a subtle "offline" banner.

### Driver Stop Flow
- One primary action at a time (large button): *Arrived → Pick up (per rider) → Depart*.
- Rider list with check-in toggles; no-show after countdown; proof capture (QR scan/photo).
- Everything writes locally first; a persistent chip shows "N events pending sync".

## 6. Offline-First UX Patterns
- **Optimistic UI:** actions apply instantly locally, reconcile on sync.
- **Sync indicator:** global chip — `Synced` / `N pending` / `Sync failed → retry`.
- **Conflict surfacing:** if server rejects an event, show a clear, actionable message
  (e.g., "Trip was reassigned — refresh manifest").
- **No dead-ends:** every screen renders from local cache; network is an enhancement.

## 7. Localization & RTL
- Direction-aware layouts (start/end, not left/right); mirrored icons where semantic.
- Numerals, dates, times, currency localized per tenant locale.
- Text externalized to ARB catalogs; pseudo-localization in CI to catch truncation.
- Per the project convention, mixed AR/EN content is line-separated to preserve direction.

## 8. Notifications & Empty/Error States
- Consistent empty states with a single clear next action.
- Errors are human, localized, and recoverable; destructive actions always confirm.
- Push deep-links open the exact trip/booking/incident.

## 9. Design-to-Dev Handoff
- Figma library mirrors the Flutter design-system package (Code Connect mapping).
- Tokens are the contract: design tokens ↔ Flutter theme extension ↔ tenant `theme_json`.
- Accessibility and RTL checks are part of the component definition-of-done.
