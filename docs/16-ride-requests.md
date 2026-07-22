# 16 — Ride Requests (staff pickup → offer → driver claim → manifest)

> **Business rule (Wessam):** a staff member sets their pickup location — **fixed**,
> **temporary**, or **changeable each time** — and leaves a ride request either
> **for a specific driver** or **broadcast to all drivers**. The **first driver to
> accept** it gets the rider **added to that trip's manifest**.

## The pickup (fixed / temporary / per-request)

Each staff member has one saved default pickup (`employee_pickup`):

- `GET /v1/my-pickup` · `PUT /v1/my-pickup` `{mode, label, address, valid_until?}` (perm `ride_request.create`).
- `mode`: **`fixed`** (ثابت — reused every time), **`temporary`** (مؤقت — with `valid_until`).
- A request can also carry a **`per_request`** pickup (يتغيّر كل مرة) that is used once and **not** saved.

## Creating a request

`POST /v1/ride-requests` (perm `ride_request.create`):

```json
{ "direction":"inbound", "service_date":"2026-07-20", "requested_time":"07:00",
  "pickup": {"useSaved": true}                      // or {"mode":"per_request","label":"…","address":"…"}
  , "target_driver_id": null }                       // null/omitted = broadcast to all
```

- `pickup.useSaved` → uses the saved default; a `fixed`/`temporary` pickup sent inline is also saved.
- `target_driver_id` set → offered to that one (verified) driver; omitted → **broadcast** to every **verified + available** driver.
- The response reports `mode` (`targeted` / `broadcast`) and `notifiedDrivers`. Offered drivers are recorded in `ride_request_offer`.

## The driver claims it

`POST /v1/ride-requests/:id/claim` (perm `ride_request.claim`):

1. The caller must be a driver the request was **offered** to (else `403`).
2. The claim is **atomic — first wins**: `UPDATE … WHERE status='open'`; a second claimant gets `409`.
3. The rider is **added to that driver's trip manifest** (daily-commute model — not a reserved seat): the driver's trip for the date + direction is found (or created with an assignment), a `trip_passenger` row is inserted with status `expected`, and the trip's occupancy counter is refreshed from the manifest. Capacity, when set, is checked against the active manifest. The response returns `{tripId, onManifest, capacity}`.

`POST /v1/ride-requests/:id/cancel` — the owner (while `open`) or a `ride_request.manage_any` holder; a cancel removes the rider from the manifest (`trip_passenger` → `removed`) if a claim had added them.

## Listing (role-aware)

`GET /v1/ride-requests` (perm `ride_request.read`):
- `?mine=rider` → my own requests. `?mine=driver` → open requests **offered to me**. Otherwise (with `ride_request.manage_any`) → all, filterable by `?date=` / `?status=`.

## Permissions (V0020)

`ride_request.create` (rider), `ride_request.read` (rider/driver/dispatcher/ops),
`ride_request.claim` (driver), `ride_request.manage_any` (dispatcher/ops) — all also on `company_admin`.

## Verification (live, against PostgreSQL 16 + PostGIS)

Exercised end-to-end and passing (backend suite **92/92**; re-verified after V0024
moved the claim onto the manifest):

- Rider saved a **fixed** pickup → created a **broadcast** request → **drivers notified**.
- **Driver claimed** → assigned, rider **added to the trip manifest** (`trip_passenger` = `expected`), trip created.
- A second claim on the taken request → **409** (first-wins).
- **Targeted** request (`per_request` pickup) → **1 notified**; a non-offered driver's claim → **403**; the offered driver's claim → added to their own trip's manifest.
- **Cancel** → the rider is removed from the manifest (`trip_passenger` = `removed`).
- Rider sees their 2 requests; the driver "offered to me" feed works.

### Next

- Push/SMS notification on offer + on claim (the `ChannelProvider` is already in place).
- Optional auto-expire of stale open requests; per-IP throttle on create.
