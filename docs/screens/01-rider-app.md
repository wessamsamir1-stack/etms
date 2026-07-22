# 01 — Rider App (Employee)

Phone-first, offline-tolerant. Bottom-nav shell: **Home · Trips · Bookings · Profile**,
with a persistent SOS affordance. Inherits all global conventions in
[README.md](./README.md); only deviations/specifics are listed.

Persona: **Rider** (`rider` role). All data is implicitly scoped to the signed-in
employee (ownership). Permissions used: `booking.create`, `booking.cancel`,
`booking.read`, `trip.read`, `tracking.read`, `sos.raise`.

---

## Auth & Onboarding (shared by all apps)

### AU-01 Splash / Bootstrap
- **Route:** `/` (pre-auth). **Purpose:** initialize backend, restore session, resolve tenant
  branding, decide first route.
- **Layout:** tenant logo centered (white-label); no interactive controls.
- **States:** Loading only (≤ 2 s target). If restore succeeds → Home; if no/expired session
  → Login; if config fetch fails → retry with cached branding, else neutral brand.
- **Business rules:** never block > 5 s; on timeout proceed to Login with cached tenant theme.
- **Responsive:** centered logo at all sizes.

### AU-02 Login
- **Route:** `/login`. **Persona:** all. **Purpose:** email/password or passwordless start.
- **Layout:** logo, `Email`, `Password` (show/hide), **Sign in**, "Sign in with SSO",
  "Use a code instead" (OTP), forgot-password link. Max content width 420 (centered on
  larger screens).
- **Validation:** email must contain `@`; password non-empty. Inline on blur; on submit
  focus first invalid field.
- **States:** Submitting → button spinner, form locked. Error → snackbar `loginError`
  (generic; never reveal whether email exists). Lockout after N failed attempts (tenant
  policy) → show cooldown timer.
- **Business rules:** on success, if MFA required → AU-05; else establish session, load
  branding, route by role (rider→Home). Tokens stored in secure storage; tenant context set.
- **Errors:** 401 generic; 429 → "Too many attempts, try again in mm:ss"; network → offline
  banner, allow retry.
- **Responsive:** single centered column all breakpoints.

### AU-03 OTP Request / Verify
- **Route:** `/login/otp`. **Purpose:** passwordless login by email/phone code.
- **Flow:** enter identifier → request code → 6-digit entry (auto-advance, paste-aware) →
  verify. Resend enabled after 30 s countdown; code TTL shown.
- **Validation:** identifier format; exactly 6 digits. **Errors:** wrong code → inline
  "Invalid or expired code"; max attempts → back to request.

### AU-04 SSO (OIDC/SAML)
- **Route:** `/login/sso`. **Purpose:** enterprise SSO. Opens IdP in a secure web view;
  on callback, JIT-provision + route by role. **Errors:** IdP denial → return to Login with
  message; domain-not-configured → guidance to contact admin.

### AU-05 MFA Step-up
- **Purpose:** second factor for login and sensitive actions. 6-digit TOTP/SMS entry.
  **Business rule:** required per tenant policy and always for `driver.verify`, `erp.export`,
  `role.*`, `billing.manage`. **Error:** invalid → inline; fallback factor link.

### AU-06 Forgot / Reset Password
- Request reset (email) → confirmation ("If the account exists, a link was sent" — no
  enumeration) → reset form (new + confirm, strength meter, policy rules) → success → Login.

---

## Rider Primary Screens

### R-01 Home (Today)
- **Route:** `/home`. **Purpose:** at-a-glance status of the rider's next/active trip.
- **Layout:** hero card = today's trip (status chip, pickup stop + time, live mini-map when
  in-progress, ETA), quick actions (Check-in, Track, Cancel), below: "Book a seat" CTA if no
  booking today; upcoming strip.
- **States:**
  - *Empty (no booking today):* friendly prompt + **Book a seat** CTA.
  - *Loading:* skeleton hero card.
  - *Offline:* last-known trip state + offline banner; live map replaced by last position.
  - *In-progress:* ETA updates via realtime; announced to screen readers.
- **Business rules:** Check-in visible only when trip is `assigned/started` and within
  check-in window/geofence; Cancel hidden once trip `started`.
- **Errors:** live stream drop → show last position + "reconnecting"; never blank the card.
- **Responsive:** compact single column; medium+ shows upcoming trips beside hero.

### R-02 Book a Seat
- **Route:** `/book`. **Permission:** `booking.create`. **Purpose:** request a seat for a shift.
- **Layout:** step form — Date (within booking window), Direction (inbound/outbound), Shift
  (from eligibility), optional pickup zone (defaults to home zone). Summary → **Confirm**.
- **Validation:** date within `[today, window_end]` and a working day for the shift; shift ∈
  employee eligibility; direction required. Disable dates outside window with reason on tap.
- **Business rules:** capacity checked server-side → response is **Confirmed** (201) with
  stop + pickup time, or **Waitlisted** (202) with position. Eligibility & distance-cap
  policy enforced server-side (client mirrors for UX). One live booking per
  date/shift/direction (duplicate → 409 → open existing).
- **States:** Submitting → locked; Success → confirmation sheet (stop, time, add-to-calendar);
  Waitlisted → explain position + notify-on-promotion.
- **Errors:** 409 duplicate → "You already have a booking" + view it; 422 policy → inline
  reason; offline → **queued** ("will confirm when online") with pending sync chip.
- **Responsive:** compact stepper; medium+ single-page form with summary aside.

### R-03 Recurring Bookings
- **Route:** `/book/recurring`. **Purpose:** standing booking (e.g., every working day,
  morning). **Layout:** direction + shift + day-of-week picker + start/end date (RRULE).
- **Validation:** at least one weekday; end ≥ start (or open-ended). **Business rules:**
  system pre-books each service date at window open; holidays suppressed; per-occurrence
  cancel allowed from R-05. **Empty:** "No recurring plans" + Create.

### R-04 My Bookings
- **Route:** `/bookings`. **Purpose:** manage upcoming bookings + view waitlists.
- **Layout:** segmented Upcoming / History; each row: date, shift, direction, status chip,
  cancel action (upcoming only). **Empty:** upcoming empty → Book CTA.
- **Business rules:** cancel allowed until cutoff (tenant policy) → frees seat, auto-promotes
  waitlist. Past bookings read-only. **Errors:** cancel after cutoff → 422 "Cancellation
  window closed".

### R-05 My Trips / Trip Detail
- **Route:** `/trips` (list) → `/trips/:id`. **Permission:** `trip.read` (own).
- **List layout:** upcoming + history; trip card = route, time, status.
- **Detail layout:** large **live ETA** + map, pickup stop + time, status timeline
  (scheduled→…→completed), **Check-in** button, driver/vehicle (masked plate), **Rate trip**
  (after completion), pinned **SOS**.
- **States:** Offline → last-known + banner; Live → position/ETA stream; Completed → rating
  prompt (1–5 + optional comment, one-time).
- **Business rules:** Check-in enabled only in-window/at-stop; produces proof (QR/tap) on the
  seat allocation. Rating editable within 24 h then locked.
- **Errors:** trip reassigned (409/realtime) → toast "Vehicle changed" + refresh manifest;
  check-in outside window → inline reason.
- **Responsive:** compact full-screen map with bottom sheet detail; expanded = map + side detail.

### R-06 Live Tracking (embedded)
- Part of R-01/R-05. **Purpose:** vehicle position + ETA. **States:** connecting / live /
  stale (">30 s no update" badge) / ended. **Offline:** last position frozen with timestamp.
  **A11y:** ETA changes announced politely; not color-only.

### R-07 Notifications (shared)
- **Route:** `/notifications`. **Purpose:** event feed (booking confirmed, driver arriving,
  cancellation, promotion from waitlist). **Layout:** grouped by day; unread emphasis; tap
  deep-links to the exact trip/booking. **Empty:** "No notifications". **Business rules:**
  mark-read on view; push deep-links resolve here or directly to target.

### R-08 SOS (shared, safety-critical)
- **Trigger:** persistent button on Home/Trip detail. **Permission:** `sos.raise`.
- **Flow:** press → confirm (2-step to avoid misfire, but ≤ 2 taps) → raises `incident`
  (`type=sos`) with current location → ops paged.
- **States:** Sending → prominent; Sent → "Help is on the way" + incident ref + live status;
  Failed → **auto-fallback to phone dialer** with the emergency number (never a dead end).
- **Business rules:** bypasses normal rate limits; works with minimal connectivity (queued +
  retried, and phone fallback). Location permission prompt handled inline.
- **Responsive:** full-width, unmissable at all sizes; reachable one-handed.

### R-09 Profile & Settings (shared)
- **Route:** `/profile`. **Layout:** name/role, **language** (AR/EN toggle → live RTL/LTR),
  theme (light/dark/system), notification channel prefs, devices/sessions, sign out.
- **Business rules:** language/theme persist locally + to profile; sign-out revokes session
  + clears secure storage. **Errors:** channel save offline → queued.

### R-10 Eligibility / No-Access
- Shown when an ineligible employee opens the app: explains status + who to contact (HR).
  No booking controls. **Permission:** authenticated but `eligible=false`.
