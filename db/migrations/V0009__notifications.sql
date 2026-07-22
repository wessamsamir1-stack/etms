-- =============================================================================
-- ETMS — V0009: Notifications (templates, messages, device tokens, webhooks)
-- =============================================================================

CREATE TABLE notification_template (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  code       text        NOT NULL,          -- 'booking_confirmed', 'driver_arriving', ...
  channel    text        NOT NULL CHECK (channel IN ('push','sms','email','whatsapp')),
  locale     text        NOT NULL,
  subject    text,
  body       text        NOT NULL,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notif_template UNIQUE (tenant_id, code, channel, locale)
);
SELECT attach_standard_triggers('notification_template');

CREATE TABLE notification (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  channel       text        NOT NULL CHECK (channel IN ('push','sms','email','whatsapp')),
  template_code text,
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status        text        NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','sent','delivered','failed','read')),
  provider_ref  text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  delivered_at  timestamptz
);
CREATE INDEX ix_notification_user   ON notification(tenant_id, user_id, created_at DESC);
CREATE INDEX ix_notification_status ON notification(tenant_id, status) WHERE status IN ('queued','failed');

CREATE TABLE device_token (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  platform   text        NOT NULL CHECK (platform IN ('android','ios','web')),
  token      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  CONSTRAINT uq_device_token UNIQUE (tenant_id, token)
);
CREATE INDEX ix_device_token_user ON device_token(user_id);

-- Outbound webhook subscriptions (signed, retried, replayable)
CREATE TABLE webhook_subscription (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  url         text        NOT NULL,
  events      text[]      NOT NULL DEFAULT '{}',
  secret_enc  text        NOT NULL,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
SELECT attach_standard_triggers('webhook_subscription');

CREATE TABLE webhook_delivery (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     uuid        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  subscription_id uuid      NOT NULL REFERENCES webhook_subscription(id) ON DELETE CASCADE,
  event         text        NOT NULL,
  payload       jsonb       NOT NULL,
  status        text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','delivered','failed')),
  attempts      int         NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_webhook_delivery_status ON webhook_delivery(tenant_id, status);
