-- =============================================================================
-- ETMS — V0024: Retire the superseded seat-booking tables.
--
-- The daily-commute model (doc 17) replaced seat reservation with the passenger
-- MANIFEST (`trip_passenger`, V0021). The old `booking` and `seat_allocation`
-- tables are no longer used by the apps, so they are removed here. First we
-- repoint everything that still referenced them onto the manifest:
--   * mv_no_show      — no-shows now come from the manifest, not `booking`.
--   * ride_request    — a claimed request now links a manifest row, not a seat.
--   * transport_usage — drop the vestigial seat_allocation link (usage is keyed
--                       by trip + employee + direction).
-- Dropping the tables also drops their RLS policies and triggers automatically.
--
-- Note: the `booking.*` permission codes (V0012) are left in the catalog as
-- harmless legacy entries; no endpoint uses them anymore.
-- =============================================================================

-- ---- No-show analytics: booking → manifest ---------------------------------
-- The materialized view carried WITH NO DATA and is never refreshed in code, so
-- this only changes its definition. trip_passenger has no service_date of its
-- own (it is a per-trip attendance row), so we take it from the trip.
DROP MATERIALIZED VIEW IF EXISTS mv_no_show;
CREATE MATERIALIZED VIEW mv_no_show AS
SELECT
  tp.tenant_id, t.service_date, tp.employee_id,
  count(*) FILTER (WHERE tp.status = 'no_show') AS no_shows
FROM trip_passenger tp
JOIN trip t ON t.id = tp.trip_id
GROUP BY tp.tenant_id, t.service_date, tp.employee_id
WITH NO DATA;
CREATE UNIQUE INDEX uq_mv_no_show
  ON mv_no_show(tenant_id, service_date, employee_id);

-- ---- ride_request: a claim now attaches a manifest row, not a seat ----------
ALTER TABLE ride_request DROP COLUMN IF EXISTS seat_allocation_id;
ALTER TABLE ride_request
  ADD COLUMN trip_passenger_id uuid REFERENCES trip_passenger(id) ON DELETE SET NULL;

-- ---- transport_usage: drop the vestigial seat link --------------------------
ALTER TABLE transport_usage DROP COLUMN IF EXISTS seat_allocation_id;

-- ---- Drop the superseded tables (seat_allocation FKs booking → drop first) --
DROP TABLE IF EXISTS seat_allocation;
DROP TABLE IF EXISTS booking;
