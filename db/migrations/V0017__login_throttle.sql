-- =============================================================================
-- ETMS — V0017: per-account login throttling (brute-force / guessing defense)
-- Complements the per-IP rate limiter with a PER-ACCOUNT progressive lockout so
-- an attacker rotating IPs still cannot hammer one account. Login runs before a
-- tenant context exists, so access is via SECURITY DEFINER functions only.
-- =============================================================================

CREATE TABLE login_throttle (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_slug     citext      NOT NULL,
  email           citext      NOT NULL,
  failed_count    int         NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_login_throttle UNIQUE (tenant_slug, email)
);
-- Accessible only through the functions below.
REVOKE ALL ON login_throttle FROM PUBLIC;

-- Is this (tenant, account) currently locked, and for how long?
CREATE OR REPLACE FUNCTION auth_login_status(p_slug citext, p_email citext)
  RETURNS TABLE(locked boolean, retry_after int)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    SELECT (locked_until IS NOT NULL AND locked_until > now()) AS locked,
           GREATEST(0, CEIL(EXTRACT(EPOCH FROM (locked_until - now()))))::int AS retry_after
    FROM login_throttle
    WHERE tenant_slug = p_slug AND email = p_email;
  $$;

-- Record a failed attempt; apply a progressive lock. Counter resets if the last
-- attempt was over an hour ago (so counts don't accumulate forever).
CREATE OR REPLACE FUNCTION auth_login_failure(p_slug citext, p_email citext)
  RETURNS TABLE(failed_count int, locked_until timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE v_count int; v_lock timestamptz;
  BEGIN
    INSERT INTO login_throttle(tenant_slug, email, failed_count, last_attempt_at)
      VALUES (p_slug, p_email, 1, now())
      ON CONFLICT (tenant_slug, email) DO UPDATE SET
        failed_count = CASE
          WHEN login_throttle.last_attempt_at < now() - interval '1 hour' THEN 1
          ELSE login_throttle.failed_count + 1 END,
        last_attempt_at = now()
      RETURNING login_throttle.failed_count INTO v_count;

    v_lock := CASE
      WHEN v_count >= 12 THEN now() + interval '15 minutes'
      WHEN v_count >= 8  THEN now() + interval '5 minutes'
      WHEN v_count >= 5  THEN now() + interval '1 minute'
      ELSE NULL END;

    UPDATE login_throttle SET locked_until = v_lock
      WHERE tenant_slug = p_slug AND email = p_email;
    RETURN QUERY SELECT v_count, v_lock;
  END $$;

-- Clear throttle on a successful login.
CREATE OR REPLACE FUNCTION auth_login_success(p_slug citext, p_email citext)
  RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ DELETE FROM login_throttle WHERE tenant_slug = p_slug AND email = p_email; $$;

REVOKE ALL ON FUNCTION auth_login_status(citext, citext)  FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_login_failure(citext, citext) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_login_success(citext, citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_login_status(citext, citext)  TO etms_app;
GRANT EXECUTE ON FUNCTION auth_login_failure(citext, citext) TO etms_app;
GRANT EXECUTE ON FUNCTION auth_login_success(citext, citext) TO etms_app;
