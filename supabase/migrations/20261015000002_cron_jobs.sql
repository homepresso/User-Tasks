-- ============================================================================
-- 20261015000002_cron_jobs.sql
--
-- SUPERSEDED by 20261103100000_cron_consolidation.sql, which unschedules
-- every job below (and usertasks-ship-events) and schedules one per-minute
-- usertasks-tick (/api/cron/tick runs the due jobs from lib/jobs/registry.ts)
-- plus a daily pure-SQL usertasks-cron-housekeeping. On a fresh install this
-- file still runs first; do NOT re-run it on its own afterwards: it brings
-- the 13 separate jobs back (re-run 20261103100000 if you did). Cadences
-- below now live in lib/jobs/registry.ts; see docs/self-hosting.md.
--
-- pg_cron schedules for every background worker. Consolidates the archived
-- 20260709_pg_cron_http_jobs.sql, 20260713_github_sync.sql,
-- 20260715_directory_sync.sql and 20260720_oauth_cron.sql (all KEEP
-- features; no retired feature had a cron job).
--
-- Each job calls app_cron.invoke_endpoint (baseline), which POSTs/GETs the
-- app endpoint with `Authorization: Bearer <cron_secret>`.
--
-- REQUIRED ONE-TIME SETUP (not in a migration because it holds secrets):
--   select vault.create_secret('<CRON_SECRET value>', 'cron_secret',
--     'Bearer secret for usertasks cron endpoints');
--   select vault.create_secret('<NEXT_PUBLIC_APP_URL value>', 'app_base_url',
--     'Canonical app URL, reachable from the database');
-- This migration succeeds without them: scheduling does not read Vault. Until
-- the secrets exist each run fails fast with "vault secrets app_base_url /
-- cron_secret are not configured" in cron.job_run_details and does nothing.
-- See docs/self-hosting.md.
--
-- Re-runnable: every usertasks-% job is unscheduled before (re)scheduling, so
-- renamed or removed jobs never linger.
-- ============================================================================

-- pg_cron and pg_net exist on Supabase (and can be installed on self-managed
-- Postgres); elsewhere this file is skipped and scheduling is the scheduler
-- provider's job (SCHEDULER_PROVIDER=worker|external, docs/infrastructure.md).
-- On Supabase the statements inside the guard are the ones this file always
-- ran.
do $cron$
declare
  j record;
begin
  begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_cron / pg_net not available (%); skipping the pg_cron jobs', sqlerrm;
    return;
  end;

  for j in select jobname from cron.job where jobname like 'usertasks-%' loop
    perform cron.unschedule(j.jobname);
  end loop;

  -- ── Every minute: schedule sweep + queue drainers (all claim-based, so
  --    overlapping invocations are safe) ─────────────────────────────────────
  perform cron.schedule('usertasks-process-schedules', '* * * * *',
    $$select app_cron.invoke_endpoint('/api/cron/process-schedules')$$);

  perform cron.schedule('usertasks-process-workflows', '* * * * *',
    $$select app_cron.invoke_endpoint('/api/workflows/process', 'POST', '{"batch_size": 20}'::jsonb)$$);

  perform cron.schedule('usertasks-process-agents', '* * * * *',
    $$select app_cron.invoke_endpoint('/api/agents/process', 'POST', '{"batch_size": 10}'::jsonb)$$);

  perform cron.schedule('usertasks-github-sync-push', '* * * * *',
    $$select app_cron.invoke_endpoint('/api/github-sync/push')$$);

  perform cron.schedule('usertasks-github-sync-deploy', '* * * * *',
    $$select app_cron.invoke_endpoint('/api/github-sync/deployments/process')$$);

  -- ── Every 5 minutes: SLA checks + task notifications ───────────────────────
  perform cron.schedule('usertasks-process-sla', '*/5 * * * *',
    $$select app_cron.invoke_endpoint('/api/cron/process-sla')$$);

  perform cron.schedule('usertasks-process-reminders', '*/5 * * * *',
    $$select app_cron.invoke_endpoint('/api/cron/process-reminders')$$);

  perform cron.schedule('usertasks-process-escalations', '*/5 * * * *',
    $$select app_cron.invoke_endpoint('/api/cron/process-escalations')$$);

  -- ── Every 10 minutes ───────────────────────────────────────────────────────
  perform cron.schedule('usertasks-process-deletions', '*/10 * * * *',
    $$select app_cron.invoke_endpoint('/api/deletions/process', 'POST', '{"batch_size": 10}'::jsonb)$$);

  perform cron.schedule('usertasks-directory-sync', '*/10 * * * *',
    $$select app_cron.invoke_endpoint('/api/directory-sync/process')$$);

  perform cron.schedule('usertasks-oauth-refresh', '*/10 * * * *',
    $$select app_cron.invoke_endpoint('/api/connectors/oauth/refresh')$$);

  -- ── Daily (UTC): retention pass, then log + OAuth row cleanup ──────────────
  perform cron.schedule('usertasks-process-retention', '0 3 * * *',
    $$select app_cron.invoke_endpoint('/api/cron/process-retention-policies')$$);

  -- cleanup-logs exposes GET only.
  perform cron.schedule('usertasks-cleanup-logs', '0 4 * * *',
    $$select app_cron.invoke_endpoint('/api/cron/cleanup-logs', 'GET')$$);
end $cron$;
