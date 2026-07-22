-- =============================================================================
-- ETMS — V0000: Extensions, session context, and core reusable functions
-- PostgreSQL 15+. Run migrations in filename order (V0000, V0001, ...).
-- =============================================================================

-- ---- Extensions ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email/handle
CREATE EXTENSION IF NOT EXISTS postgis;     -- geography/geometry types + GiST
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- composite exclusion constraints
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy search on names/plates

-- ---- Session context helpers ----------------------------------------------
-- The application sets these per request from the validated JWT:
--   SELECT set_config('app.tenant_id', '<uuid>', true);
--   SELECT set_config('app.user_id',   '<uuid>', true);
-- '' / unset resolves to NULL so unscoped admin/migration sessions still work.

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- ---- updated_at maintenance ------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---- Generic immutable audit capture --------------------------------------
-- Attached (via helper below) to every tenant-owned business table that has a
-- tenant_id column. Writes a full before/after snapshot to audit_entry.
CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_tenant   uuid;
  v_before   jsonb;
  v_after    jsonb;
  v_entityid text;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    v_before := to_jsonb(OLD); v_after := NULL;
    v_tenant := OLD.tenant_id; v_entityid := OLD.id::text;
  ELSIF (TG_OP = 'UPDATE') THEN
    v_before := to_jsonb(OLD); v_after := to_jsonb(NEW);
    v_tenant := NEW.tenant_id; v_entityid := NEW.id::text;
  ELSE -- INSERT
    v_before := NULL; v_after := to_jsonb(NEW);
    v_tenant := NEW.tenant_id; v_entityid := NEW.id::text;
  END IF;

  INSERT INTO audit_entry(
    tenant_id, actor_user_id, action, entity_type, entity_id,
    before_json, after_json)
  VALUES (
    v_tenant, app_current_user(),
    lower(TG_TABLE_NAME) || '.' || lower(TG_OP),
    TG_TABLE_NAME, v_entityid, v_before, v_after);

  RETURN COALESCE(NEW, OLD);
END $$;

-- Convenience: attach updated_at + audit triggers to a table by name.
CREATE OR REPLACE FUNCTION attach_standard_triggers(p_table regclass) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE t text := p_table::text;
BEGIN
  EXECUTE format(
    'CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON %s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
    replace(t,'.','_'), t);
  EXECUTE format(
    'CREATE TRIGGER trg_%s_audit AFTER INSERT OR UPDATE OR DELETE ON %s
       FOR EACH ROW EXECUTE FUNCTION audit_row()',
    replace(t,'.','_'), t);
END $$;

-- ---- Immutable audit log (created first; referenced by audit_row) ----------
-- No FKs by design: decoupled + append-only. Insert-only privilege set later.
CREATE TABLE audit_entry (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     uuid,                     -- null only for platform-level events
  actor_user_id uuid,
  action        text        NOT NULL,     -- e.g. 'trip.update', 'invoice.reconcile'
  entity_type   text        NOT NULL,
  entity_id     text,
  before_json   jsonb,
  after_json    jsonb,
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_tenant_time   ON audit_entry(tenant_id, created_at DESC);
CREATE INDEX ix_audit_entity        ON audit_entry(tenant_id, entity_type, entity_id);
CREATE INDEX ix_audit_actor         ON audit_entry(tenant_id, actor_user_id, created_at DESC);
