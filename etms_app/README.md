# ETMS — Flutter Client

Cross-platform (Android / iOS / Web) client for the Enterprise Employee
Transportation Management System, built with **Clean Architecture**, **feature-first**
organization, **Riverpod**, **GoRouter**, a swappable **Supabase/Firebase** backend,
and **offline-first synchronization**.

> Design specs: [`../docs/etms`](../docs/etms) · Database: [`../db`](../db)

## Architecture

Three layers per feature; dependencies point **inward** (presentation → domain ← data).
The domain layer is pure Dart — no Flutter, no SDKs.

```
lib/
├─ main_{development,staging,production}.dart   # flavor entrypoints
├─ bootstrap.dart                               # async composition root + DI overrides
├─ app/                                          # EtmsApp (MaterialApp.router) + HomeShell
├─ l10n/arb/                                     # app_en.arb, app_ar.arb  → gen-l10n
├─ core/
│  ├─ config/        # AppConfig, Flavor, BackendProvider
│  ├─ constants/     # keys, resource names
│  ├─ error/         # Failure (domain) + AppException (data)
│  ├─ usecase/       # UseCase / StreamUseCase contracts
│  ├─ network/       # ApiClient (Dio) + auth/logging interceptors + NetworkInfo
│  ├─ backend/       # BackendClient abstraction + Supabase & Firebase adapters
│  ├─ router/        # GoRouter + auth redirect guard
│  ├─ theme/         # Material 3 themes + per-tenant white-label (TenantTheme)
│  ├─ localization/  # locale + theme-mode controllers, context.l10n
│  ├─ offline/       # LocalDatabase, OutboxDao, SyncEngine, SyncState
│  ├─ storage/       # SecureStorage, KeyValueStore
│  └─ di/            # Riverpod provider graph
├─ shared/widgets/                               # reusable UI (buttons, states, chips…)
└─ features/
   ├─ auth/     { data | domain | presentation }  ← full reference slice
   ├─ trips/    { data | domain | presentation }  ← full offline-first slice
   ├─ booking/  · dispatch/ · tracking/           ← scaffolded, same pattern
```

## Key decisions
- **No codegen required.** DTOs hand-write (de)serialization, Riverpod uses the
  non-generated API, offline storage is raw SQL (sqflite). The tree compiles right
  after `flutter pub get` + `flutter gen-l10n`. Swap in `freezed`/`json_serializable`/
  `riverpod_generator`/`drift` later without changing call sites.
- **Backend abstraction.** Features depend on `core/backend/BackendClient`, never on
  Supabase/Firebase SDK types. Pick the adapter at launch:
  `--dart-define=BACKEND=supabase` (default) or `=firebase`.
- **Error handling.** Repositories return `Either<Failure, T>` (fpdart); the data layer
  throws typed `AppException`s that repositories map to `Failure`s.
- **Offline-first.** Reads render from the local cache first; writes go to an outbox with
  an idempotency key and are drained by `SyncEngine` with exponential backoff. See
  `features/trips` for the end-to-end pattern.
- **White-label + i18n.** `TenantTheme` seeds Material 3 from `tenant_branding.theme_json`;
  full Arabic (RTL) + English (LTR) via ARB catalogs.

## Run
```bash
flutter pub get
flutter gen-l10n            # generates lib/l10n/generated/app_localizations.dart
flutter run -t lib/main_development.dart \
  --dart-define=API_BASE_URL=https://api.dev.etms.app/v1 \
  --dart-define=SUPABASE_URL=https://YOUR.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

## Test
```bash
flutter test
```
`test/` uses `mocktail`; see `test/features/auth/login_test.dart` for the pattern
(mock the repository, assert the use-case's `Either` result).

## Adding a feature
Copy the `trips` slice: create `features/<name>/{domain,data,presentation}`, define the
entity + repository interface + use-cases (domain), implement DTO + data sources +
repository (data), then wire providers + controller + screen (presentation). Register any
offline mutation handler with the `SyncEngine` in the repository constructor.
