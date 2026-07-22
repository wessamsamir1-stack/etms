# 13 — Transport Usage Report & Payroll Deduction

> **Business rule (Wessam):** the transport is **company-owned** — there is no
> vendor and no per-trip rate card in this flow. A ride is **not** charged to the
> employee at trip time. The company decides the deduction: a **fixed monthly
> amount per employee**, or — for seasonal / occasional riders — an amount HR
> sets themselves. **The system's job is to give them the report:** how many
> times the employee rode, and the details of each trip. The system reports;
> **HR decides the amount** — the system never computes money.

## What the system does vs what HR does

| | The system | HR / payroll |
|---|-----------|--------------|
| Records every ride taken (rides + distinct days) | ✅ | |
| Reports trip-by-trip details per employee | ✅ | |
| Decides the deduction basis (fixed monthly / seasonal) | | ✅ |
| Decides the **amount** to deduct | | ✅ |
| Applies the deduction in payroll | | ✅ |

The employee rides with no payment at the door. HR opens the report, sees the
count and the trips, and applies whatever deduction they decided — a flat
monthly figure for regular riders, or a figure they set for occasional ones.

---

## The ledger — `transport_usage`

One append-only row per **ride actually taken** (see `db/migrations/V0018`).

- Written **automatically** on QR boarding (`POST /v1/checkin/verify`, direction
  `in`) — `direction`, `service_date` and `trip_id` are copied from the trip.
- Written **manually** via `POST /v1/transport-usage` for boardings without a QR
  scan.
- **Idempotent:** unique on `(tenant_id, trip_id, employee_id, direction)`, so an
  offline check-in that replays never double-counts a ride.
- Carries no money — only the facts of the ride.

### "Rides" and "days"

The report counts **rides** and **distinct service days**. A round trip
(inbound + outbound) on the same date is **two rides but one day**, so a policy
that deducts "per day used" is not doubled by the return leg. Both numbers are
in the report; HR chooses which one their deduction is based on (or ignores both
and applies the flat monthly amount).

---

## The reports HR reads

| Endpoint | What it gives | Permission |
|----------|---------------|------------|
| `GET /v1/transport-usage?from&to[&employee_id]` | **Summary** per employee: rides, distinct days, inbound/outbound, pending vs already-exported | `report.financial` |
| `GET /v1/transport-usage/details?from&to[&employee_id]` | **Trip-by-trip detail**: each ride with date, direction, route, site, boarding time, source | `report.financial` |

Both are `security_invoker`/RLS tenant-scoped — one company never sees another's
usage. These two answer the ask directly: *how many times each employee rode,
and the details of the trips.*

---

## Handing the report to payroll — `POST /v1/transport-usage/export`

Bundles a period's usage into an **idempotent** batch for payroll / HR / accounting
and marks the rides `exported`. Sensitive → **MFA step-up** (`erp.export` + `requireMfa`).

- Carries **counts + trip facts only** — rides and distinct days per employee.
  There is **no amount** in the batch; HR attaches the fixed-monthly or seasonal
  figure on their side.
- **Idempotent:** the key is a deterministic hash of period + per-employee counts;
  once rides are `exported` they are never picked up again → no double deduction.
- Formats: `csv` | `json` | `sap_idoc` (an `HRPAYUSAGE` envelope carrying the ride
  and day counts — a usage record for HR, not a priced invoice).

Target systems: `payroll`, `hr`, `accounting`, or `sap_successfactors`.

---

## End-to-end (verified against PostgreSQL 16 + PostGIS)

```
board (QR in) ─▶ transport_usage row (pending)      ← ride + trip details recorded, NOT charged
                 replay = same row (idempotent)
   … period …
summary       ─▶ GET /v1/transport-usage          → rides + distinct days per employee
details       ─▶ GET /v1/transport-usage/details  → every ride with its trip details
hand to HR    ─▶ POST /v1/transport-usage/export  → counts only (no amount), MFA-gated, idempotent
HR decides    ─▶ fixed monthly / seasonal amount → applied in payroll
```

A live run confirmed: an employee with an inbound + outbound trip on one day →
**rides = 2, days = 1**; the detail report listed both rides with their trip
info; the export carried counts (no money), was MFA-gated and idempotent; tenant
isolation held. Unit tests: `backend/src/domain/usage/transport_usage.test.ts`.
