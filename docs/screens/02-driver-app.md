# 02 — Driver App

Phone-first and **offline-critical**: every field action must work with no connectivity and
sync later (outbox + idempotent replay — see `etms_app/lib/core/offline`). Inherits
[README.md](./README.md) globals. Auth screens are shared (see
[01-rider-app.md](./01-rider-app.md) §Auth).

Persona: **Driver** (`driver` role), scoped to **own** assigned trips. Permissions:
`trip.read`, `trip.operate`, `tracking.read`, `incident.read`, `sos.raise`.

**Global driver rules:** one large primary action at a time; all writes are optimistic and
queued locally first; a persistent **sync chip** shows `Synced / N pending / failed`; GPS
streams while a trip is active (buffered offline).

---

### D-01 Splash / Login
As AU-01/AU-02 but routes a driver to **Today** (D-03). If the linked `driver` record is
unverified → D-09 blocked state.

### D-02 Permissions Primer
- **Purpose:** request location (always/while-using), notifications, battery-optimization
  exemption before first trip. **Layout:** rationale per permission + Enable buttons.
- **Business rules:** location is mandatory to start a trip; if denied, D-04 start is blocked
  with a clear fix path. Re-entrant (can be revisited from Profile).

### D-03 Today (Assigned Trips)
- **Route:** `/driver/today`. **Purpose:** the driver's trips for the day, next-up highlighted.
- **Layout:** date header, list of assigned trips (route, shift, direction, seats, start
  time, status); the imminent trip is elevated with **Start** CTA.
- **States:** *Empty:* "No trips assigned today". *Offline:* cached list + banner; fully
  usable. *Loading:* skeleton list (only if no cache). *Sync:* chip in app bar.
- **Business rules:** only trips assigned to this driver; Start enabled at/after
  `planned_start - lead` and when location is available; a trip already `completed` is
  read-only.
- **Errors:** reassignment while viewing → toast + list refresh (trip may disappear).
- **Responsive:** compact list; tablet shows list + selected-trip manifest side-by-side.

### D-04 Trip Detail / Manifest
- **Route:** `/driver/trips/:id`. **Purpose:** operate one trip stop-by-stop.
- **Layout:** header (route, status, seats), **Start/Complete** primary button, ordered
  **stops** list; each stop expands to its **riders** with check-in state; Navigate hands off
  to maps.
- **States:** *Assigned→Started→In-progress→Completed* reflected live; *Offline:* everything
  works, actions queue (pending count shown per action).
- **Business rules:** stops actioned in sequence (out-of-order allowed with confirm); can't
  Complete until last stop drop-off done (override → logs exception). Manifest = seat
  allocations for the trip.
- **Errors:** stale manifest (server changed) → "Manifest updated" banner + merge; start
  without location → blocked with fix.
- **Responsive:** compact single column; tablet map + manifest.

### D-05 Stop Action Flow (Arrive → Pick up / No-show → Depart)
- **Purpose:** capture boarding truthfully with proof. **Flow:** **Arrived** (geostamped) →
  per-rider **Pick up** (proof: rider QR/tap, or driver photo, or manual with reason) or
  **No-show** (after configurable wait countdown) → **Depart**. Drop-off flow mirrors at
  destination.
- **Validation:** proof required per tenant policy for pickup; no-show only after wait timer
  elapses; photo size-limited.
- **Business rules:** each action emits a `trip_event` with `client_event_id` (idempotent);
  no-show releases the seat + notifies rider + logs; all geostamped.
- **States:** each action optimistic (instant local update) → queued → synced; conflict on
  replay resolves server-authoritative (last-writer-wins, audited).
- **Errors:** camera/permission fail → allow manual proof with reason; never block the trip.
- **Responsive:** big single-action buttons; one-handed; large countdown for no-show.

### D-06 Navigate (hand-off)
- Deep-links to the device maps app with the next stop / route. **Offline:** shows cached
  stop coordinates + last route geometry. Not a full in-app map (documented out-of-scope v1).

### D-07 Offline Queue / Sync Center
- **Route:** `/driver/sync`. **Purpose:** transparency into pending mutations.
- **Layout:** list of queued events (type, trip, time, attempts, last error) + **Retry now**
  + overall sync state. **Empty:** "All changes synced". **Business rules:** manual retry
  triggers a drain; exhausted-retry items flagged for support with details. **Errors:**
  surfaced per item (human message + collapsible detail).

### D-08 Incidents / SOS
- **Route:** `/driver/incidents`. **Purpose:** raise breakdown/accident/SOS; see status.
- **Flow:** choose type + severity + note + location → creates `incident`. SOS is one-tap
  (2-step confirm) with **phone fallback** on failure (as R-08).
- **Business rules:** high-priority incidents page ops; driver sees ack/resolve status live.
  **Offline:** queued + retried; SOS also offers direct call.

### D-09 Verification Blocked
- Shown when `driver.verification_status ∈ {pending, rejected}`. Explains status, lists
  missing/expiring documents (from D-10), contact vendor/ops. **No trip operation allowed.**
- **Business rule:** assignment is blocked server-side for unverified drivers / expired docs.

### D-10 Profile & Documents
- **Route:** `/driver/profile`. **Layout:** identity, vehicle (if fixed), **documents**
  (license, ID, medical) with expiry + status, upload/replace, language, sign out.
- **Validation:** document type required; expiry date; file type/size limits.
- **Business rules:** expiring/expired docs surface warnings and can block assignment; uploads
  go to object storage; changes audited. **Offline:** uploads queued.
