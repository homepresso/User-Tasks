-- Cache / rate-limit store (providers phase 13).
--
-- 1. The `cache` provider area: `providers.cache` / `cache.<option>` keys in
--    instance_settings and `cache` in the provider switch log.
--
-- 2. The `postgres` cache store (CACHE_PROVIDER=postgres): app_cache.entries,
--    an UNLOGGED table shared by every app replica, the worker and the admin
--    CLI — rate-limit windows, invalidation generations and short-lived
--    claims. UNLOGGED: not WAL-logged or replicated and emptied after a
--    crash, which only resets windows. The default `memory` store never
--    touches it.
--
--    Reached only through the SECURITY DEFINER functions below, which only
--    service_role may execute (the schema and table have no grants at all).
--    Every function is one statement, so concurrent callers serialise on the
--    key's row and never lose a count. Expired rows are ignored when read
--    and deleted by app_cache_sweep() (the cache-sweep job).
--
-- Idempotent (safe to re-run).

ALTER TABLE public.instance_settings DROP CONSTRAINT IF EXISTS instance_settings_key_check;
ALTER TABLE public.instance_settings ADD CONSTRAINT instance_settings_key_check CHECK (
  key ~ '^(providers\.(db|auth|storage|realtime|scheduler|email|secrets|cache)|(db|auth|storage|realtime|scheduler|email|secrets|cache|instance)\.[a-z][a-z0-9_]{0,62})$'
);

ALTER TABLE public.instance_provider_switches DROP CONSTRAINT IF EXISTS instance_provider_switches_area_check;
ALTER TABLE public.instance_provider_switches ADD CONSTRAINT instance_provider_switches_area_check
  CHECK (area IN ('db', 'auth', 'storage', 'realtime', 'scheduler', 'email', 'secrets', 'cache'));

CREATE SCHEMA IF NOT EXISTS app_cache;
REVOKE ALL ON SCHEMA app_cache FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA app_cache FROM anon, authenticated';
  END IF;
END $$;

CREATE UNLOGGED TABLE IF NOT EXISTS app_cache.entries (
  key        text PRIMARY KEY CHECK (length(key) <= 512),
  value      text,
  counter    bigint NOT NULL DEFAULT 0,
  -- NULL: no expiry (generation counters).
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS entries_expires_at_idx ON app_cache.entries (expires_at) WHERE expires_at IS NOT NULL;
REVOKE ALL ON app_cache.entries FROM PUBLIC;

COMMENT ON TABLE app_cache.entries IS
  'Shared cache / rate-limit store (CACHE_PROVIDER=postgres). UNLOGGED; reached only through public.app_cache_* (service role).';

-- Value of a live key (no row when absent or expired).
CREATE OR REPLACE FUNCTION public.app_cache_get(p_key text)
  RETURNS TABLE (value text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'app_cache', 'pg_catalog'
AS $$
  SELECT e.value FROM app_cache.entries e
   WHERE e.key = p_key AND (e.expires_at IS NULL OR e.expires_at > clock_timestamp());
$$;

-- Set a value (p_ttl_ms NULL: no expiry). With p_nx only when the key is
-- absent or expired; `stored` says whether this call set it.
CREATE OR REPLACE FUNCTION public.app_cache_set(p_key text, p_value text, p_ttl_ms bigint, p_nx boolean)
  RETURNS TABLE (stored boolean)
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'app_cache', 'pg_catalog'
AS $$
  WITH upsert AS (
    INSERT INTO app_cache.entries AS e (key, value, counter, expires_at)
    VALUES (p_key, p_value, 0, CASE WHEN p_ttl_ms IS NULL THEN NULL ELSE clock_timestamp() + p_ttl_ms * interval '1 millisecond' END)
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, counter = 0, expires_at = EXCLUDED.expires_at
      WHERE NOT p_nx OR (e.expires_at IS NOT NULL AND e.expires_at <= clock_timestamp())
    RETURNING true AS stored
  )
  SELECT coalesce((SELECT stored FROM upsert), false);
$$;

CREATE OR REPLACE FUNCTION public.app_cache_delete(p_key text)
  RETURNS TABLE (deleted boolean)
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'app_cache', 'pg_catalog'
AS $$
  WITH d AS (DELETE FROM app_cache.entries WHERE key = p_key RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM d);
$$;

-- One hit in a fixed window that starts at the key's first hit: the hit
-- count so far and the window's remaining milliseconds.
CREATE OR REPLACE FUNCTION public.app_cache_hit(p_key text, p_window_ms bigint)
  RETURNS TABLE (hits bigint, ttl_ms bigint)
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'app_cache', 'pg_catalog'
AS $$
  INSERT INTO app_cache.entries AS e (key, value, counter, expires_at)
  VALUES (p_key, NULL, 1, clock_timestamp() + p_window_ms * interval '1 millisecond')
  ON CONFLICT (key) DO UPDATE SET
    counter = CASE WHEN e.expires_at > clock_timestamp() THEN e.counter + 1 ELSE 1 END,
    expires_at = CASE WHEN e.expires_at > clock_timestamp() THEN e.expires_at
                      ELSE clock_timestamp() + p_window_ms * interval '1 millisecond' END
  RETURNING e.counter, greatest(0, ceil(extract(epoch FROM e.expires_at - clock_timestamp()) * 1000))::bigint;
$$;

-- Increment a numeric value that never expires (invalidation generations).
CREATE OR REPLACE FUNCTION public.app_cache_incr(p_key text)
  RETURNS TABLE (value bigint)
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'app_cache', 'pg_catalog'
AS $$
  INSERT INTO app_cache.entries AS e (key, value, counter, expires_at)
  VALUES (p_key, '1', 0, NULL)
  ON CONFLICT (key) DO UPDATE SET
    value = (CASE WHEN (e.expires_at IS NULL OR e.expires_at > clock_timestamp()) AND e.value ~ '^-?[0-9]{1,18}$'
                  THEN e.value::bigint ELSE 0 END + 1)::text,
    counter = 0,
    expires_at = NULL
  RETURNING e.value::bigint;
$$;

-- Delete up to p_limit expired rows.
CREATE OR REPLACE FUNCTION public.app_cache_sweep(p_limit integer DEFAULT 5000)
  RETURNS TABLE (deleted bigint)
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'app_cache', 'pg_catalog'
AS $$
  WITH expired AS (
    SELECT key FROM app_cache.entries
     WHERE expires_at IS NOT NULL AND expires_at <= clock_timestamp()
     LIMIT greatest(1, p_limit)
     FOR UPDATE SKIP LOCKED
  ), d AS (
    DELETE FROM app_cache.entries e USING expired x WHERE e.key = x.key RETURNING 1
  )
  SELECT count(*) FROM d;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.app_cache_get(text)', 'public.app_cache_set(text, text, bigint, boolean)', 'public.app_cache_delete(text)',
    'public.app_cache_hit(text, bigint)', 'public.app_cache_incr(text)', 'public.app_cache_sweep(integer)'
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
