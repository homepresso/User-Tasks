-- ============================================================================
-- 20261123000000_infra_switch_lease.sql
--
-- Settings → Infrastructure without a direct connection (Supabase database
-- provider, no DATABASE_URL — Vercel and the like): config-only provider
-- switches, provider settings edits, rollbacks and the cloud unlock run
-- through the service-role API. Two things they need from the database:
--
--  1. "One switch at a time" without a session. usertasks-admin and a
--     direct connection hold the session advisory lock 815147001 while a
--     switch runs; an API caller can't hold a session lock across requests,
--     so it takes a short row lease instead (app_switch.lease, one row,
--     in a schema the API does not expose). The functions keep the two mutually exclusive:
--       instance_switch_lease_acquire(holder, ttl)  false while the advisory
--         lock is held elsewhere (checked with pg_try_advisory_xact_lock, which
--         also serialises concurrent acquires) or another holder's lease is
--         live; re-entrant for the same holder (extends the lease);
--       instance_switch_lease_release(holder);
--       instance_switch_busy(holder)  a live lease of another holder, or the
--         advisory lock held by another session (direct runners call this
--         too, so they see API switches).
--     A crashed API caller's lease simply expires (ttl, at most an hour).
--
--  2. An audit row for the cloud lock: instance_provider_switches.area may
--     be 'instance' (kind 'settings': instance.allow_ui_switching changed
--     from the page or `usertasks-admin ui-switching`), so the unlock shows
--     in the switch log with who did it and can be rolled back.
--
-- SECURITY DEFINER (the migration owner), EXECUTE for service_role only;
-- the lease table has no grants at all.
-- ============================================================================

-- A private schema (not exposed through the API): only the functions below touch it.
CREATE SCHEMA IF NOT EXISTS app_switch;
REVOKE ALL ON SCHEMA app_switch FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA app_switch FROM anon, authenticated, service_role';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_switch.lease (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  holder      uuid NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

REVOKE ALL ON app_switch.lease FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON app_switch.lease FROM anon, authenticated, service_role';
  END IF;
END $$;

COMMENT ON TABLE app_switch.lease IS
  'Provider-switch lease for callers without a session (Settings → Infrastructure over the service-role API). Use the public.instance_switch_lease_* functions.';

CREATE OR REPLACE FUNCTION public.instance_switch_lease_acquire(p_holder uuid, p_ttl_seconds integer DEFAULT 300)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_holder IS NULL THEN
    RAISE EXCEPTION 'instance_switch_lease_acquire: holder is required';
  END IF;
  -- Held by a session (usertasks-admin, a direct connection, the background runner): busy.
  -- The transaction-level lock also makes two concurrent acquires take turns.
  IF NOT pg_try_advisory_xact_lock(815147001) THEN
    RETURN false;
  END IF;
  INSERT INTO app_switch.lease AS l (id, holder, acquired_at, expires_at)
  VALUES (true, p_holder, now(), now() + make_interval(secs => greatest(10, least(coalesce(p_ttl_seconds, 300), 3600))))
  ON CONFLICT (id) DO UPDATE
    SET holder = EXCLUDED.holder,
        acquired_at = CASE WHEN l.holder = EXCLUDED.holder AND l.expires_at > now() THEN l.acquired_at ELSE now() END,
        expires_at = EXCLUDED.expires_at
    WHERE l.holder = EXCLUDED.holder OR l.expires_at <= now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.instance_switch_lease_release(p_holder uuid)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_rows integer;
BEGIN
  DELETE FROM app_switch.lease WHERE holder = p_holder;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.instance_switch_busy(p_holder uuid DEFAULT NULL)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT EXISTS (
           SELECT 1 FROM app_switch.lease
            WHERE expires_at > now() AND holder IS DISTINCT FROM p_holder)
      OR EXISTS (
           SELECT 1 FROM pg_locks l
            WHERE l.locktype = 'advisory' AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
              AND l.classid = 0 AND l.objid = 815147001::bigint::oid AND l.objsubid = 1 AND l.granted
              AND l.pid <> pg_backend_pid());
$$;

COMMENT ON FUNCTION public.instance_switch_lease_acquire(uuid, integer) IS
  'Take (or extend) the provider-switch lease; false while another switch runs (service role only).';
COMMENT ON FUNCTION public.instance_switch_lease_release(uuid) IS
  'Release the provider-switch lease taken with instance_switch_lease_acquire (service role only).';
COMMENT ON FUNCTION public.instance_switch_busy(uuid) IS
  'Whether a provider switch runs elsewhere: another holder''s live lease or the session advisory lock (service role only).';

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.instance_switch_lease_acquire(uuid, integer)',
    'public.instance_switch_lease_release(uuid)',
    'public.instance_switch_busy(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', f);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END IF;
  END LOOP;
END $$;

-- The cloud lock's audit rows.
ALTER TABLE public.instance_provider_switches DROP CONSTRAINT IF EXISTS instance_provider_switches_area_check;
ALTER TABLE public.instance_provider_switches ADD CONSTRAINT instance_provider_switches_area_check
  CHECK (area IN ('db', 'auth', 'storage', 'realtime', 'scheduler', 'email', 'secrets', 'cache', 'kms', 'instance'));

NOTIFY pgrst, 'reload schema';
