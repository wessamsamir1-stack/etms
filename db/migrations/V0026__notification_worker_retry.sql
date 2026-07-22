-- =============================================================================
-- ETMS — V0026: Notification outbox retry bookkeeping.
--
-- The `notification` table is an outbox: endpoints INSERT rows as 'queued' (bus
-- arrived, No-Show, OTP, ride offers, template sends). A standalone worker
-- (scripts/notification-worker) drains it and delivers via the channel provider.
-- These columns let the worker retry transient failures with backoff and give
-- up after a bounded number of attempts.
-- =============================================================================

ALTER TABLE notification
  ADD COLUMN attempts        int         NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz;

-- The worker polls for due, still-queued rows oldest-first.
CREATE INDEX ix_notification_due ON notification(next_attempt_at, created_at)
  WHERE status = 'queued';
