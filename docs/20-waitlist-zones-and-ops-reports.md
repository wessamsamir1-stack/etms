# 20 — Waiting list, zone matching, and the operational report pack

Three additions on top of the daily-commute model (docs/17) and ride requests
(docs/16), plus the reports ops asked for. Database: `V0031` (waiting list +
capacity), `V0032` (zone matching), `V0033` (report views).

---

## 1. Trip waiting list

The daily-commute model has no reserved seats — but a bus still has a number of
seats. Until now nothing stopped ops from putting a 40th employee on a 30-seat
manifest, and a rider whose bus was full simply got a "full" error and was left
to sort it out themselves.

### Capacity

Resolved once, in SQL, so the guard, the manifest screen and the reports can
never disagree:

| Function | Meaning |
|---|---|
| `app_trip_capacity(trip)` | `trip.capacity`, else the assigned vehicle's capacity, else `NULL` = uncapped |
| `app_trip_occupied(trip)` | manifest rows in `expected` / `on_the_way` / `boarded` |
| `app_trip_remaining_seats(trip)` | free seats, `NULL` when uncapped, never negative |

A no-show, an excused passenger or a removal frees the place — that is what
"occupied" means in a commute model.

### Flow

```
POST /v1/trips/:id/passengers
      │
      ├─ seats free ──────────────► 201  added to the manifest
      │
      └─ bus full ────────────────► 202  { waitlisted: true, position: 1 }
                                          (send waitlist:false to get 409 instead)

seat frees (excuse / remove / no-show at a stop / ride request cancelled)
      │
      └─► promoteWaitlist() ─► head of the queue joins the manifest + push notification
```

The check-then-insert is serialized with `SELECT … FROM trip … FOR UPDATE`, so
two concurrent adds cannot both take the last seat.

### Endpoints

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/v1/trips/:id/waitlist` | `waitlist.read` | queue + seat summary; `?status=` filters |
| `POST` | `/v1/trips/:id/waitlist` | `waitlist.manage` | queue someone explicitly; promotes at once if a seat is free (201) or queues (202) |
| `DELETE` | `/v1/trips/:id/waitlist/:wid` | `waitlist.manage` | withdraw an entry — it can never be promoted afterwards |
| `POST` | `/v1/trips/:id/waitlist/promote` | `waitlist.manage` | manual kick of the promotion pass |

`GET /v1/trips/:id/manifest` now also returns `capacity`, `occupied`,
`remaining_seats` and `waiting`, which is what the driver screen shows as
"seats left".

Promotion reinstates a passenger who was previously removed or no-showed rather
than duplicating them (the manifest is unique per trip + employee).

---

## 2. Zone matching for ride requests

A driver only wants the requests that are on the road they are already driving.
Each driver proposes a daily plan — a time window and a set of zones (docs/14);
once ops approves it, a request's pickup point can be tested against those zone
boundaries:

```sql
ST_Covers(zone.boundary, ride_request.pickup_location)
```

`ST_Covers`, not `ST_Within`, so a pickup exactly on the boundary counts as
inside.

- `POST /v1/ride-requests` and `PUT /v1/my-pickup` now accept `lat`/`lng` and
  persist the point (`ride_request.pickup_location`, `employee_pickup.location`).
- Without a point, the employee's registered **home zone** is used instead.
- `GET /v1/ride-requests?mine=driver` returns `matches_route` per row:
  `true` / `false`, or `null` when the driver has no approved plan for that date
  — there is no route to compare against, and that is not the same as "no match".
- `&matchMyRoute=true` returns only the matching requests.

---

## 3. Operational report pack

All under `report.operational`, all `?from=&to=` (inclusive dates), all
RLS-scoped.

| Endpoint | Answers |
|---|---|
| `GET /v1/reports/driver-ops` | per driver: trips, on-time %, passengers, no-shows, rating, violations, incidents |
| `GET /v1/reports/vehicle-ops` | per bus: trips, passengers, seat utilization %, fuel cost, km driven, cost/km, violations, document expiry |
| `GET /v1/reports/trip-duration` | planned vs actual duration, start delay, overrun — per trip and per route |
| `GET /v1/reports/inefficient-trips` | the laps: driven distance vs the planned route, idling, overrun |
| `GET /v1/reports/fuel-efficiency` | km/litre per bus with an **anomaly flag** |
| `GET /v1/reports/route-cost` | trip cost + fuel + fines per route; cost per trip / passenger / km |
| `GET /v1/reports/attendance-discipline` | per employee: scheduled, boarded, no-show %, discipline flag |
| `GET /v1/reports/plan-adherence` | did the driver drive the window and the zones they proposed |

### How the two judgement calls are made

**Detour detection** (`inefficient-trips`). The GPS trail gives the distance
actually driven (`ST_Length` over the ordered pings); the planned route length
(`v_route_planned_km`) is the yardstick, falling back to the straight line
between the first and last ping. Three independent signals, any of which flags
the trip:

| Flag | Default trigger | Tune with |
|---|---|---|
| `detour` | driven ÷ reference > 1.35 | `?detour_ratio=` |
| `idling` | > 40 % of pings stationary (< 5 km/h) | `?idle_share=` |
| `overrun` | > 30 % longer than planned | `?overrun_pct=` |

Trips with a reference distance under 1 km are ignored — GPS noise, not a lap.

**Fuel anomalies** (`fuel-efficiency`). Each bus's km/litre over the period is
compared with the **fleet median of the same period**, not a fixed target, so
the flag survives a change of fuel price, route mix or season. Median rather
than mean: one leaking bus would drag a mean down far enough to make itself look
normal. A bus is flagged when it runs below 75 % of the median km/L
(`low_km_per_liter`) or pays more than 125 % of the median cost/km
(`high_cost_per_km`). Too few fills, or fills without odometer readings, report
`insufficient_data` — never an anomaly, because we cannot tell.

Both rules live in pure, unit-tested modules (`domain/fleet/*`), so the
thresholds can be argued about without touching SQL.

### The app screens

| Screen | Where | Shows |
|---|---|---|
| Driver trip (manifest) | `features/commute/.../driver_trip_screen.dart` | a seats bar — *N مقعد متاح* / *الباص ممتلئ* — and the waiting list under the manifest, with remove + promote for `waitlist.manage` |
| Ride requests | `features/ride_requests/` | the driver's open offers, each badged **على مسارك** / **خارج مسارك** / **مفيش خطة معتمدة**, a "على مساري بس" filter, and a claim button that says whether the rider was seated or queued at position *N* |
| Operational reports | `features/fleet_ops/.../ops_reports_screen.dart` | the eight reports over a date range, one at a time — anomaly and discipline flags are badged rather than buried in a column |

The three states of `matches_route` are kept distinct in the UI on purpose:
"no approved plan" is grey, not the amber of "off your route" — the driver is
being told the system has nothing to compare against, not that the ride is far.

### Views (V0033)

| View | Contents |
|---|---|
| `v_trip_duration` | planned vs actual per trip, joined to route / driver / vehicle |
| `v_trip_track` | per-trip GPS aggregates: driven km, straight-line km, idle pings, speeds |
| `v_route_planned_km` | planned length of each route from its stops |
| `v_driver_plan_adherence` | plan vs the day's trips and the share of pings inside the planned zones |
| `v_trip_seats` (V0031) | capacity / occupied / remaining / waiting per trip |

Every view is `security_invoker`, so RLS still scopes it to the caller's tenant.
