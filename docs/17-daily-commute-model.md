# 17 — Daily-Commute Model (no seat reservation)

> **Direction (Wessam):** ETMS is a **daily employee-commute** system, not a
> tourism/seat-booking app. Remove seat reservation, seat selection, waitlists
> and "seat management". Instead: a **passenger manifest** per trip with
> attendance statuses, stop **arrival + admin-configurable waiting timer**,
> automatic **No-Show**, an "**I'm on the way**" button, driver/employee screens,
> operational metrics, white-label, employee/vehicle history, rating, and lost &
> found. Keep it **simple, fast, multi-tenant, AR/EN, Kuwait-ready**.

## 1) Manifest instead of seats

Each trip has a **passenger manifest** (`trip_passenger`) — who is expected, who
boarded, who didn't. No seat is reserved or chosen. Attendance statuses:
`expected · on_the_way · boarded · no_show · excused · on_leave · removed`.
(The old `booking`/`seat_allocation`/waitlist tables have been **removed** —
V0024 — now that everything uses the manifest.)

- `POST /v1/trips/:id/passengers` add to manifest · `GET /v1/trips/:id/manifest` read (statuses + counts + current stop + countdown).
- `POST /v1/trips/:id/passengers/:pid/status` — excuse / on-leave / remove (perm `manifest.manage`).

## 2) Arrival at the pickup point

`POST /v1/trips/:id/stops/:stopId/arrive` `{by:'gps'|'driver'}` — set by GPS/geofence
or the driver's **"Arrived"** button. It flips the stop to `arrived`, and returns
the list of employees to notify + the bilingual message *"وصل باص الشركة إلى نقطة
التجمّع." / "The company bus has arrived…"*.

## 3) Waiting timer (admin-configurable)

Not fixed. Resolved as **route override → tenant policy → default (120s)**.

- `GET/PUT /v1/transport-policy` `{wait_seconds, notify_before_min, allow_driver_skip}` (perm `tenant.manage`).
- On arrival, `departs_at = arrived_at + wait_seconds`; the manifest returns
  `countdownSeconds`, `boarded` and `remaining` for the driver screen.

## 4) Pre-arrival notifications

`notify_before_min` (default `[10, 3]`) + on-arrival. The message templates and
recipient lists are produced by the API (`domain/commute` + the arrive endpoint);
**scheduling/sending** rides on the notification worker + push provider (interface
already in place — the remaining integration).

## 5) On timeout → No-Show

`POST /v1/trips/:id/stops/:stopId/depart` — marks every still-awaited passenger
(`expected`/`on_the_way`) at that stop as **`no_show`**, closes boarding, departs
the stop, and returns the No-Show list + message *"غادر الباص… وتم تسجيلك كـ «لم
تحضر». / …you were marked as No-Show."*.

## 6) "I'm on the way"

`POST /v1/trips/:id/on-the-way` (employee, perm `trip.attend`) → sets `on_the_way`
and returns a driver-facing message. **The countdown is NOT paused** — the bus
still leaves when the timer ends (response flag `countdown_not_paused`).

## 7–8) Driver & employee screens (app layer)

The API exposes everything the screens need — current stop, area name, expected /
boarded / remaining counts, countdown, colour-coded manifest (green=boarded,
amber=on the way, red=no-show, grey=excused/leave), the driver's Arrived / move-on
buttons (`allow_driver_skip`), and for the employee the live bus, ETA, status and
"I'm on the way". Building the Flutter screens themselves is the app-layer step.

## 9) Operational dashboard

`GET /v1/dashboard/operational?from&to` → total trips, completed, cancelled,
transported (boarded), No-Shows, on-time %, avg delay (min), avg wait (sec).
Rating leaderboard: `GET /v1/ratings/summary` (most-punctual drivers, etc.).

## 10) White-label

`GET/PUT /v1/branding` — app name, logo, primary/secondary colour, splash — so the
app looks owned by each company (`tenant_branding`, perm `branding.manage`).

## 11–12) Employee & vehicle history

`GET /v1/employees/:id/history` — trips, boarded, No-Shows, excused, last trip +
recent list. `GET /v1/vehicles/:id/history` — trips, passengers, last used, status
(no full maintenance system).

## 13) Trip rating

`POST /v1/trips/:id/rating` `{driver, cleanliness, ac, punctuality, comment}`
(1–5, perm `rating.create`); results roll up in `/v1/ratings/summary`.

## 14) Lost & found

`POST /v1/lost-items` `{trip_id, description}` (perm `lost_item.create`) — linked to
the trip and its driver; `GET /v1/lost-items` + `/:id/status` for ops.

## 15) Philosophy — kept

Simple, fast, company-focused; **no tourism features, no seat booking**; daily
employee trips only; multi-tenant with full isolation (RLS); Arabic + English;
Kuwait-ready and extensible to the rest of the GCC (all regional settings are
per-tenant columns).

---

## Verification (live, PostgreSQL 16 + PostGIS)

End-to-end and passing (suite **89/89**, incl. 3 new `domain/commute` unit tests):
admin set the waiting timer (3s) → stop defined, manifest of 2 expected (no seats)
→ driver **Arrived** (countdown 3s, 2 to notify, bilingual message) → manifest
shows countdown → employee **"on the way"** (countdown not paused) → driver
**boarded** one → **depart** auto-**No-Show**ed the other (bilingual message) →
final manifest boarded=1/no_show=1 → rating, lost-item, white-label branding,
operational metrics (transported=1, noShows=1, avgWait=3s), and employee history
(No-Shows=1) all confirmed.

### App layer
- **Driver & employee screens (§7–8): written** in Flutter under
  `etms_app/lib/features/commute/` (manifest models, `CommuteService`, Riverpod
  providers, `DriverTripScreen`, `EmployeeTripScreen`) and wired into the router
  (`/driver/trip/:tripId`, `/my/trip/:tripId`). Targeted at the project's Flutter
  3.22 / Dart 3.4; **reviewed, not compiled here** (no Flutter SDK) — run
  `flutter pub get && flutter analyze` and drive on a device/emulator.
- Visual reference: `docs/etms/driver-employee-apps.html`.

### Admin screens (Flutter web) — written
- **Waiting timer** (`TransportPolicyScreen`): presets (1/2/3/5 min) + slider,
  pre-arrival reminders, and the driver "Next stop" toggle → GET/PUT
  `/v1/transport-policy` (perm `tenant.manage`).
- **Branding** (`BrandingScreen`): app name, logo, primary/secondary colour with
  live swatches, splash → GET/PUT `/v1/branding` (perm `branding.manage`).
  Both are added to the admin shell.

### White-label applied at runtime — done
`app/branding_loader.dart` fetches `GET /v1/branding` on sign-in and pushes it
into `tenantThemeProvider`, so the whole app re-themes to the company's colours
and app name (and reverts to the neutral brand on sign-out). `AppTheme` already
consumes that provider.

### Remaining (integration)
- **Notification worker — built** (V0026): a standalone process
  (`scripts/notification-worker`) drains the `notification` outbox across all
  tenants (BYPASSRLS), delivers via the pluggable channel providers, and retries
  transient failures with exponential backoff (dead-letters after `maxAttempts`).
  Verified live — queued arrival/No-Show/OTP rows go to `sent`; concurrency-safe
  via `FOR UPDATE SKIP LOCKED`. **Still needs your keys:** the real gateway
  adapters (FCM push / Twilio SMS·WhatsApp / SMTP email) — today every channel
  uses the in-memory provider. **Not built:** generating the 10-/3-min
  *pre-arrival* reminders (the model is arrival-driven; `trip_stop` has no
  planned arrival time to schedule against).
- ~~Optional: retire the superseded booking/seat_allocation tables~~ — **done**
  (V0024): `booking` + `seat_allocation` dropped, the ride-request claim now adds
  the rider to the manifest, `mv_no_show` reads the manifest, and the booking API
  was removed. Suite 92/92.
