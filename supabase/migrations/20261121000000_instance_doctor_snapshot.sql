-- ============================================================================
-- 20261121000000_instance_doctor_snapshot.sql
--
-- public.instance_doctor_snapshot(p_scheduler_lock_key bigint): what
-- `usertasks-admin doctor` and Settings → Infrastructure check in the
-- database, in one read, for deployments without a direct connection
-- (Supabase database provider, no DATABASE_URL — Vercel and the like). The
-- same facts the doctor reads over DATABASE_URL otherwise:
--
--   server version, database name, the RLS roles present, extensions,
--   auth.uid(), the newest applied migration, the supabase_realtime
--   publication's table count, the SSE NOTIFY function, the usertasks-*
--   pg_cron jobs (name, schedule, active — never the command) and whether
--   the two Vault secrets exist (never their values), the scheduler leader
--   lock holder, the last tick and failing jobs, and how many instance
--   settings are stored encrypted.
--
-- SECURITY DEFINER (the migration owner: postgres on Supabase) so it can see
-- cron.job / vault.secrets; read only; every optional schema (cron, vault,
-- app_cron, app_realtime, supabase_migrations) is probed first, so it runs on
-- plain PostgreSQL too. EXECUTE for service_role only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.instance_doctor_snapshot(p_scheduler_lock_key bigint DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  r jsonb;
  v_text text;
  v_json jsonb;
  v_int integer;
  v_ts timestamptz;
BEGIN
  r := jsonb_build_object(
    'version_num', current_setting('server_version_num')::int,
    'database', current_database(),
    'roles', coalesce((SELECT jsonb_agg(rolname ORDER BY rolname) FROM pg_roles
                        WHERE rolname IN ('anon', 'authenticated', 'service_role')), '[]'::jsonb),
    'extensions', coalesce((SELECT jsonb_agg(extname ORDER BY extname) FROM pg_extension), '[]'::jsonb),
    'auth_uid', to_regprocedure('auth.uid()') IS NOT NULL,
    'notify_triggers', to_regprocedure('app_realtime.notify_changes()') IS NOT NULL,
    'checked_at', now()
  );

  v_text := NULL;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT max(version)::text FROM supabase_migrations.schema_migrations' INTO v_text;
  END IF;
  r := r || jsonb_build_object('latest_migration', v_text);

  -- null: no supabase_realtime publication at all (plain PostgreSQL).
  r := r || jsonb_build_object('publication_tables', CASE
    WHEN EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
      THEN (SELECT count(*)::int FROM pg_publication_tables WHERE pubname = 'supabase_realtime')
  END);

  -- pg_cron: the usertasks-* jobs (no commands).
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT coalesce(jsonb_agg(jsonb_build_object('jobname', jobname, 'schedule', schedule, 'active', active) ORDER BY jobname), '[]'::jsonb)
                 FROM cron.job WHERE jobname LIKE 'usertasks-%'$q$ INTO v_json;
    r := r || jsonb_build_object('pg_cron', jsonb_build_object('installed', true, 'jobs', v_json));
  ELSE
    r := r || jsonb_build_object('pg_cron', jsonb_build_object('installed', false, 'jobs', '[]'::jsonb));
  END IF;

  -- Vault: whether the two secrets app_cron.invoke_endpoint reads exist (never their values).
  IF to_regclass('vault.secrets') IS NOT NULL THEN
    EXECUTE $q$SELECT jsonb_build_object(
                 'app_base_url', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'app_base_url'),
                 'cron_secret', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret'))$q$ INTO v_json;
    r := r || jsonb_build_object('vault', v_json);
  ELSE
    r := r || jsonb_build_object('vault', NULL);
  END IF;

  -- Scheduler leader (worker provider): who holds the advisory lock.
  v_int := NULL;
  IF p_scheduler_lock_key IS NOT NULL THEN
    SELECT pid INTO v_int FROM pg_locks
     WHERE locktype = 'advisory' AND granted AND objsubid = 1
       AND ((classid::bigint << 32) | objid::bigint) = p_scheduler_lock_key
     LIMIT 1;
  END IF;
  r := r || jsonb_build_object('leader_pid', v_int);

  -- Tick lease and failing jobs.
  v_ts := NULL;
  v_text := NULL;
  IF to_regclass('app_cron.tick_lock') IS NOT NULL THEN
    EXECUTE 'SELECT acquired_at FROM app_cron.tick_lock LIMIT 1' INTO v_ts;
  END IF;
  IF to_regclass('app_cron.tick_runs') IS NOT NULL THEN
    EXECUTE $q$SELECT string_agg(job_name, ', ' ORDER BY job_name) FROM app_cron.tick_runs WHERE last_status = 'error'$q$ INTO v_text;
  END IF;
  r := r || jsonb_build_object('tick_acquired_at', v_ts, 'failing_jobs', v_text);

  v_int := 0;
  IF to_regclass('public.instance_settings') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::int FROM public.instance_settings WHERE secret' INTO v_int;
  END IF;
  r := r || jsonb_build_object('secret_settings', v_int);

  RETURN r;
END;
$$;

COMMENT ON FUNCTION public.instance_doctor_snapshot(bigint) IS
  'Doctor / Settings → Infrastructure database facts without a direct connection (service role only; no secret values).';

REVOKE ALL ON FUNCTION public.instance_doctor_snapshot(bigint) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.instance_doctor_snapshot(bigint) FROM anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.instance_doctor_snapshot(bigint) TO service_role';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
