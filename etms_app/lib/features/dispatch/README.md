# dispatch

Operations console: trip board and assignment of vehicle + driver to each trip,
with conflict/document validation (see docs/etms/05-workflows.md §5).

Scaffolded — mirror `features/trips`:
- **domain:** `Assignment` entity, `DispatchRepository`, use-cases `AssignTrip`,
  `ReassignTrip`, `WatchTripsBoard`.
- **data:** DTOs, remote (`/trips/{id}:assign`, `:reassign`), repository impl.
- **presentation:** dispatch board (columns by status), vehicle/driver picker.
