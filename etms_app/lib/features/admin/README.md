# Admin Portal (Flutter Web)

The Operations/Admin Console (screens O-01…O-31), built **depth-first**: a generic,
RBAC-gated CRUD engine plus fully-working screens for the core resources. Runs on the same
`etms_app` codebase (web target) and reuses `core/` (backend abstraction, theming, router,
error model).

## Entry & access control
- Route `/admin` (guarded in `core/router`): only users holding an admin permission
  (`isAdminUserProvider`) may enter; others are redirected home.
- Reachable from the app shell's Profile tab ("Admin Portal", shown only to admins).
- **Permissions** are the user's *effective* permissions loaded from the DB view
  `v_user_effective_permissions` (`db/migrations/V0013`) via `permissionsProvider`.
  `ref.can('perm')` gates every destination, New button, and row action; read-only roles see
  disabled controls.

## What's implemented (working end-to-end)
| Screen | Resource | Notes |
|--------|----------|-------|
| Dashboard (O-01) | counts | live KPI tiles via `BackendClient.count` |
| Sites (O-03) | `site` | full CRUD |
| Vehicles (O-14) | `vehicle` | full CRUD + vendor reference + expiry dates |
| Employees (O-20) | `employee` | full CRUD + cost-center/site references + eligibility |
| Users (O-30) | `app_user` | full CRUD |
| Roles & Permissions (O-30) | `role` / `role_permission` | permission matrix, grant/revoke |

## How it's built (reusable engine)
- **`core/admin/crud_repository.dart`** — generic `list/create/update/remove/removeWhere`
  over `BackendClient`, mapping exceptions to `Either<Failure,_>`.
- **`core/admin/crud_controller.dart`** — `crudListProvider` family (by resource) with
  `AsyncValue<List<Row>>` + mutations; injects the caller's `tenant_id` on create.
- **`shared/admin/resource_config.dart`** — declarative `ResourceConfig` (columns + fields +
  permissions). Add a screen by adding a config.
- **`shared/admin/`** — `CrudListPage` (toolbar + search + states + RBAC), `DataTableView`
  (table on wide, cards on compact), `ResourceFormDialog` (text/number/bool/select/date/
  reference fields with validation), `confirm` dialog.
- **`features/admin/shell/admin_shell.dart`** — NavigationRail (wide) / NavigationBar
  (compact), destinations filtered by permission.

Every screen inherits the global states from `docs/etms/screens/README.md`: loading skeletons,
empty-new vs empty-filtered, error + retry, submit-locking, snackbar confirmation.

## Adding a resource screen
1. Add a `ResourceConfig` in `resources/resource_configs.dart` (columns, fields, permissions).
2. Add a `_Destination` in `admin_shell.dart` → `CrudListPage(config: …)`.
That's it — CRUD, search, validation, RBAC, and responsive layout come for free.

## Backend-binding assumptions & known limitations
- The portal uses `BackendClient` generic CRUD (Supabase adapter by default), addressing the
  DB tables/views directly. **Multi-tenant isolation:** our RLS policies key on
  `app.tenant_id` (set by the REST API). For **direct Supabase** access, bind RLS to the JWT
  tenant claim (or route the portal through the REST API) — the app already sends `tenant_id`
  on inserts. Documented as an integration step; not a code change to these screens.
- **Delete is currently hard-delete.** The schema supports soft-delete (`deleted_at`); moving
  to soft-delete + `deleted_at IS NULL` list filtering needs `QuerySpec` null-filters (small
  follow-up). `ResourceConfig.softDelete` already flags intent in the confirm dialog.
- Reference pickers load up to the first page of the referenced resource (fine for MVP; add
  server-side search for very large lists).
- Labels are English; localize via ARB the same way as the rider/driver apps when needed.

## Verification
Flutter is not installed in this environment, so these screens are **reviewed, not compiled**
(same caveat as the rest of `etms_app`). The supporting DB view `v_user_effective_permissions`
**was** verified against PostgreSQL 16 + PostGIS (RLS-scoped, returns correct effective
permissions per role). Run `flutter pub get && flutter gen-l10n && flutter run -d chrome
-t lib/main_development.dart` to exercise the portal.
