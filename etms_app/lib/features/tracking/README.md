# tracking

Live tracking, control tower, and SOS/incidents. Realtime positions stream via
`core/backend/BackendClient.watch` (Supabase realtime / Firestore snapshots).

Scaffolded — mirror `features/trips`:
- **domain:** `VehiclePosition`, `Incident` entities, `TrackingRepository`,
  use-cases `WatchTripPosition`, `RaiseSos`, `ResolveIncident`.
- **data:** DTOs, realtime data source (`watch`), REST for incidents, repository impl.
- **presentation:** rider live-ETA map, ops control-tower map + exception feed, SOS button.
