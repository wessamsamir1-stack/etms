# ETMS — Entity-Relationship Diagrams

Complete ER model for the schema in [`migrations/`](./migrations). Diagrams are split by
bounded context for readability, followed by the cross-context map. Every tenant-owned
table carries `tenant_id` and is protected by Row-Level Security (see `V0011`).

Legend: `||--o{` one-to-many · `||--||` one-to-one · `}o--o{` many-to-many (via join).

## 1. Tenant & Billing
```mermaid
erDiagram
  TENANT ||--|| TENANT_BRANDING : "brands"
  TENANT ||--o{ TENANT_SETTING : "configures"
  TENANT ||--o{ SUBSCRIPTION : "subscribes"
  TENANT ||--o{ USAGE_RECORD : "meters"
  TENANT {
    uuid id PK
    text name
    citext slug UK
    citext custom_domain UK
    text status
    text region
    char default_currency
    timestamptz deleted_at
  }
  SUBSCRIPTION {
    uuid id PK
    uuid tenant_id FK
    text plan_code
    int seats_limit
    text status
  }
```

## 2. Identity, Access & Audit (RBAC + ABAC)
```mermaid
erDiagram
  TENANT ||--o{ APP_USER : "has"
  APP_USER ||--o{ USER_ROLE : "assigned"
  ROLE ||--o{ USER_ROLE : "granted via"
  ROLE ||--o{ ROLE_PERMISSION : "includes"
  PERMISSION ||--o{ ROLE_PERMISSION : "in"
  APP_USER ||--o{ USER_SESSION : "opens"
  APP_USER ||--o{ USER_MFA_FACTOR : "secures"
  APP_USER ||--o{ USER_IDENTITY : "federates"
  APP_USER ||--o{ AUDIT_ENTRY : "acts (logical)"
  APP_USER {
    uuid id PK
    uuid tenant_id FK
    citext email
    text status
    bool mfa_enabled
    timestamptz deleted_at
  }
  ROLE {
    uuid id PK
    uuid tenant_id FK "NULL = system template"
    text code
    bool is_system
  }
  USER_ROLE {
    uuid user_id PK,FK
    uuid role_id PK,FK
    uuid_arr scope_site_ids "ABAC"
    uuid_arr scope_cost_center_ids "ABAC"
  }
  AUDIT_ENTRY {
    bigint id PK
    uuid tenant_id
    text action
    jsonb before_json
    jsonb after_json
  }
```

## 3. Master Data
```mermaid
erDiagram
  TENANT ||--o{ SITE : "has"
  SITE ||--o{ ZONE : "contains"
  SITE ||--o{ SHIFT : "defines"
  TENANT ||--o{ COST_CENTER : "has"
  COST_CENTER ||--o{ COST_CENTER : "parent of"
  TENANT ||--o{ EMPLOYEE : "employs"
  APP_USER ||--o| EMPLOYEE : "logs in as"
  COST_CENTER ||--o{ EMPLOYEE : "bills"
  SITE ||--o{ EMPLOYEE : "default site"
  SHIFT ||--o{ EMPLOYEE : "default shift"
  ZONE ||--o{ EMPLOYEE : "home zone"
  SITE {
    uuid id PK
    uuid tenant_id FK
    geography location
    geography geofence
    timestamptz deleted_at
  }
  EMPLOYEE {
    uuid id PK
    uuid tenant_id FK
    uuid user_id FK
    text external_hr_id
    geography home_location "encrypted PII"
    bool eligible
    timestamptz deleted_at
  }
```

## 4. Fleet
```mermaid
erDiagram
  TENANT ||--o{ VENDOR : "contracts"
  VENDOR ||--o{ VEHICLE : "supplies"
  VENDOR ||--o{ DRIVER : "employs"
  VENDOR ||--o{ RATE_CARD : "offers"
  VEHICLE ||--o{ VEHICLE_DOCUMENT : "has"
  DRIVER ||--o{ DRIVER_DOCUMENT : "has"
  APP_USER ||--o| DRIVER : "logs in as"
  VEHICLE {
    uuid id PK
    uuid tenant_id FK
    uuid vendor_id FK
    text plate_no
    int capacity
    text status
    date insurance_expiry
  }
  DRIVER {
    uuid id PK
    uuid tenant_id FK
    text verification_status
    text availability
    date license_expiry
  }
  RATE_CARD {
    uuid id PK
    text model "per_km|per_trip|per_seat|fixed_monthly"
    numeric rate
    date effective_from
  }
```

## 5. Planning
```mermaid
erDiagram
  SITE ||--o{ ROUTE : "serves"
  SHIFT ||--o{ ROUTE : "for"
  ROUTE ||--o{ ROUTE_STOP : "ordered stops"
  ZONE ||--o{ ROUTE_STOP : "at"
  ROUTE ||--o{ SCHEDULE : "recurs by"
  TENANT ||--o{ HOLIDAY : "observes"
  ROUTE {
    uuid id PK
    uuid site_id FK
    uuid shift_id FK
    text direction
    text status
  }
  ROUTE_STOP {
    uuid id PK
    uuid route_id FK
    int seq UK
    int planned_offset_min
  }
  SCHEDULE {
    uuid id PK
    uuid route_id FK
    text rrule
    bool active
  }
```

## 6. Booking, Dispatch & Trips
```mermaid
erDiagram
  ROUTE ||--o{ TRIP : "generates"
  SCHEDULE ||--o{ TRIP : "instantiates"
  TRIP ||--|| ASSIGNMENT : "dispatched as"
  VEHICLE ||--o{ ASSIGNMENT : "used in"
  DRIVER ||--o{ ASSIGNMENT : "drives"
  EMPLOYEE ||--o{ BOOKING : "makes"
  SHIFT ||--o{ BOOKING : "for"
  BOOKING ||--o| SEAT_ALLOCATION : "results in"
  TRIP ||--o{ SEAT_ALLOCATION : "holds seats"
  EMPLOYEE ||--o{ SEAT_ALLOCATION : "occupies"
  ROUTE_STOP ||--o{ SEAT_ALLOCATION : "at"
  TRIP ||--o{ TRIP_EVENT : "logs"
  TRIP {
    uuid id PK
    uuid route_id FK
    date service_date
    text direction
    text status
    int capacity
    int seats_taken
  }
  ASSIGNMENT {
    uuid id PK
    uuid trip_id FK,UK
    uuid vehicle_id FK
    uuid driver_id FK
  }
  BOOKING {
    uuid id PK
    uuid employee_id FK
    date service_date
    text status
  }
  SEAT_ALLOCATION {
    uuid id PK
    uuid trip_id FK
    uuid employee_id FK
    text status
    text proof_type
  }
  TRIP_EVENT {
    bigint id PK
    uuid trip_id FK
    text event_type
    text client_event_id "idempotency"
  }
```

## 7. Tracking & Incidents
```mermaid
erDiagram
  TRIP ||--o{ VEHICLE_PING : "tracked by (partitioned)"
  VEHICLE ||--|| VEHICLE_LAST_POSITION : "last known"
  TRIP ||--o{ INCIDENT : "may raise"
  TRIP ||--o{ GEOFENCE_EVENT : "triggers"
  VEHICLE_PING {
    bigint id PK
    uuid trip_id
    geography location
    timestamptz recorded_at PK "partition key"
  }
  INCIDENT {
    uuid id PK
    uuid trip_id FK
    text type "sos|off_route|delay|..."
    text severity
    text status
  }
```

## 8. Costing & Finance
```mermaid
erDiagram
  TRIP ||--o| TRIP_COST : "costed as"
  RATE_CARD ||--o{ TRIP_COST : "priced by"
  COST_CENTER ||--o{ TRIP_COST : "allocated to"
  TRIP_COST ||--o{ TRIP_COST_ALLOCATION : "split into"
  VENDOR ||--o{ VENDOR_INVOICE : "issues"
  VENDOR_INVOICE ||--o{ INVOICE_LINE : "contains"
  TRIP_COST ||--o| INVOICE_LINE : "reconciled with"
  TENANT ||--o{ ERP_EXPORT : "posts"
  TRIP_COST {
    uuid id PK
    uuid trip_id FK,UK
    numeric amount
    uuid cost_center_id FK
    jsonb breakdown
  }
  INVOICE_LINE {
    uuid id PK
    uuid invoice_id FK
    uuid trip_cost_id FK
    text recon_status "matched|variance|unmatched"
    numeric variance
  }
```

## 9. Notifications & Webhooks
```mermaid
erDiagram
  TENANT ||--o{ NOTIFICATION_TEMPLATE : "defines"
  APP_USER ||--o{ NOTIFICATION : "receives"
  APP_USER ||--o{ DEVICE_TOKEN : "registers"
  TENANT ||--o{ WEBHOOK_SUBSCRIPTION : "subscribes"
  WEBHOOK_SUBSCRIPTION ||--o{ WEBHOOK_DELIVERY : "delivers"
  NOTIFICATION_TEMPLATE {
    uuid id PK
    text code
    text channel "push|sms|email|whatsapp"
    text locale
  }
  NOTIFICATION {
    uuid id PK
    uuid user_id FK
    text channel
    text status
  }
```

## 10. Cross-Context Map (condensed)
```mermaid
erDiagram
  TENANT ||--o{ APP_USER : ""
  TENANT ||--o{ SITE : ""
  TENANT ||--o{ EMPLOYEE : ""
  TENANT ||--o{ VENDOR : ""
  SITE ||--o{ ROUTE : ""
  ROUTE ||--o{ TRIP : ""
  VENDOR ||--o{ VEHICLE : ""
  VENDOR ||--o{ DRIVER : ""
  TRIP ||--|| ASSIGNMENT : ""
  VEHICLE ||--o{ ASSIGNMENT : ""
  DRIVER ||--o{ ASSIGNMENT : ""
  EMPLOYEE ||--o{ BOOKING : ""
  TRIP ||--o{ SEAT_ALLOCATION : ""
  BOOKING ||--o| SEAT_ALLOCATION : ""
  TRIP ||--o| TRIP_COST : ""
  TRIP ||--o{ VEHICLE_PING : ""
  TRIP ||--o{ INCIDENT : ""
  VENDOR ||--o{ VENDOR_INVOICE : ""
  TRIP_COST ||--o| INVOICE_LINE : ""
  APP_USER ||--o{ AUDIT_ENTRY : ""
```

## Design notes
- **Tenant isolation:** every tenant-owned table has `tenant_id` + an RLS `tenant_isolation`
  policy bound to the session's `app.tenant_id`. Verified end-to-end (see `db/README.md`).
- **Soft delete:** master/reference tables carry `deleted_at`; uniqueness is enforced by
  partial indexes `WHERE deleted_at IS NULL`, so a code can be reused after deletion.
- **Audit:** `audit_row()` trigger writes immutable before/after snapshots to `audit_entry`
  on every INSERT/UPDATE/DELETE of business tables; UPDATE/DELETE on the log are revoked.
- **Append-only logs:** `trip_event`, `geofence_event`, `vehicle_ping` are insert-only.
- **Idempotency:** `trip_event.client_event_id` (offline replay) and
  `erp_export.idempotency_key` prevent duplicate side effects.
- **Hierarchy:** `cost_center.parent_id` supports org rollups; `route_stop.seq` is ordered.
