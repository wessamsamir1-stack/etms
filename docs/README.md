# ETMS — Enterprise Employee Transportation Management System

> Multi-tenant, white-label, offline-first SaaS platform for planning, dispatching,
> tracking, and billing employee transportation at enterprise scale.

This directory contains the complete engineering specification for ETMS. It is the
**single source of truth** for the design phase and must be read before any code is
written. Documents are ordered; read them in sequence.

## Document Index

| # | Document | Purpose |
|---|----------|---------|
| 00 | [Product Overview & Vision](./00-overview.md) | Problem statement, personas, scope, success metrics |
| 01 | [Software Requirements Specification (SRS)](./01-srs.md) | Functional & non-functional requirements |
| 02 | [System Architecture](./02-architecture.md) | Clean Architecture, tech stack, multi-tenancy, integrations |
| 03 | [Database Design & ERD](./03-database-design.md) | Schema, ERD, indexing, RLS, migrations strategy |
| 04 | [User Roles & RBAC](./04-roles-rbac.md) | Roles, permission matrix, access control model |
| 05 | [Business Workflows](./05-workflows.md) | End-to-end process flows with diagrams |
| 06 | [API Specification](./06-api-spec.md) | REST contract, auth, versioning, error model |
| 07 | [UI/UX Structure](./07-uiux.md) | Information architecture, screens, design system, offline UX |
| 07a | [Screen Specifications](./screens/README.md) | Every screen (64) — states, validation, rules, permissions, responsive |
| 08 | [Development Roadmap](./08-roadmap.md) | Phased delivery plan, milestones, estimates |
| 09 | [Non-Functional & Compliance](./09-nfr-compliance.md) | Security, privacy, SLAs, observability, DR |
| 11 | [AI-Assisted Approvals & Company Residences](./11-ai-approvals-and-residences.md) | Rules-first AI eligibility auto-approval + weighted-priority residence pickups |
| 12 | [Deployment Guide](./12-deployment.md) | Images, migrations, app-role/RLS, probes, rollout, DR, checklist |
| 13 | [Transport Usage & Deferred Payroll Deduction](./13-transport-usage-payroll.md) | Ride recorded (rides + days), never charged at trip time; MFA-gated idempotent deduction batch to Accounting/HR/payroll |
| 14 | [Self-Registration, Onboarding & Driver Route Plans](./14-self-registration-and-onboarding.md) | Employee-number self-registration (roster match + selfie + OTP + review), user↔role assignment, company branches/shops with codes, driver daily route plans |
| 15 | [Localization: Bilingual (AR/EN) & Kuwait](./15-localization-kuwait.md) | Arabic + English (RTL/LTR), and Kuwait regional defaults — KWD (3-decimal fils), Asia/Kuwait, +965, Fri–Sat weekend |
| 16 | [Ride Requests](./16-ride-requests.md) | Staff pickup (fixed/temporary/per-request) → request to one driver or broadcast to all → first driver to claim gets the rider added to their trip's manifest |
| 17 | [Daily-Commute Model](./17-daily-commute-model.md) | No seat reservation — passenger manifest with attendance statuses, stop arrival + admin waiting timer + auto No-Show, "I'm on the way", ratings, lost & found, white-label, operational metrics |
| 18 | [Organization Structure & Roles](./18-org-structure-and-roles.md) | Company → Brand → Branch → Employees hierarchy; Super/Company/Transport/HR/Branch admin + Driver + Employee roles with permission sets |
| 19 | [Super-Admin Platform API](./19-platform-super-admin.md) | Cross-tenant (BYPASSRLS) platform layer: operator login, company provisioning, subscription/plan management, per-tenant feature flags, platform audit — kept separate from the tenant-scoped API |

## At a Glance

- **Architecture:** Clean Architecture + SOLID, Domain-Driven Design, offline-first
- **Frontend:** Flutter (Android/iOS/Web) — shared codebase, Material 3
- **Backend:** REST APIs (stateless), event-driven jobs, PostgreSQL, Redis
- **Multi-tenancy:** Row-Level Security with tenant isolation + white-label theming
- **Security:** RBAC + ABAC, OAuth2/OIDC, JWT, full audit trail, encryption at rest/in transit
- **Scale target:** thousands of tenant companies, millions of trips/month

## Status

**Phase:** Design / Specification (branch `claude/enterprise-etms-design-*`).
No application code is produced in this phase — only the specification artifacts above.
Implementation begins after specification sign-off (see Roadmap, Phase 1).
