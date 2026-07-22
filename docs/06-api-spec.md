# 06 — API Specification

REST over HTTPS, JSON, **OpenAPI 3.1** as the machine-readable source of truth (the
typed Flutter client and server stubs are generated from it). This document is the
human-readable contract summary.

## 1. Conventions
- **Base URL:** `https://api.{region}.etms.app/v1` (also reachable via tenant custom domain).
- **Versioning:** URI major version (`/v1`); additive changes are non-breaking; breaking
  changes ship as `/v2` with an overlap/deprecation window.
- **Auth:** `Authorization: Bearer <JWT access token>`. JWT carries `sub`, `tenant_id`,
  `roles`, `scopes`. Tenant is derived from the token, **never** from a client-supplied body.
- **Tenant context:** additionally selectable via `X-Tenant-Slug` only for the platform
  super-admin; regular tokens are single-tenant.
- **Content type:** `application/json; charset=utf-8`. **Locale:** `Accept-Language: ar|en`.
- **Idempotency:** mutating POSTs accept `Idempotency-Key`; offline events carry
  `client_event_id`.
- **Pagination:** cursor-based — `?limit=50&cursor=<opaque>`; response includes
  `page.next_cursor`.
- **Filtering/sorting:** `?filter[status]=scheduled&sort=-service_date`.
- **Rate limiting:** per token & per tenant; `429` with `Retry-After`.
- **Times:** ISO-8601 UTC (`2026-07-13T05:30:00Z`); dates are `YYYY-MM-DD`.

## 2. Standard Response Envelope
```jsonc
// Success (collection)
{
  "data": [ /* resources */ ],
  "page": { "next_cursor": "eyJpZCI6...", "count": 50 },
  "meta": { "request_id": "req_01H..." }
}
// Success (single)
{ "data": { /* resource */ }, "meta": { "request_id": "req_01H..." } }
```

## 3. Error Model (RFC 9457 problem+json)
```jsonc
{
  "type": "https://errors.etms.app/validation",
  "title": "Validation failed",
  "status": 422,
  "code": "VALIDATION_ERROR",
  "detail": "capacity must be >= seats_taken",
  "errors": [ { "field": "vehicle_id", "message": "capacity too small" } ],
  "request_id": "req_01H..."
}
```
| HTTP | Code | Meaning |
|------|------|---------|
| 400 | `BAD_REQUEST` | Malformed request |
| 401 | `UNAUTHENTICATED` | Missing/invalid token |
| 403 | `FORBIDDEN` | Lacks permission or out of ABAC scope |
| 404 | `NOT_FOUND` | Resource not in this tenant |
| 409 | `CONFLICT` | State conflict (e.g., seat gone, double dispatch) |
| 422 | `VALIDATION_ERROR` | Semantic validation failed |
| 429 | `RATE_LIMITED` | Too many requests |
| 5xx | `INTERNAL` | Server error (request_id for support) |

## 4. Authentication Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/login` | email/password or phone → tokens |
| POST | `/auth/otp/request` · `/auth/otp/verify` | passwordless OTP |
| GET  | `/auth/sso/{provider}/authorize` · `/callback` | OIDC/SAML SSO |
| POST | `/auth/refresh` | rotate access token via refresh token |
| POST | `/auth/logout` | revoke session |
| POST | `/auth/mfa/enroll` · `/auth/mfa/verify` | MFA step-up |

```jsonc
// POST /auth/login  →  200
{ "access_token":"...", "refresh_token":"...", "expires_in":900,
  "user": { "id":"...", "roles":["dispatcher"], "tenant_id":"..." } }
```

## 5. Resource Endpoints (representative)
CRUD resources follow REST: `GET /x` (list), `POST /x` (create), `GET /x/{id}`,
`PATCH /x/{id}`, `DELETE /x/{id}` (soft where applicable). Required permission shown.

### Master data
| Method | Path | Permission |
|--------|------|------------|
| CRUD | `/sites`, `/sites/{id}/zones`, `/shifts`, `/cost-centers` | `site.*` etc. |
| CRUD | `/employees` | `employee.*` |
| POST | `/employees:import` (CSV, dry-run→commit) | `employee.import` |

### Fleet
| Method | Path | Permission |
|--------|------|------------|
| CRUD | `/vendors`, `/vehicles`, `/drivers` | `vehicle.*`, `driver.*` |
| POST | `/drivers/{id}:verify` | `driver.verify` |
| CRUD | `/rate-cards` | `ratecard.*` |
| GET  | `/documents:expiring?within=30d` | `document.*` |

### Planning
| Method | Path | Permission |
|--------|------|------------|
| CRUD | `/routes`, `/routes/{id}/stops`, `/schedules` | `route.*`, `schedule.*` |
| POST | `/routes/{id}:optimize` | `route.manage` |
| POST | `/trips:generate` (date range) | `schedule.manage` |

### Booking (rider)
| Method | Path | Permission |
|--------|------|------------|
| POST | `/bookings` | `booking.create` |
| GET | `/bookings?filter[date]=…` | `booking.read` |
| POST | `/bookings/{id}:cancel` | `booking.cancel`/self |
| POST | `/bookings:recurring` | `booking.create` |

```jsonc
// POST /bookings  →  201 (confirmed) or 202 (waitlisted)
// request:
{ "service_date":"2026-07-14", "shift_id":"...", "direction":"inbound" }
// response 201:
{ "data": { "id":"bk_...", "status":"confirmed",
  "trip_id":"tr_...", "stop": { "name":"Zone A - Gate 3", "pickup_time":"05:40" } } }
```

### Dispatch & Trips
| Method | Path | Permission |
|--------|------|------------|
| GET | `/trips?filter[date]&filter[status]` | `trip.read` |
| POST | `/trips/{id}:assign` `{vehicle_id, driver_id}` | `trip.dispatch` |
| POST | `/trips/{id}:reassign` | `trip.reassign` |
| POST | `/trips/{id}:cancel` | `trip.cancel` |
| GET | `/trips/{id}/seat-allocations` | `trip.read` |

### Field operations (driver, offline sync)
| Method | Path | Permission |
|--------|------|------------|
| GET | `/driver/trips?date=today` | `trip.operate`/self |
| POST | `/trips/{id}:start` | `trip.operate` |
| POST | `/trips/{id}/events` (batch, idempotent) | `trip.operate` |
| POST | `/trips/{id}:complete` | `trip.operate` |
| POST | `/sync/outbox` (bulk offline replay) | `trip.operate` |

```jsonc
// POST /trips/{id}/events  (offline-safe batch)
{ "events": [
  { "client_event_id":"c1","type":"arrived_stop","route_stop_id":"...","at":"...","lat":29.3,"lng":47.9 },
  { "client_event_id":"c2","type":"pickup","employee_id":"...","proof":"qr","at":"..." }
] }
// 200 → per-event {client_event_id, status: applied|duplicate|rejected}
```

### Tracking & Incidents (realtime)
| Transport | Endpoint | Purpose |
|-----------|----------|---------|
| WS/SSE | `/realtime/trips/{id}` | live position + ETA + status |
| WS | `/realtime/fleet?site_id=…` | control-tower fleet stream |
| POST | `/tracking/pings` (batch) | driver GPS ingest |
| POST | `/incidents` (`type=sos`) | raise incident |
| POST | `/incidents/{id}:resolve` | `incident.resolve` |

### Costing & Finance
| Method | Path | Permission |
|--------|------|------------|
| GET | `/trip-costs?filter[period]` | `cost.read` |
| POST | `/invoices:import` | `invoice.read` |
| POST | `/invoices/{id}:reconcile` | `invoice.reconcile` |
| GET | `/invoices/{id}/variances` | `invoice.read` |
| POST | `/exports/erp` `{period, format}` | `erp.export` |

### Notifications, Reports, Audit, Admin
| Method | Path | Permission |
|--------|------|------------|
| CRUD | `/notification-templates` | `notification.template.manage` |
| GET | `/reports/{operational\|financial\|safety}` | `report.*` |
| GET | `/audit?filter[entity]&filter[actor]` | `audit.read` |
| CRUD | `/admin/tenants` (super-admin) | platform |
| GET/PATCH | `/tenant/branding`, `/tenant/settings` | `branding.manage` |
| CRUD | `/roles`, `/users`, `/users/{id}/roles` | `role.*`, `user.*` |

## 6. Webhooks (outbound to tenant systems)
Signed (`X-ETMS-Signature: hmac-sha256`), retried with backoff, replayable.
| Event | Payload |
|-------|---------|
| `trip.completed` | trip + cost summary |
| `incident.raised` | incident + location |
| `booking.confirmed` / `.cancelled` | booking |
| `invoice.reconciled` | reconciliation result |
| `document.expiring` | vehicle/driver doc |

Subscription managed via `POST /webhooks` `{url, events[], secret}`.

## 7. Realtime Contract (tracking)
```jsonc
// server → client on /realtime/trips/{id}
{ "type":"position","trip_id":"tr_...","lat":29.31,"lng":47.93,"heading":210,
  "eta_to_next_stop_sec":420,"status":"in_progress","at":"2026-07-13T05:41:12Z" }
{ "type":"status","trip_id":"tr_...","status":"completed","at":"..." }
{ "type":"incident","trip_id":"tr_...","incident":{"type":"delay","severity":"medium"} }
```

## 8. Non-Functional API Rules
- All list endpoints paginated & scoped by tenant + ABAC automatically.
- Every response carries `request_id` for tracing/support.
- Writes are validated server-side regardless of client validation.
- Backwards compatibility: never repurpose a field; add, don't mutate.
- OpenAPI spec + Postman collection published per version; contract tests in CI.
