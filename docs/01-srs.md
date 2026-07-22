# 01 — Software Requirements Specification (SRS)

Conforms in spirit to IEEE 830 / ISO/IEC/IEEE 29148. Requirements are uniquely
identified: **FR-x** (functional), **NFR-x** (non-functional). Priority: `M` MUST,
`S` SHOULD, `C` COULD (MoSCoW). Each requirement is testable.

## 1. Introduction

### 1.1 Purpose
Define the complete requirements for the ETMS platform: what it must do (functional)
and how well it must do it (non-functional), for all personas and interfaces.

### 1.2 Scope
See [00-overview](./00-overview.md) §5. This SRS covers the multi-tenant SaaS
backend, the rider app, the driver app, the operations/admin web console, and the
platform super-admin console.

### 1.3 Actors
Super Admin, Company Admin, Operations Manager, Dispatcher, Finance, HR/Admin,
Driver, Rider (Employee), Vendor Manager, System (scheduled jobs & webhooks).

## 2. Functional Requirements

### 2.1 Tenant & Platform Management
| ID | Priority | Requirement |
|----|----------|-------------|
| FR-1 | M | Super Admin can create, suspend, and delete tenants with isolated data. |
| FR-2 | M | Each tenant configures white-label branding (name, logo, colors, custom domain). |
| FR-3 | M | Platform supports subscription plans (seats/vehicles/sites tiers) with metered usage. |
| FR-4 | S | Super Admin can view aggregate platform health & per-tenant usage without accessing tenant PII. |
| FR-5 | M | Tenant data is logically isolated; no cross-tenant read/write is possible. |

### 2.2 Identity, Access & Security
| ID | Priority | Requirement |
|----|----------|-------------|
| FR-6 | M | Users authenticate via email/password, OTP, and SSO (OAuth2/OIDC, SAML). |
| FR-7 | M | RBAC with predefined roles; Company Admin can create custom roles (see [04](./04-roles-rbac.md)). |
| FR-8 | M | ABAC scoping: users see only data for sites/zones/cost-centers they are assigned to. |
| FR-9 | M | All state-changing actions are recorded in an immutable audit log. |
| FR-10 | M | MFA can be enforced per tenant policy. |
| FR-11 | S | Session/token revocation and device management per user. |

### 2.3 Master Data Management
| ID | Priority | Requirement |
|----|----------|-------------|
| FR-12 | M | CRUD for Sites, Zones (with geofences), Shifts, Cost Centers. |
| FR-13 | M | CRUD for Employees with eligibility, home location, default site/shift. |
| FR-14 | M | Bulk import (CSV/Excel) and HRIS sync for employees. |
| FR-15 | M | CRUD for Vehicles (capacity, type, plate, documents, inspection expiry). |
| FR-16 | M | CRUD for Drivers with license, verification status, documents, availability. |
| FR-17 | M | CRUD for Vendors and their contracts/rate cards. |
| FR-18 | S | Document expiry tracking with proactive alerts (license, insurance, inspection). |

### 2.4 Route & Shift Planning
| ID | Priority | Requirement |
|----|----------|-------------|
| FR-19 | M | Create fixed routes (ordered stops, direction) bound to a site & shift. |
| FR-20 | M | Generate trips from routes on a schedule (calendar, working days, holidays). |
| FR-21 | S | Suggested route optimization by zone clustering & capacity (pluggable engine). |
| FR-22 | M | Capacity planning: system prevents overbooking a trip beyond vehicle capacity. |
| FR-23 | S | Demand forecasting per shift from historical bookings. |

### 2.5 Booking & Seat Allocation
| ID | Priority | Requirement |
|----|----------|-------------|
| FR-24 | M | Rider requests/confirms a seat for a shift within a booking window. |
| FR-25 | M | System allocates seat by zone/route/capacity and confirms or waitlists. |
| FR-26 | M | Rider can cancel; freed seats auto-offered to waitlist. |
| FR-27 | S | Recurring bookings (e.g., "every working day, morning shift"). |
| FR-28 | M | Eligibility & policy enforcement (distance caps, shift eligibility). |

### 2.6 Dispatch & Trip Lifecycle
| ID | Priority | Requirement |
|----|----------|-------------|
| FR-29 | M | Dispatcher assigns a vehicle + driver to each planned trip. |
| FR-30 | M | Trip lifecycle states: `SCHEDULED → ASSIGNED → STARTED → IN_PROGRESS → COMPLETED`, plus `CANCELLED` / `EXCEPTION`. |
| FR-31 | M | Driver accepts/starts trip; system records timestamps & geostamps per event. |
| FR-32 | M | Driver marks each stop pickup/drop-off; captures proof (rider check-in/QR/photo). |
| FR-33 | M | No-show handling: driver flags no-show after configurable wait; logged. |
| FR-34 | S | Live re-assignment/swap of vehicle or driver mid-plan with rider notification. |

### 2.7 Live Tracking & Control Tower
| ID | Priority | Requirement |
|----|----------|-------------|
| FR-35 | M | Driver app streams GPS; ops console shows live vehicle positions on a map. |
| FR-36 | M | Riders see live ETA and vehicle position for their trip. |
| FR-37 | M | Exception detection: delays, off-route, missed stop, SOS → surfaced in control tower. |
| FR-38 | M | SOS/panic from rider or driver raises a high-priority incident with location. |
| FR-39 | S | Geofence events (entered site, entered zone) generate automated status updates. |

### 2.8 Costing, Billing & Reconciliation
| ID | Priority | Requirement |
|----|----------|-------------|
| FR-40 | M | Each trip computes cost from vendor rate card (per-km / per-trip / per-seat / fixed). |
| FR-41 | M | Cost allocated to cost-centers by rider/site/department. |
| FR-42 | M | Import vendor invoices; system reconciles against recorded trips and flags variance. |
| FR-43 | M | Export cost & reconciliation data to ERP/SAP (posting) and CSV/Excel. |
| FR-44 | S | Budget vs. actual per cost-center with alerts on overrun. |

### 2.9 Notifications & Communication
| ID | Priority | Requirement |
|----|----------|-------------|
| FR-45 | M | Multi-channel notifications: push, SMS, email, WhatsApp (per tenant config). |
| FR-46 | M | Event-driven: booking confirmed, trip assigned, driver arriving, cancellation, SOS. |
| FR-47 | S | Configurable templates per tenant, per language, per channel. |

### 2.10 Reporting & Analytics
| ID | Priority | Requirement |
|----|----------|-------------|
| FR-48 | M | Operational dashboards: on-time %, utilization, no-shows, exceptions. |
| FR-49 | M | Financial reports: cost per trip/site/cost-center, vendor spend, variance. |
| FR-50 | S | Safety/compliance reports: trips tracked, verified drivers, incident log. |
| FR-51 | S | Scheduled report delivery and custom report builder. |

### 2.11 Offline Capability
| ID | Priority | Requirement |
|----|----------|-------------|
| FR-52 | M | Driver app fully operable offline: view trip, mark stops, capture proof; queue syncs on reconnect. |
| FR-53 | M | Rider app shows last-known trip/seat state offline. |
| FR-54 | M | Sync is conflict-safe (last-writer-wins per field with server authority + audit). |

## 3. Non-Functional Requirements
(Full detail in [09-nfr-compliance](./09-nfr-compliance.md).)

| ID | Category | Priority | Requirement / Target |
|----|----------|----------|----------------------|
| NFR-1 | Performance | M | API p95 < 300 ms; map/live updates < 2 s end-to-end. |
| NFR-2 | Scalability | M | Horizontally scalable to thousands of tenants, millions of trips/month. |
| NFR-3 | Availability | M | 99.9% monthly uptime; graceful degradation when a dependency is down. |
| NFR-4 | Security | M | OWASP ASVS L2; encryption in transit (TLS 1.2+) & at rest (AES-256). |
| NFR-5 | Privacy | M | GDPR-aligned; data export & erasure; PII minimization; region residency. |
| NFR-6 | Reliability | M | RPO ≤ 15 min, RTO ≤ 1 h; automated backups & tested restore. |
| NFR-7 | Maintainability | M | Clean Architecture, SOLID, >80% domain test coverage, CI gates. |
| NFR-8 | Usability | M | Material 3, WCAG 2.1 AA, full RTL/LTR, offline-first UX. |
| NFR-9 | Observability | M | Structured logs, metrics, distributed tracing, alerting. |
| NFR-10 | Portability | S | Cloud-agnostic (containerized); infra as code. |
| NFR-11 | Localization | M | i18n/l10n; Arabic + English at launch; extensible catalog. |
| NFR-12 | Auditability | M | Immutable, queryable audit trail retained per policy (default 7 years for finance). |

## 4. Constraints & Dependencies
- Mapping/geocoding via external provider (abstracted behind a port).
- SMS/WhatsApp via provider gateways (abstracted); email via SMTP/API provider.
- SSO/HRIS/ERP integrations depend on tenant-side configuration & credentials.

## 5. Acceptance Criteria (design phase)
This SRS is accepted when every FR/NFR is: (a) traceable to a persona/workflow,
(b) reflected in the data model and API spec, and (c) sized in the roadmap.
A traceability matrix is maintained in [08-roadmap](./08-roadmap.md) §Traceability.
