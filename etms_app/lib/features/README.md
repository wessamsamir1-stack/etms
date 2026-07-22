# Features

Each feature is a self-contained Clean Architecture slice with three layers:

```
<feature>/
├─ domain/          # entities, repository interfaces, use-cases (pure Dart)
├─ data/            # DTOs, remote/local data sources, repository impl
└─ presentation/    # providers, controllers, screens, widgets (Riverpod + Flutter)
```

**Dependency rule:** `presentation → domain ← data`. Domain imports nothing from
Flutter, Dio, Supabase, Firebase, or sqflite.

## Status in this skeleton

| Feature | State | Notes |
|---------|-------|-------|
| `auth` | ✅ full reference slice | login/logout, session persistence, GoRouter guard |
| `trips` | ✅ full offline-first slice | cache-first reads, outbox writes, sync handler |
| `booking` | 🧩 scaffolded | mirror `trips`: Booking entity, BookingRepository, screens |
| `dispatch` | 🧩 scaffolded | trip board + assign vehicle/driver (ops console) |
| `tracking` | 🧩 scaffolded | realtime via `BackendClient.watch`, control tower, SOS |

Remaining product features from the SRS map onto the same pattern, one folder each:
`master_data`, `fleet`, `planning`, `costing`, `notifications`, `reports`,
`admin` (users/roles/branding), `tenant`.

Build them by copying the `trips` slice — see the root `README.md` → "Adding a feature".
