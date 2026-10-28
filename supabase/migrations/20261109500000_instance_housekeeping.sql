-- ============================================================================
-- 20261109500000_instance_housekeeping.sql
--
-- Instance housekeeping: purges the system tables that grow without bound,
-- on by default, configurable with `housekeeping.*` instance settings
-- (usertasks-admin housekeeping, Settings → Infrastructure).
--
-- Why: production's cron.job_run_details reached 138 MB for ~18k rows. The
-- table belongs to supabase_admin (no VACUUM FULL for us), every pg_cron run
-- inserts into it, and the daily purge (20261103100000, rows > 2 days) let it
-- churn through a day's worth of dead tuples between runs. Purging little
-- and often keeps it small enough for autovacuum to reuse its pages.
--
-- 1. `housekeeping.<option>` keys in instance_settings (key check updated):
--      housekeeping.enabled                boolean, default true
--      housekeeping.interval_minutes       15|30|60|120|180|240|360|480|720|1440, default 60
--      housekeeping.cron_history_hours     1..2160 (90 days), default 24
--      housekeeping.http_response_minutes  5..10080 (7 days), default 60
--    Mirrored in lib/config/housekeeping.ts; out-of-range or malformed
--    stored values fall back to the default here as well.
--
-- 2. app_cron.run_housekeeping(): one bounded pass — rows older than the
--    retention in cron.job_run_details and net._http_response, expired rows
--    of the cache store (app_cache.entries) and of built-in auth
--    (app_auth.sessions / tokens / flow_states / replay_cache), and its own
--    run log past 30 days. Each DELETE removes at most 5,000 rows, in its own
--    subtransaction, under lock_timeout 2 s; the pass stops starting batches
--    when its time budget is spent and reports `more`. A table that isn't
--    installed (no pg_cron / pg_net / cache store / built-in auth) or that
--    this role may not delete from is reported, not failed. Overlapping
--    calls skip (advisory lock); scheduled calls skip until the interval has
--    passed since the last run, so pg_cron and the app's tick can both call it.
--    Tenant data is not touched: queue history, event_stream, OAuth codes and
--    tokens stay with the daily cleanup-logs job (per-workspace retention).
--
-- 3. app_cron.housekeeping_runs: one row per pass (trigger, actor, rows
--    deleted per table, notes), kept 30 days. Dry runs are not recorded.
--
-- 4. app_cron.housekeeping_status(): effective settings, size / row estimates
--    of every system table that grows, the last runs.
--
-- 5. public.instance_housekeeping_run / instance_housekeeping_status:
--    service_role-only RPCs for the app (job registry, Infrastructure page)
--    and usertasks-admin.
--
-- 6. pg_cron (when installed):
--      usertasks-housekeeping       */15 * * * *  app_cron.run_housekeeping()
--                                                 (runs when the interval is due)
--      usertasks-cron-housekeeping  30 3 * * *    the daily pass, forced, with a
--                                                 larger budget (catch-up)
--    The worker / external schedulers run the same function from the job
--    registry (lib/jobs/registry.ts: housekeeping, housekeeping-daily).
--
-- Idempotent; works without pg_cron, pg_net, the cache store or built-in auth.
-- ============================================================================

ALTER TABLE public.instance_settings DROP CONSTRAINT IF EXISTS instance_settings_key_check;
ALTER TABLE public.instance_settings ADD CONSTRAINT instance_settings_key_check CHECK (
  key ~ '^(providers\.(db|auth|storage|realtime|scheduler|email|secrets|cache|kms)|(db|auth|storage|realtime|scheduler|email|secrets|cache|kms|instance|housekeeping)\.[a-z][a-z0-9_]{0,62})$'
);

CREATE SCHEMA IF NOT EXISTS app_cron;
REVOKE ALL ON SCHEMA app_cron FROM PUBLIC, anon, authenticated;

-- ── Run log ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_cron.housekeeping_runs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- pg_cron | pg_cron-daily | tick | tick-daily | cli | ui | migration
  trigger     text NOT NULL,
  actor       text,
  -- ok | partial (budget spent, or a table was skipped on a lock / privilege)
  status      text NOT NULL CHECK (status IN ('ok', 'partial')),
  started_at  timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  duration_ms integer NOT NULL,
  -- {"<table>": rows deleted}
  deleted     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {"<table>": "not_installed" | "no_privilege" | "lock_timeout" | "budget"}
  notes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  more        boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS housekeeping_runs_started_idx ON app_cron.housekeeping_runs (started_at DESC);

REVOKE ALL ON app_cron.housekeeping_runs FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE app_cron.housekeeping_runs IS
  'One row per app_cron.run_housekeeping() pass (kept 30 days). Read through public.instance_housekeeping_status().';

-- ── Settings ────────────────────────────────────────────────────────────────

-- An integer from a stored setting (JSON number or numeric string) within
-- [min, max] and, when given, one of `choices`; anything else → the default.
CREATE OR REPLACE FUNCTION app_cron.housekeeping_int(p_value jsonb, p_default integer, p_min integer, p_max integer, p_choices integer[] DEFAULT NULL)
  RETURNS integer
  LANGUAGE plpgsql IMMUTABLE
  SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_text text := CASE jsonb_typeof(p_value) WHEN 'number' THEN p_value::text WHEN 'string' THEN trim(p_value #>> '{}') END;
  v integer;
BEGIN
  IF v_text IS NULL OR v_text !~ '^[0-9]{1,9}$' THEN RETURN p_default; END IF;
  v := v_text::integer;
  IF v < p_min OR v > p_max OR (p_choices IS NOT NULL AND NOT v = ANY (p_choices)) THEN RETURN p_default; END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION app_cron.housekeeping_settings()
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  s jsonb := '{}'::jsonb;
  v_enabled jsonb;
BEGIN
  IF to_regclass('public.instance_settings') IS NOT NULL THEN
    SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) INTO s
      FROM public.instance_settings WHERE key LIKE 'housekeeping.%' AND NOT secret;
  END IF;
  v_enabled := s->'housekeeping.enabled';
  RETURN jsonb_build_object(
    'enabled', CASE
      WHEN jsonb_typeof(v_enabled) = 'boolean' THEN v_enabled::text::boolean
      WHEN lower(v_enabled #>> '{}') IN ('false', '0', 'no', 'off') THEN false
      ELSE true END,
    'interval_minutes', app_cron.housekeeping_int(s->'housekeeping.interval_minutes', 60, 15, 1440,
                                                  ARRAY[15, 30, 60, 120, 180, 240, 360, 480, 720, 1440]),
    'cron_history_hours', app_cron.housekeeping_int(s->'housekeeping.cron_history_hours', 24, 1, 2160),
    'http_response_minutes', app_cron.housekeeping_int(s->'housekeeping.http_response_minutes', 60, 5, 10080)
  );
END;
$$;

-- ── One table, in batches ───────────────────────────────────────────────────

-- Deletes rows of p_rel matching p_pred ($1 = p_cutoff) in batches of
-- p_batch, each its own subtransaction, until fewer than p_batch match,
-- p_max_batches ran or p_deadline passed. Dry run: counts instead.
-- Returns {"deleted": n, "note": null | "not_installed" | "no_privilege" |
-- "lock_timeout" | "budget"}. p_rel / p_pred come from run_housekeeping only.
CREATE OR REPLACE FUNCTION app_cron.housekeeping_purge(
  p_rel text, p_pred text, p_cutoff timestamptz, p_dry_run boolean,
  p_deadline timestamptz, p_max_batches integer, p_batch integer DEFAULT 5000
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  v_total bigint := 0;
  v_batch bigint;
  v_i integer := 0;
BEGIN
  IF to_regclass(p_rel) IS NULL THEN
    RETURN jsonb_build_object('deleted', 0, 'note', 'not_installed');
  END IF;
  IF NOT has_table_privilege(p_rel, 'DELETE') THEN
    RETURN jsonb_build_object('deleted', 0, 'note', 'no_privilege');
  END IF;
  IF p_dry_run THEN
    BEGIN
      EXECUTE format('SELECT count(*) FROM %s WHERE %s', p_rel, p_pred) INTO v_total USING p_cutoff;
    EXCEPTION WHEN insufficient_privilege THEN
      RETURN jsonb_build_object('deleted', 0, 'note', 'no_privilege');
    END;
    RETURN jsonb_build_object('deleted', v_total, 'note', NULL);
  END IF;
  LOOP
    IF v_i >= p_max_batches OR clock_timestamp() > p_deadline THEN
      RETURN jsonb_build_object('deleted', v_total, 'note', 'budget');
    END IF;
    v_i := v_i + 1;
    BEGIN
      EXECUTE format(
        'DELETE FROM %1$s WHERE ctid = ANY (ARRAY(SELECT ctid FROM %1$s WHERE %2$s LIMIT %3$s))',
        p_rel, p_pred, p_batch
      ) USING p_cutoff;
      GET DIAGNOSTICS v_batch = ROW_COUNT;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RETURN jsonb_build_object('deleted', v_total, 'note', 'no_privilege');
      WHEN lock_not_available THEN
        RETURN jsonb_build_object('deleted', v_total, 'note', 'lock_timeout');
    END;
    v_total := v_total + v_batch;
    EXIT WHEN v_batch < p_batch;
  END LOOP;
  RETURN jsonb_build_object('deleted', v_total, 'note', NULL);
END;
$$;

-- ── The pass ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_cron.run_housekeeping(
  p_trigger     text    DEFAULT 'pg_cron',
  p_force       boolean DEFAULT false,
  p_dry_run     boolean DEFAULT false,
  p_actor       text    DEFAULT NULL,
  p_budget_ms   integer DEFAULT 20000,
  p_max_batches integer DEFAULT 40
)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'pg_temp'
  SET lock_timeout TO '2s'
AS $$
DECLARE
  v_settings jsonb := app_cron.housekeeping_settings();
  v_manual boolean := p_trigger IN ('cli', 'ui');
  v_started timestamptz := clock_timestamp();
  v_deadline timestamptz;
  v_last timestamptz;
  v_deleted jsonb := '{}'::jsonb;
  v_notes jsonb := '{}'::jsonb;
  v_more boolean := false;
  v_partial boolean := false;
  v_result jsonb;
  v_finished timestamptz;
  t record;
BEGIN
  IF p_trigger IS NULL OR p_trigger NOT IN ('pg_cron', 'pg_cron-daily', 'tick', 'tick-daily', 'cli', 'ui', 'migration') THEN
    RAISE EXCEPTION 'run_housekeeping: unknown trigger %', p_trigger USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Disabled stops the scheduled passes only; an operator's run still runs.
  IF NOT (v_settings->>'enabled')::boolean AND NOT v_manual THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'disabled', 'settings', v_settings);
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtextextended('usertasks:housekeeping', 0)) THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'busy', 'settings', v_settings);
  END IF;

  -- Due when the interval (less 2 minutes of scheduling jitter) has passed.
  IF NOT p_force AND NOT p_dry_run THEN
    SELECT max(started_at) INTO v_last FROM app_cron.housekeeping_runs;
    IF v_last IS NOT NULL
       AND v_last > now() - make_interval(mins => (v_settings->>'interval_minutes')::integer - 2) THEN
      RETURN jsonb_build_object('status', 'skipped', 'reason', 'not_due', 'last_run_at', v_last, 'settings', v_settings);
    END IF;
  END IF;

  v_deadline := v_started + make_interval(secs => greatest(coalesce(p_budget_ms, 20000), 1000) / 1000.0);

  FOR t IN
    SELECT * FROM (VALUES
      (1, 'cron.job_run_details', 'coalesce(end_time, start_time) < $1',
          now() - make_interval(hours => (v_settings->>'cron_history_hours')::integer)),
      (2, 'net._http_response', 'created < $1',
          now() - make_interval(mins => (v_settings->>'http_response_minutes')::integer)),
      (3, 'app_cache.entries', 'expires_at IS NOT NULL AND expires_at <= $1', clock_timestamp()),
      (4, 'app_auth.sessions', '(expires_at < $1 OR revoked_at < $1)', now() - interval '1 day'),
      (5, 'app_auth.tokens', 'expires_at < $1', now() - interval '1 day'),
      (6, 'app_auth.flow_states', 'expires_at < $1', now()),
      (7, 'app_auth.replay_cache', 'expires_at < $1', now()),
      (8, 'app_cron.housekeeping_runs', 'started_at < $1', now() - interval '30 days')
    ) AS x(ord, rel, pred, cutoff)
    ORDER BY ord
  LOOP
    v_result := app_cron.housekeeping_purge(t.rel, t.pred, t.cutoff, p_dry_run, v_deadline,
                                            greatest(coalesce(p_max_batches, 40), 1));
    v_deleted := v_deleted || jsonb_build_object(t.rel, (v_result->>'deleted')::bigint);
    IF v_result->>'note' IS NOT NULL THEN
      v_notes := v_notes || jsonb_build_object(t.rel, v_result->>'note');
      IF v_result->>'note' = 'budget' THEN v_more := true; END IF;
      IF v_result->>'note' IN ('budget', 'lock_timeout') THEN v_partial := true; END IF;
      -- Not being allowed to purge pg_cron's or pg_net's table is the
      -- platform's choice, not a failed run; elsewhere it is worth a look.
      IF v_result->>'note' = 'no_privilege' AND t.rel NOT IN ('cron.job_run_details', 'net._http_response') THEN
        v_partial := true;
      END IF;
    END IF;
  END LOOP;

  v_finished := clock_timestamp();
  v_result := jsonb_build_object(
    'status', CASE WHEN v_partial THEN 'partial' ELSE 'ok' END,
    'trigger', p_trigger,
    'actor', p_actor,
    'dry_run', p_dry_run,
    'started_at', v_started,
    'finished_at', v_finished,
    'duration_ms', (extract(epoch FROM v_finished - v_started) * 1000)::integer,
    'deleted', v_deleted,
    'notes', v_notes,
    'more', v_more,
    'settings', v_settings
  );

  IF NOT p_dry_run THEN
    INSERT INTO app_cron.housekeeping_runs (trigger, actor, status, started_at, finished_at, duration_ms, deleted, notes, more)
    VALUES (p_trigger, left(p_actor, 200), v_result->>'status', v_started, v_finished,
            (v_result->>'duration_ms')::integer, v_deleted, v_notes, v_more);
  END IF;
  RETURN v_result;
END;
$$;

-- ── Status ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_cron.housekeeping_status()
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  v_tables jsonb := '[]'::jsonb;
  v_runs jsonb := '[]'::jsonb;
  v_jobs jsonb := NULL;
  v_stored jsonb := '[]'::jsonb;
  t record;
  v_oid oid;
  v_rows bigint;
  v_dead bigint;
  v_bytes bigint;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      (1,  'cron.job_run_details',             'housekeeping', 'older than housekeeping.cron_history_hours'),
      (2,  'net._http_response',               'housekeeping', 'older than housekeeping.http_response_minutes'),
      (3,  'app_cache.entries',                'housekeeping', 'expired entries (rate limits, idempotency claims, cache)'),
      (4,  'app_auth.sessions',                'housekeeping', 'expired or revoked more than 1 day ago'),
      (5,  'app_auth.tokens',                  'housekeeping', 'expired more than 1 day ago'),
      (6,  'app_auth.flow_states',             'housekeeping', 'expired'),
      (7,  'app_auth.replay_cache',            'housekeeping', 'expired'),
      (8,  'app_cron.housekeeping_runs',       'housekeeping', 'older than 30 days'),
      (9,  'public.workflow_queue',            'cleanup-logs', 'finished jobs older than QUEUE_RETENTION_DAYS (default 7), daily'),
      (10, 'public.agent_queue',               'cleanup-logs', 'finished jobs older than QUEUE_RETENTION_DAYS (default 7), daily'),
      (11, 'public.event_stream',              'cleanup-logs', 'per-workspace event_stream_retention_hours (default 72), daily'),
      (12, 'public.oauth_authorization_codes', 'cleanup-logs', 'expired more than 1 day ago, daily'),
      (13, 'public.oauth_tokens',              'cleanup-logs', 'expired or revoked more than 30 days ago, daily'),
      (14, 'public.instance_provider_switches','kept',         'audit log of provider switches (rollback snapshots); kept')
    ) AS x(ord, rel, purged_by, rule)
    ORDER BY ord
  LOOP
    v_oid := to_regclass(t.rel);
    v_rows := NULL; v_dead := NULL; v_bytes := NULL;
    IF v_oid IS NOT NULL THEN
      SELECT CASE WHEN s.n_live_tup > 0 OR c.reltuples < 0 THEN s.n_live_tup ELSE c.reltuples::bigint END,
             s.n_dead_tup, pg_total_relation_size(v_oid)
        INTO v_rows, v_dead, v_bytes
        FROM pg_class c LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
       WHERE c.oid = v_oid;
    END IF;
    v_tables := v_tables || jsonb_build_array(jsonb_build_object(
      'table', t.rel, 'installed', v_oid IS NOT NULL, 'purged_by', t.purged_by, 'rule', t.rule,
      'rows', v_rows, 'dead_rows', v_dead, 'total_bytes', v_bytes));
  END LOOP;

  SELECT coalesce(jsonb_agg(to_jsonb(r) - 'id' ORDER BY r.started_at DESC), '[]'::jsonb) INTO v_runs
    FROM (SELECT * FROM app_cron.housekeeping_runs ORDER BY started_at DESC LIMIT 10) r;

  IF to_regclass('public.instance_settings') IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('key', key, 'value', value, 'updated_at', updated_at, 'updated_by', updated_by) ORDER BY key), '[]'::jsonb)
      INTO v_stored FROM public.instance_settings WHERE key LIKE 'housekeeping.%' AND NOT secret;
  END IF;

  IF to_regclass('cron.job') IS NOT NULL THEN
    BEGIN
      SELECT coalesce(jsonb_agg(jsonb_build_object('jobname', jobname, 'schedule', schedule, 'active', active) ORDER BY jobname), '[]'::jsonb)
        INTO v_jobs FROM cron.job WHERE jobname IN ('usertasks-housekeeping', 'usertasks-cron-housekeeping');
    EXCEPTION WHEN insufficient_privilege THEN v_jobs := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'settings', app_cron.housekeeping_settings(),
    'stored', v_stored,
    'tables', v_tables,
    'runs', v_runs,
    'pg_cron_jobs', v_jobs,
    'checked_at', now()
  );
END;
$$;

-- ── RPCs (service_role) ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.instance_housekeeping_run(
  p_trigger   text    DEFAULT 'tick',
  p_force     boolean DEFAULT false,
  p_dry_run   boolean DEFAULT false,
  p_actor     text    DEFAULT NULL,
  p_budget_ms integer DEFAULT 20000
)
  RETURNS jsonb
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  SELECT app_cron.run_housekeeping(p_trigger, p_force, p_dry_run, p_actor, least(greatest(p_budget_ms, 1000), 120000));
$$;

CREATE OR REPLACE FUNCTION public.instance_housekeeping_status()
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  SELECT app_cron.housekeeping_status();
$$;

DO $do$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'app_cron.housekeeping_int(jsonb, integer, integer, integer, integer[])',
    'app_cron.housekeeping_settings()',
    'app_cron.housekeeping_purge(text, text, timestamptz, boolean, timestamptz, integer, integer)',
    'app_cron.run_housekeeping(text, boolean, boolean, text, integer, integer)',
    'app_cron.housekeeping_status()',
    'public.instance_housekeeping_run(text, boolean, boolean, text, integer)',
    'public.instance_housekeeping_status()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.instance_housekeeping_run(text, boolean, boolean, text, integer) TO service_role;
  GRANT EXECUTE ON FUNCTION public.instance_housekeeping_status() TO service_role;
END;
$do$;

-- ── pg_cron ─────────────────────────────────────────────────────────────────

DO $do$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed; skipping usertasks-housekeeping (the job registry runs housekeeping)';
    RETURN;
  END IF;
  -- cron.schedule() with an existing name replaces that job in place.
  PERFORM cron.schedule('usertasks-housekeeping', '*/15 * * * *',
    $$select app_cron.run_housekeeping()$$);
  PERFORM cron.schedule('usertasks-cron-housekeeping', '30 3 * * *',
    $$select app_cron.run_housekeeping('pg_cron-daily', true, false, null, 120000, 400)$$);
END;
$do$;

-- ── First pass now ──────────────────────────────────────────────────────────
-- Bounded like any other pass (30 s, 100 batches per table); the scheduled
-- passes take whatever is left.

DO $do$
BEGIN
  RAISE NOTICE 'housekeeping: %', app_cron.run_housekeeping('migration', true, false, '20261109500000', 30000, 100) - 'settings';
END;
$do$;
