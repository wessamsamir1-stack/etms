# 14 — Self-Registration, Onboarding & Driver Route Plans

> **Business rule (Wessam):** a driver or staff member is recognized by their
> **employee number**. HR uploads the employee file (roster); when the person
> registers and types their number, the system matches them, asks for a **selfie**
> and a **code sent to their phone or email**, and a reviewer **approves**. There
> are **two onboarding paths** — the admin can still create accounts directly, and
> now the person can self-register. Drivers can also set their **daily route**
> (zones + time window), and the company's **branches and shops** are registered
> with their codes.

---

## Two onboarding paths

| Path | Who starts it | How |
|------|---------------|-----|
| **Admin-provisioned** | Admin / HR | Create the `app_user` + driver/employee record, assign a role (as before). |
| **Self-registration** | The person | Employee number → matched to the HR roster → selfie + OTP → reviewer approves → account created. |

Both end in the same place: an `active` account linked to a driver/employee record with the right role.

---

## The HR roster (identity source)

HR uploads the roster — the file the system matches employee numbers against.

- `POST /v1/roster` (perm `roster.manage`) — one row **or** `{ "rows": [...] }` bulk (up to 5000).
- `GET /v1/roster` — list, with a `registered` flag once an entry is claimed.
- Each row: `employee_no`, `full_name`, `kind` (`driver` / `staff` / `rider`), `phone` and/or `email`, optional `department`, optional `photo_ref` (reference photo for later AI face-match).

---

## Self-registration flow (public, pre-auth)

The public endpoints resolve the tenant from its slug via a `SECURITY DEFINER`
function (`reg_tenant_id`, db/V0019), then run RLS-scoped.

```
POST /v1/register/lookup      {tenantSlug, employeeNo}
    → recognizes the number from the roster; returns masked contact options
      e.g. { found:true, fullName, kind, channels:[{channel:'sms', masked:'*****0001'}] }

POST /v1/register/start       {tenantSlug, employeeNo, channel, photoRef, password}
    → matches roster, generates a 6-digit OTP, HMAC-stores it, sends it to the
      chosen phone/email, creates a pending_otp request. (Selfie = photoRef; the
      person also sets their own password here.)

POST /v1/register/verify-otp  {tenantSlug, requestId, code}
    → verifies the code (5-min TTL, ≤5 attempts, constant-time compare); runs the
      face-match port; moves the request to pending_review.
```

Then a reviewer (perm `registration.review`):

```
GET  /v1/registrations?status=pending_review        → the review queue (incl. face_match_score)
POST /v1/registrations/:id/approve   (MFA step-up)  → provisions the account
POST /v1/registrations/:id/reject    {reason}
```

**On approve** the system: creates the `active` `app_user` with the password the
person chose; links the entity (`driver` row for a driver — starting
`verification_status='pending'` since license verification is separate; `employee`
row for a rider); and **assigns the matching system role** (`driver` / `rider`).
The roster entry is marked claimed. Verified end-to-end: the new user logs in with
their own password and carries exactly their role's permissions.

### Face verification

Approval is **human review** of the selfie today. A `FaceMatchPort` is wired
(`ManualReviewFaceMatch` → always "manual"); dropping in a real face-match service
later requires no route changes — its score simply appears on the review queue.

### OTP delivery

The OTP goes through an `OtpDeliveryPort`. The shipped `StubOtpDelivery` records
the code instead of sending; in non-production the code is also returned as
`devCode` so the flow is testable. Wiring a real SMS/email gateway is one adapter.

---

## Roles & the account→role link

Approval assigns the role automatically. For everything else there is now an
explicit endpoint (this closes a prior gap):

- `POST /v1/users/:id/roles` `{roleId}` or `{roleCode}` — assign (perm `user.manage` + MFA).
- `DELETE /v1/users/:id/roles/:roleId` — revoke.

Accepts a tenant role or a system template (`driver`, `rider`, `dispatcher`, …).

### Permissions each role gets (recap + new)

New permissions added in V0019: `roster.manage`, `registration.review`,
`location.read`, `location.manage`, `route_plan.read`, `route_plan.propose`,
`route_plan.approve` — granted to the system templates (and `company_admin`, so a
re-seed clones them into each tenant's admin role).

| Role | Gets (relevant to onboarding) |
|------|-------------------------------|
| `driver` | `route_plan.propose`, `route_plan.read`, `location.read` (+ trip.operate, tracking.read, sos.raise …) |
| `dispatcher` | `route_plan.approve`, `route_plan.read`, `location.read` |
| `ops_manager` | `registration.review`, `location.manage`, `route_plan.approve` |
| `hr_admin` | `roster.manage`, `registration.review`, `location.manage` |
| `company_admin` | all of the above |

---

## Driver daily route plans (zones + time window)

A driver proposes, per day, the zones (areas) they'll cover and their time window;
a dispatcher/ops approves.

- `POST /v1/driver-plans` (perm `route_plan.propose`) — `{service_date, window_start, window_end, zone_ids[], note?}`. Proposes for the driver linked to the caller's account; re-proposing replaces an open plan (an approved one is locked).
- `GET /v1/driver-plans?date=&status=` (perm `route_plan.read`) — plans with their zone names.
- `POST /v1/driver-plans/:id/approve` · `POST /v1/driver-plans/:id/reject` (perm `route_plan.approve`).

---

## Company locations — branches & shops (with codes)

Residences already live in `residence` (V0016, weighted routing). Branches (أفرع)
and shops (محلات) are registered with their codes in `company_location`:

- `GET/POST/PATCH/DELETE /v1/company-locations` (perms `location.read` / `location.manage`).
- Fields: `kind` (`branch` / `shop`), `code` (unique per kind), `name`, `address`, `status`. Code uniqueness enforced per kind.

---

## Verification (live, against PostgreSQL 16 + PostGIS)

All flows exercised end-to-end and passing (backend suite **86/86**, incl. new OTP unit tests):

- Roster upload → `lookup` recognizes `D-100` (masked `*****0001`) → `start` (OTP delivered, `devCode`) → wrong code rejected (401) → correct code → `pending_review` (face match `manual`).
- Review queue shows it → approve **without MFA blocked (403)** → with MFA → **account created, role `driver`**.
- Rider path likewise → the rider **logs in with their own password** and carries `booking.create`.
- Company `branch` + `shop` created with codes and listed.
- Driver **proposed** a plan (zone `Zone North`, 06:00–14:00) → dispatcher **approved**.

### Honest gaps / next

- Public endpoints should get a per-IP rate limit (the login limiter pattern) before production.
- Selfie/`photo_ref` is a storage reference — object-storage upload + the real face-match adapter are the remaining integrations.
- Real SMS/email gateway for OTP delivery.
