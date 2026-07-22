-- =============================================================================
-- ETMS — V0010: Analytics read models (materialized views for dashboards)
-- Refresh incrementally via scheduled job: REFRESH MATERIALIZED VIEW CONCURRENTLY.
-- =============================================================================

-- Daily operational KPIs per site
CREATE MATERIALIZED VIEW mv_trip_daily_kpi AS
SELECT
  t.tenant_id,
  t.service_date,
  t.site_id,
  count(*)                                              AS trips_total,
  count(*) FILTER (WHERE t.status = 'completed')        AS trips_completed,
  count(*) FILTER (WHERE t.status = 'cancelled')        AS trips_cancelled,
  count(*) FILTER (WHERE t.status = 'exception')        AS trips_exception,
  count(*) FILTER (WHERE t.actual_start IS NOT NULL
                    AND t.actual_start <= t.planned_start) AS trips_on_time,
  coalesce(sum(t.seats_taken),0)                        AS seats_taken,
  coalesce(sum(t.capacity),0)                           AS capacity_total
FROM trip t
GROUP BY t.tenant_id, t.service_date, t.site_id
WITH NO DATA;
CREATE UNIQUE INDEX uq_mv_trip_daily_kpi
  ON mv_trip_daily_kpi(tenant_id, service_date, site_id);

-- No-show summary per employee/day
CREATE MATERIALIZED VIEW mv_no_show AS
SELECT
  b.tenant_id, b.service_date, b.employee_id,
  count(*) FILTER (WHERE b.status = 'no_show') AS no_shows
FROM booking b
GROUP BY b.tenant_id, b.service_date, b.employee_id
WITH NO DATA;
CREATE UNIQUE INDEX uq_mv_no_show
  ON mv_no_show(tenant_id, service_date, employee_id);

-- Cost rollup per cost-center per month
CREATE MATERIALIZED VIEW mv_cost_by_center AS
SELECT
  tc.tenant_id,
  date_trunc('month', tc.computed_at)::date AS period,
  tc.cost_center_id,
  tc.currency_code,
  count(*)          AS trips,
  sum(tc.amount)    AS total_amount
FROM trip_cost tc
GROUP BY tc.tenant_id, date_trunc('month', tc.computed_at), tc.cost_center_id, tc.currency_code
WITH NO DATA;
CREATE UNIQUE INDEX uq_mv_cost_by_center
  ON mv_cost_by_center(tenant_id, period, cost_center_id, currency_code);

-- Vendor spend + reconciliation variance per month
CREATE MATERIALIZED VIEW mv_vendor_spend AS
SELECT
  vi.tenant_id,
  vi.vendor_id,
  date_trunc('month', vi.created_at)::date AS period,
  count(DISTINCT vi.id)                     AS invoices,
  sum(vi.total_amount)                      AS invoiced_amount,
  sum(il.variance)                          AS total_variance
FROM vendor_invoice vi
LEFT JOIN invoice_line il ON il.invoice_id = vi.id
GROUP BY vi.tenant_id, vi.vendor_id, date_trunc('month', vi.created_at)
WITH NO DATA;
CREATE UNIQUE INDEX uq_mv_vendor_spend
  ON mv_vendor_spend(tenant_id, vendor_id, period);

-- Convenience view: documents expiring within 30 days (fleet compliance)
CREATE VIEW v_expiring_documents AS
SELECT tenant_id, 'vehicle'::text AS entity, vehicle_id AS entity_id, doc_type, expires_at
FROM vehicle_document
WHERE expires_at IS NOT NULL AND expires_at <= current_date + INTERVAL '30 days'
UNION ALL
SELECT tenant_id, 'driver'::text AS entity, driver_id AS entity_id, doc_type, expires_at
FROM driver_document
WHERE expires_at IS NOT NULL AND expires_at <= current_date + INTERVAL '30 days';
