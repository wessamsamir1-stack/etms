# 03 — Operations / Admin Console

Web + tablet, **expanded-first** (master–detail, data tables). Left nav is **RBAC-driven**:
destinations render only for permitted roles. Inherits [README.md](./README.md) globals; auth
is shared ([01](./01-rider-app.md) §Auth, incl. SSO/MFA). All lists are **ABAC-scoped** to the
user's sites/cost-centers and paginated (cursor).

Primary personas: Operations Manager, Dispatcher, HR/Admin, Finance, Vendor Manager,
Company Admin, Auditor (read-only). Permission per screen is stated inline; see
[04-roles-rbac.md](../04-roles-rbac.md).

### Shared CRUD-list pattern (referenced as "standard CRUD")
Toolbar (search + filters + **New**) · sortable paginated table (cards on compact) ·
row → detail/drawer · create/edit in dialog (medium+) or full page (compact) · delete with
confirm (soft-delete). **States:** loading = skeleton rows; empty-new = "No X yet" + New;
empty-filtered = "No matches" + Clear filters; error = ErrorView+Retry; submitting = locked
form. **Validation** on blur + submit; server `422`→inline. **Responsive:** table→cards on
compact; create dialog→full page on compact. Read-only roles: New/edit/delete disabled.

---

### O-01 Dashboard
- **Permission:** `report.operational`. **Purpose:** daily operational health.
- **Layout:** KPI tiles (on-time %, fleet utilization, exceptions open, no-shows, SOS today),
  trend charts, "needs attention" list (unassigned trips, expiring docs, invoice variances).
- **States:** loading = tile skeletons; empty (new tenant) = onboarding checklist; offline =
  last-cached figures + timestamp. **Business rules:** figures respect ABAC scope; tiles
  deep-link to filtered lists. **Errors:** partial data → render available tiles, mark stale.
- **Responsive:** 4-col tiles (large) → 2 (medium) → 1 (compact); charts scroll horizontally
  inside their container.

### O-02 Control Tower
- **Permission:** `tracking.read` (+`incident.resolve` to act). **Purpose:** live fleet ops.
- **Layout:** split — **live map** (vehicle markers colored by status) + **right rail**
  exception feed (delays, off-route, missed stop, **SOS** pinned top), sorted by severity.
  Click vehicle → trip drawer (manifest, ETA, actions: call driver, reassign, notify riders,
  resolve incident).
- **States:** connecting / live / degraded ("realtime reconnecting", markers show last
  position + age) / empty ("no active trips"). **Offline (ops device):** read-only last
  snapshot + banner. **SOS:** pulses, pins to top, one-click **Acknowledge → Resolve** flow.
- **Business rules:** actions require the right permission (reassign→`trip.reassign`);
  geofence events auto-update status; SOS ack/resolve audited and timestamped (SLA < 60 s).
- **Errors:** stream drop → auto-reconnect + banner; action 409 → refresh drawer.
- **Responsive:** large = map+rail+drawer (3 panes); medium = map + collapsible rail; compact
  = tabbed Map / Exceptions (not the primary target device).

### Planning

### O-03 Sites  ·  O-05 Shifts  ·  O-06 Cost Centers
- **Permission:** `site.manage` / `shift.manage` / `costcenter.manage` (read variants to view).
- Standard CRUD. **Site** adds a map to set location + draw **geofence** polygon, timezone.
  **Shift** adds start/end time + working-days picker (≥1 day; validate end vs start / overnight
  allowed). **Cost center** supports parent (hierarchy; prevent cycles). **Business rules:**
  code unique per tenant (soft-deleted codes reusable); deleting a site with active
  routes/trips is blocked with explanation.

### O-04 Zones (geofence editor)
- **Permission:** `site.manage`. **Purpose:** define pickup catchment polygons per site.
- **Layout:** map with polygon draw/edit tools + zone list; centroid auto-computed.
- **Validation:** closed polygon, min 3 points, within reasonable bounds. **Business rules:**
  zones drive routing + employee home-zone mapping; editing a zone re-evaluates affected
  employees (async, with a summary). **Empty:** "Draw the first zone".

### O-07 Routes & Stops
- **Permission:** `route.manage`. **Purpose:** define ordered stops per site/shift/direction.
- **Layout:** route list → route editor: metadata (site, shift, direction, status) + **ordered
  stops** (drag to reorder, `seq`), each stop = zone/point + planned offset; map preview;
  optional **Optimize** (suggests order/vehicle mix, pluggable engine) with accept/reject diff.
- **Validation:** ≥1 stop; unique seq; offsets ≥ 0 and monotonic (warn if not). **Business
  rules:** publishing (draft→active) enables scheduling; archived routes stop generating trips.
- **States:** optimize running = inline progress; empty = "Add stops". **Errors:** optimizer
  unavailable → manual still works, notice shown.
- **Responsive:** large = map + stop list side-by-side; compact = stacked with map collapsible.

### O-08 Schedules & Trip Generation
- **Permission:** `schedule.manage`. **Purpose:** recur routes into dated trips.
- **Layout:** per-route schedule (RRULE builder: weekdays, start/end date) + **generation
  calendar** (preview generated trips per date, honoring holidays) + **Generate** action for
  a date range.
- **Validation:** end ≥ start; at least one recurrence; range caps (guardrail). **Business
  rules:** generation is idempotent (one trip per route/date/direction); holidays suppress;
  capacity from assigned/default vehicle. **States:** generating = progress + count; result
  summary (created/skipped). **Errors:** partial generation → per-date status.

### O-09 Holidays
- **Permission:** `site.manage`. Standard CRUD of holiday dates (per-site or all-sites);
  used by O-08. Validation: unique per (site, date).

### Dispatch

### O-10 Dispatch Board
- **Permission:** `trip.read` (+`trip.dispatch`/`reassign`/`cancel`). **Purpose:** assign
  vehicle+driver to each trip.
- **Layout:** date + filters; **columns by status** (Scheduled / Assigned / In-progress /
  Exception); each **trip card** shows route, shift, seats_taken/capacity, warnings (capacity
  mismatch, expired doc). Drag or click → Assign (O-11).
- **States:** empty (no trips for date) = generate/plan hint; exception column highlighted;
  offline = read-only. **Business rules:** unassigned near start time flagged; bulk-assign
  supported. **Errors:** concurrent assign (409) → card refresh + toast.
- **Responsive:** large = kanban columns; compact = single status filter + list.

### O-11 Assign Vehicle + Driver (dialog)
- **Permission:** `trip.dispatch`/`trip.reassign`. **Purpose:** pick a valid vehicle + driver.
- **Layout:** searchable pickers; **invalid options greyed with inline reason** (capacity <
  seats, unavailable, expired doc, unverified driver, double-booked). Summary → Confirm.
- **Validation:** capacity ≥ seats_taken; driver verified + available + license valid; no
  time conflict. **Business rules:** creates/updates `assignment` → trip `ASSIGNED`; notifies
  driver + riders; reassignment notifies riders of change. **Errors:** none valid → "No
  eligible vehicle/driver" + escalate (mark exception). Sensitive (reassign mid-trip) confirms.

### Bookings

### O-12 Bookings Management  ·  O-13 Waitlists
- **Permission:** `booking.read` (+`booking.manage_any`). **Purpose:** oversee/adjust rider
  bookings; manage waitlists.
- **Layout:** filters (date/shift/site/status); table of bookings; actions: create-for-rider,
  cancel, move, promote from waitlist. Waitlist view ordered by position.
- **Business rules:** promote fills freed seat + notifies; manual create enforces same
  eligibility/capacity rules as R-02. **Errors:** capacity race (409) → refresh.

### Fleet

### O-14 Vehicles  ·  O-15 Drivers  ·  O-17 Vendors
- **Permission:** `vehicle.manage` / `driver.manage` / `vendor.manage`. Standard CRUD.
  **Vehicle:** plate (unique/tenant), type, capacity ≥1, vendor, status, inspection/insurance
  expiry (warn when near). **Driver:** identity, phone (E.164), license + expiry, vendor,
  availability, verification status. **Vendor:** contact, status, contracts. **Business
  rules:** retiring/maintenance vehicles and unavailable/unverified drivers are excluded from
  O-11; vendor-manager role sees **only own** fleet (ABAC + ownership).

### O-16 Driver Verification
- **Permission:** `driver.verify` (**MFA step-up**). **Purpose:** review docs → verify/reject.
- **Layout:** queue of pending drivers → detail (documents viewer, checks) → Verify / Reject
  (reason required). **Business rules:** verify/reject audited; only verified+valid-doc drivers
  are assignable. **Errors:** doc load fail → retry; reject requires reason (validation).

### O-18 Documents & Compliance
- **Permission:** `document.read`. **Purpose:** fleet-wide expiry dashboard (from
  `v_expiring_documents`). **Layout:** filters by entity/type/expiry window; export.
  **Business rules:** ≤30-day expiries alert owners; expired blocks assignment.

### O-19 Rate Cards
- **Permission:** `ratecard.manage`. Standard CRUD. Fields: vendor, model
  (per_km/per_trip/per_seat/fixed_monthly), rate ≥0, currency, min charge, effective dates.
  **Validation:** effective_to ≥ effective_from; warn on overlapping active cards
  (same vendor+model). **Business rules:** drives O-23 costing; changes are versioned by
  effective dates (not destructive).

### Employees

### O-20 Employees
- **Permission:** `employee.manage`. Standard CRUD + rich filters (site, shift, cost center,
  eligibility). Fields: HR id, name, department, cost center, default site/shift, home
  location (map, **PII — encrypted**), eligibility. **Business rules:** home location maps to
  zone; toggling eligibility affects booking. **Responsive:** table→cards on compact.

### O-21 Employee Import (wizard)
- **Permission:** `employee.import`. **Purpose:** bulk CSV/Excel import.
- **Flow:** upload → column mapping → **dry-run preview** (adds / updates / deactivations +
  row-level errors) → confirm → commit → result report (downloadable). **Validation:** file
  type/size; required columns; per-row validation surfaced before commit. **Business rules:**
  dedupe by `external_hr_id`; nothing writes until confirm; audited; large files chunked.
  **States:** validating / preview / committing (progress) / done. **Errors:** invalid file →
  no commit, error report.

### O-22 HRIS Sync
- **Permission:** `employee.import`. **Purpose:** configure + monitor HRIS integration.
- **Layout:** connection status, last sync, schedule, field mapping, run-now, sync history +
  diffs. **Business rules:** upsert by external id; webhook + scheduled; dry-run previews for
  large deltas. **Errors:** auth/mapping failures shown with remediation.

### Finance

### O-23 Trip Costs
- **Permission:** `cost.read`. **Purpose:** browse computed per-trip costs.
- **Layout:** filters (period, site, cost center, vendor); table with amount, model,
  cost-center allocation, breakdown drawer (reproducible calc inputs). Export CSV/Excel.
  **Business rules:** deterministic from rate card + trip facts; read-only (recompute is a
  system action). **Empty:** "No costed trips in range".

### O-24 Vendor Invoices  ·  O-25 Reconciliation
- **Permission:** `invoice.read` (+`invoice.reconcile`). **Purpose:** import invoices, match
  to trip costs, resolve variances.
- **Layout:** invoice list (status: received/reconciled/disputed/approved/paid) → detail with
  **lines** matched to `trip_cost`; each line shows recon status (matched/variance/unmatched)
  + variance amount. Actions: auto-reconcile, dispute, approve.
- **Validation:** import file format; amounts ≥0. **Business rules:** variance threshold is
  tenant-configurable; **separation of duties** — approver ≠ trip-cost recorder; disputes
  tracked to closure; approve is auditable. **States:** reconciling = progress; empty =
  "Import an invoice". **Errors:** unmatched lines highlighted for manual match.

### O-26 ERP / SAP Export
- **Permission:** `erp.export` (**MFA step-up**). **Purpose:** post approved costs to ERP.
- **Layout:** select period + format (sap_idoc/csv/xlsx/json) → preview → **Post/Export**;
  history with status (pending/posted/failed) + idempotency key + retry.
- **Business rules:** idempotent (dup key → no double post); retried with DLQ; only approved
  lines. **Errors:** ERP down → queued + retry, clear status; never silently drop.

### O-27 Budgets (vs actual)
- **Permission:** `report.financial`. Per-cost-center budget vs actual with overrun alerts.
  Standard CRUD for budgets; charts respect scope.

### O-28 Reports
- **Permission:** `report.operational` / `report.financial` / `report.safety` (tabs gated per
  permission). **Purpose:** operational (on-time, utilization, no-shows, exceptions),
  financial (cost per trip/site/CC, vendor spend, variance), safety (trips tracked, verified
  drivers, incident log). **Layout:** filter panel + table/charts + **export** + **schedule
  delivery**. **Business rules:** all reads ABAC-scoped; scheduled reports emailed. **Empty:**
  "No data for filters" + Clear. **Responsive:** charts in horizontal-scroll containers.

### O-29 Notification Templates
- **Permission:** `notification.template.manage`. **Purpose:** per-event, per-channel,
  per-locale templates (push/sms/email/whatsapp). **Layout:** template list → editor with
  variable palette + **live preview** per channel/locale + test-send. **Validation:** required
  body; valid variables; channel limits (SMS length). **Business rules:** unique
  (code, channel, locale); inactive templates fall back to default.

### Administration

### O-30 Administration (Users · Roles & Scopes · Branding · Integrations · Settings)
Sub-sections gated individually:
- **Users** (`user.manage`): invite/disable, assign roles + **ABAC scope** (sites/cost
  centers), manage sessions/MFA. Validation: email/phone; at least one role.
- **Roles & Permissions** (`role.manage`, **MFA**): clone system roles, toggle permissions in
  the matrix, name custom roles. Business rule: can't grant a permission you lack; changes
  audited (before/after).
- **Branding** (`branding.manage`): app name, logo upload, primary/secondary colors (hex
  validated), live white-label preview, custom domain (DNS verify status). Applies to all apps.
- **Integrations** (`tenant.manage`): providers for map, SMS/WhatsApp/email, SSO, ERP, HRIS —
  keys stored encrypted; test-connection buttons. Never display stored secrets back.
- **Settings** (`tenant.manage`): policies (booking window, cancel cutoff, no-show wait,
  variance threshold), locale/currency/timezone defaults, feature flags.
- **States/Errors:** standard CRUD; sensitive actions require MFA + confirm; test-connection
  shows success/failure inline.

### O-31 Audit Log
- **Permission:** `audit.read`. **Purpose:** immutable trail (who/what/when, before/after).
- **Layout:** filters (actor, entity, action, date) + paginated table → entry detail with
  before/after JSON diff. **Business rules:** read-only, scope-respecting, retained per policy;
  no export of raw PII beyond permission. **Empty:** "No matching events". **Responsive:**
  table→cards on compact; diff in scrollable container.
