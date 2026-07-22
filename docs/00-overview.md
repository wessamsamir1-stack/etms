# 00 — Product Overview & Vision

## 1. Executive Summary

ETMS (Employee Transportation Management System) is a production-grade, multi-tenant
SaaS platform that lets enterprises manage the daily movement of their workforce:
home-to-site shuttles, shift-based routing, ad-hoc trips, vehicle and driver
management, live GPS tracking, cost allocation, and compliance reporting.

The platform is **white-label** (each tenant brands the apps as their own),
**offline-first** (drivers and riders in low-connectivity zones keep working), and
**enterprise-integrable** (SSO, HRIS, ERP/SAP, payroll, and mapping providers).

## 2. Problem Statement

Large employers — manufacturing plants, business-process outsourcing (BPO) campuses,
hospitals, oil & gas sites, logistics hubs — move thousands of employees daily. Today
this is run on spreadsheets, WhatsApp groups, and disconnected vendor tools, causing:

- **Cost leakage** — no per-trip costing, empty seats, unverified vendor invoices.
- **Safety exposure** — no verified driver identity, no live tracking, no SOS.
- **Compliance gaps** — no audit trail for who travelled, when, and with whom.
- **Poor experience** — employees don't know where the shuttle is or if they have a seat.
- **No visibility** — operations managers can't see fleet status or SLA breaches live.

## 3. Vision

> One platform where an enterprise plans routes, assigns vehicles and drivers, tracks
> every trip live, guarantees every employee a safe verified seat, and produces an
> auditable, itemized cost record — across any number of sites, shifts, and countries.

## 4. Target Market & Personas

### Buying organizations
- Enterprises with 500+ commuting employees across one or more sites.
- Transportation vendors/operators who serve those enterprises (fleet operators).
- Facilities / admin / HR departments who own the commute benefit.

### Primary personas

| Persona | Role | Key needs |
|---------|------|-----------|
| **Nadia** | Transport Operations Manager | Plan routes, monitor live fleet, resolve exceptions, report SLAs |
| **Omar** | Dispatcher / Coordinator | Assign vehicles & drivers to trips, handle no-shows and swaps |
| **Sara** | Employee / Rider | Book/confirm a seat, see live ETA, check-in, raise SOS |
| **Khaled** | Driver | Receive trip, navigate route, mark pickups/drop-offs, capture proof |
| **Layla** | Finance / Controller | Verify vendor invoices, allocate cost to cost-centers, export to ERP |
| **Fahad** | HR / Admin | Manage employee eligibility, sites, shifts, and policy |
| **Reem** | Company Admin (tenant owner) | Configure branding, roles, integrations, billing |
| **Platform Ops** | Super Admin (us) | Onboard tenants, monitor health, manage plans & billing |

## 5. Product Scope

### In scope (v1–v3, see Roadmap)
- Master data: sites, zones, shifts, employees, vehicles, drivers, vendors.
- Route planning (fixed routes + shift-based) and seat allocation.
- Trip lifecycle: schedule → dispatch → in-progress → completed / exception.
- Rider app: booking, seat confirmation, live ETA, check-in, SOS, ratings.
- Driver app: assigned trips, turn-by-turn hand-off, pickup/drop-off proof, offline queue.
- Live tracking & operations control tower (map + exceptions).
- Costing, vendor invoice reconciliation, cost-center allocation, exports.
- RBAC/ABAC, audit logs, notifications (push/SMS/email/WhatsApp).
- Multi-tenant white-label, i18n (Arabic RTL + English LTR first).
- Reporting & analytics dashboards.

### Out of scope (explicitly, for now)
- Public/consumer ride-hailing (this is B2B/B2E only).
- Autonomous routing optimization ML (v3+ enhancement, pluggable).
- In-house mapping/tiles (we integrate a mapping provider).
- Full accounting/GL system (we export to the customer's ERP/SAP).

## 6. Key Differentiators
- **Offline-first** driver & rider flows with conflict-safe sync.
- **True multi-tenant white-label** — per-tenant theme, domain, and app identity.
- **Costing built-in** — every trip carries a defensible cost, reconciled to vendor invoices.
- **Enterprise integration** — SSO/OIDC, HRIS sync, ERP/SAP posting, webhooks.
- **Audit-grade** — immutable audit log for safety and finance compliance.

## 7. Success Metrics (North-Star & KPIs)

| Category | Metric | Target |
|----------|--------|--------|
| Adoption | % of eligible trips booked in-app | > 95% |
| Reliability | On-time pickup rate | > 97% |
| Safety | Trips with live tracking + verified driver | 100% |
| Finance | Invoice discrepancy caught before payment | > 99% |
| Experience | Rider CSAT | > 4.5 / 5 |
| Platform | Monthly active tenants / churn | Growth / < 2% |
| Technical | API p95 latency / uptime | < 300 ms / 99.9% |

## 8. Assumptions & Constraints
- Tenants provide their own mapping-provider key or use the platform default.
- Connectivity is intermittent at pickup zones → offline-first is mandatory, not optional.
- Data residency requirements vary by country → region-pinned deployments supported.
- First launch markets are RTL (Arabic) and LTR (English); i18n is first-class from day one.

## 9. Glossary
- **Tenant:** A customer company using the platform (isolated data + branding).
- **Site:** A physical facility (plant, office, hospital) employees commute to.
- **Zone:** A pickup/drop-off catchment area used for routing.
- **Shift:** A defined work period that drives demand (e.g., 06:00–14:00).
- **Route:** An ordered set of stops served by a vehicle for a shift/direction.
- **Trip:** A single scheduled execution of a route in a direction on a date.
- **Seat allocation:** Assignment of an employee to a seat on a specific trip.
- **Dispatch:** Assigning a concrete vehicle + driver to a planned trip.
- **Vendor:** A third-party fleet operator supplying vehicles/drivers.
