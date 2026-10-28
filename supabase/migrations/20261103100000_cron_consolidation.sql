-- ============================================================================
-- 20261103100000_cron_consolidation.sql
--
-- One scheduler tick instead of 14 pg_cron jobs.
--
-- Before: 20261015000002_cron_jobs.sql + 20261024000003_log_shipper.sql
-- scheduled 14 `usertasks-*` jobs (~7 runs a minute). With
-- cron.use_background_workers = off every run opens a new database
-- connection, and cron.job_run_details was never purged. On a small instance
-- memory crept up until runs failed with "job startup timeout" and the
-- database refused connections.
--
-- After: two jobs.
--   usertasks-tick                 * * * * *   POST /api/cron/tick; the app runs
--                                              every job that is due in that
--                                              minute in-process (lib/jobs/registry.ts)
--   usertasks-cron-housekeeping    30 3 * * *  pure SQL, app_cron.housekeeping():
--                                              job_run_details > 2 days,
--                                              net._http_response > 1 hour
--
-- Also adds the tick's support objects:
--   app_cron.tick_lock   singleton lease so overlapping ticks skip
--   app_cron.tick_runs   last start/finish/status per job (daily catch-up)
--   public.cron_tick_acquire / cron_tick_release / cron_tick_record /
--   cron_tick_probe       service_role-only RPCs used by lib/jobs/tick.ts
-- and purges cron.job_run_details older than 2 days once, in batches.
--
-- Idempotent. Works without pg_cron (scheduling and purges are skipped with a
-- NOTICE) and before the Vault secrets exist (scheduling never reads Vault).
-- Re-running 20261015000002_cron_jobs.sql would bring the 14 old jobs back;
-- re-run this migration afterwards.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS app_cron;
REVOKE ALL ON SCHEMA app_cron FROM PUBLIC, anon, authenticated;

-- ── Tick lease + history ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_cron.tick_lock (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  holder       text,
  acquired_at  timestamptz,
  locked_until timestamptz NOT NULL DEFAULT '-infinity'
);

CREATE TABLE IF NOT EXISTS app_cron.tick_runs (
  job_name         text PRIMARY KEY,
  last_started_at  timestamptz,
  last_finished_at timestamptz,
  last_status      text,
  last_error       text,
  last_duration_ms integer,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON app_cron.tick_lock, app_cron.tick_runs FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE app_cron.tick_lock IS
  'Lease held by the running /api/cron/tick (one row). Expires on its own, so a crashed tick never blocks the next.';
COMMENT ON TABLE app_cron.tick_runs IS
  'Last run of each scheduler job (lib/jobs/registry.ts), written by /api/cron/tick.';

-- Takes the lease when it is free or expired. Returns
-- {"acquired": bool, "last_started": {"<job>": "<timestamptz>", ...}}.
CREATE OR REPLACE FUNCTION public.cron_tick_acquire(p_holder text, p_ttl_seconds integer DEFAULT 55)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'app_cron', 'pg_catalog'
AS $$
DECLARE
  v_acquired boolean := false;
BEGIN
  INSERT INTO app_cron.tick_lock AS l (id, holder, acquired_at, locked_until)
  VALUES (true, p_holder, now(), now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 55), 1)))
  ON CONFLICT (id) DO UPDATE
    SET holder = excluded.holder, acquired_at = excluded.acquired_at, locked_until = excluded.locked_until
    WHERE l.locked_until < now()
  RETURNING true INTO v_acquired;

  IF NOT coalesce(v_acquired, false) THEN
    RETURN jsonb_build_object('acquired', false);
  END IF;
  RETURN jsonb_build_object(
    'acquired', true,
    'last_started', coalesce((SELECT jsonb_object_agg(job_name, last_started_at) FROM app_cron.tick_runs), '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cron_tick_release(p_holder text)
  RETURNS void
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'app_cron', 'pg_catalog'
AS $$
  UPDATE app_cron.tick_lock SET locked_until = '-infinity' WHERE id AND holder = p_holder;
$$;

-- p_runs: [{"job_name", "last_started_at", "last_finished_at"?, "last_status"?,
-- "last_error"?, "last_duration_ms"?}]. Keys left out keep their stored value.
CREATE OR REPLACE FUNCTION public.cron_tick_record(p_runs jsonb)
  RETURNS void
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'app_cron', 'pg_catalog'
AS $$
  INSERT INTO app_cron.tick_runs AS r (job_name, last_started_at, last_finished_at, last_status, last_error, last_duration_ms, updated_at)
  SELECT x->>'job_name',
         (x->>'last_started_at')::timestamptz,
         (x->>'last_finished_at')::timestamptz,
         x->>'last_status',
         x->>'last_error',
         (x->>'last_duration_ms')::integer,
         now()
    FROM jsonb_array_elements(coalesce(p_runs, '[]'::jsonb)) AS x
   WHERE coalesce(x->>'job_name', '') <> ''
  ON CONFLICT (job_name) DO UPDATE SET
    last_started_at  = coalesce(excluded.last_started_at, r.last_started_at),
    last_finished_at = coalesce(excluded.last_finished_at, r.last_finished_at),
    last_status      = coalesce(excluded.last_status, r.last_status),
    last_error       = CASE WHEN excluded.last_status IS NOT NULL THEN excluded.last_error ELSE r.last_error END,
    last_duration_ms = coalesce(excluded.last_duration_ms, r.last_duration_ms),
    updated_at       = now();
$$;

-- One query answering every job's isEnabled (lib/jobs/registry.ts): is there
-- work, or is the feature configured at all? A check whose table or column is
-- missing reports true (unknown = run the job, as before).
CREATE OR REPLACE FUNCTION public.cron_tick_probe()
  RETURNS jsonb
  LANGUAGE plpgsql STABLE
  SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  r jsonb := '{}'::jsonb;
  v boolean;
BEGIN
  BEGIN
    v := EXISTS (SELECT 1 FROM workflows WHERE trigger_type = 'schedule' AND is_active);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('schedules', v);

  -- Same predicate as claim_jobs (uses idx_queue_claim).
  BEGIN
    v := EXISTS (SELECT 1 FROM workflow_queue q
                  WHERE (q.status = 'pending' AND q.scheduled_for <= now())
                     OR (q.status = 'failed' AND q.attempts < q.max_attempts AND q.next_retry_at <= now()));
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('workflow_queue', v);

  -- 'processing' too: the agent worker resets jobs abandoned mid-run.
  BEGIN
    v := EXISTS (SELECT 1 FROM agent_queue
                  WHERE (status = 'pending' AND scheduled_for <= now()) OR status = 'processing');
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('agent_queue', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM tenant_connectors WHERE connector_key = 'github_sync' AND is_enabled)
      OR EXISTS (SELECT 1 FROM github_sync_runs WHERE status IN ('pending', 'running'));
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('github_sync', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM github_deployments WHERE status IN ('pending', 'running'));
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('github_deployments', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM log_destinations WHERE enabled);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('log_destinations', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM workflow_runs
                  WHERE status IN ('running', 'paused', 'waiting_for_event') AND sla_due_at IS NOT NULL);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('sla', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM task_reminders WHERE NOT is_sent);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('reminders', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM task_escalations WHERE NOT is_escalated);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('escalations', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM deletion_queue WHERE status = 'pending');
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('deletions', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM tenant_connectors
                  WHERE connector_key IN ('entra_directory', 'okta_directory') AND is_enabled)
      OR EXISTS (SELECT 1 FROM directory_sync_runs WHERE status IN ('pending', 'running'));
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('directory_sync', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM tenant_connectors WHERE is_enabled AND (config->>'expires_at') IS NOT NULL);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('oauth_connectors', v);

  RETURN r;
END;
$$;

DO $do$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.cron_tick_acquire(text, integer)',
    'public.cron_tick_release(text)',
    'public.cron_tick_record(jsonb)',
    'public.cron_tick_probe()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$do$;

-- ── Housekeeping (pure SQL, no HTTP) ────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_cron.housekeeping(
  p_run_details_keep interval DEFAULT interval '2 days',
  p_http_responses_keep interval DEFAULT interval '1 hour'
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_runs bigint := 0;
  v_http bigint := 0;
  v_batch bigint;
BEGIN
  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    BEGIN
      LOOP
        DELETE FROM cron.job_run_details
         WHERE runid IN (SELECT runid FROM cron.job_run_details
                          WHERE coalesce(end_time, start_time) < now() - p_run_details_keep
                          LIMIT 20000);
        GET DIAGNOSTICS v_batch = ROW_COUNT;
        v_runs := v_runs + v_batch;
        EXIT WHEN v_batch < 20000;
      END LOOP;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'housekeeping: no privilege on cron.job_run_details';
    END;
  END IF;

  IF to_regclass('net._http_response') IS NOT NULL THEN
    BEGIN
      DELETE FROM net._http_response WHERE created < now() - p_http_responses_keep;
      GET DIAGNOSTICS v_http = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege OR undefined_column THEN
      RAISE NOTICE 'housekeeping: could not purge net._http_response';
    END;
  END IF;

  RETURN jsonb_build_object('job_run_details', v_runs, 'http_responses', v_http);
END;
$$;

REVOKE ALL ON FUNCTION app_cron.housekeeping(interval, interval) FROM PUBLIC, anon, authenticated;

-- ── pg_cron: replace every usertasks-* job with the tick + housekeeping ────

DO $do$
DECLARE
  j record;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed; skipping usertasks-tick and usertasks-cron-housekeeping';
    RETURN;
  END IF;

  FOR j IN SELECT jobname FROM cron.job WHERE jobname LIKE 'usertasks-%' LOOP
    PERFORM cron.unschedule(j.jobname);
  END LOOP;

  -- The minute is passed explicitly so a request that arrives a few seconds
  -- late still runs that minute's jobs. 55 s pg_net timeout: the tick returns
  -- within ~50 s.
  PERFORM cron.schedule('usertasks-tick', '* * * * *',
    $$select app_cron.invoke_endpoint('/api/cron/tick', 'POST', jsonb_build_object('minute', date_trunc('minute', now())), 55000)$$);

  PERFORM cron.schedule('usertasks-cron-housekeeping', '30 3 * * *',
    $$select app_cron.housekeeping()$$);
END;
$do$;

-- ── One-off purge of the accumulated run history ────────────────────────────
-- Production held ~589k rows (138 MB) since July. Batched delete, oldest rows
-- first, so each statement stays small.

DO $do$
DECLARE
  v_result jsonb;
BEGIN
  IF to_regclass('cron.job_run_details') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed; nothing to purge';
    RETURN;
  END IF;
  v_result := app_cron.housekeeping(interval '2 days', interval '1 hour');
  RAISE NOTICE 'purged %', v_result;
END;
$do$;
