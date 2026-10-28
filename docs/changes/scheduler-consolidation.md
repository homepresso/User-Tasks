# Release notes: one scheduler tick

Background jobs now run from a single pg_cron job instead of 14. Nothing
changes for users; this is an operations fix.

## Why

Each pg_cron run opened its own database connection (with
`cron.use_background_workers = off`), about 7 a minute across the 14 jobs, and
`cron.job_run_details` was never purged (on production: 589k rows, 138 MB,
72% of the database). On a small instance memory crept up over about 11
hours until 44% of runs failed with "job startup timeout" and the database
refused connections.

## Changed

- **One job, `usertasks-tick`**, calls `POST /api/cron/tick` every minute.
  The app works out which jobs are due in that minute (UTC) and runs them
  in-process, up to `CRON_TICK_CONCURRENCY` (default 4) at a time, within
  about 50 s. Cadences are unchanged:

  | Cadence | Jobs |
  |---------|------|
  | Every minute | process-schedules, process-workflows, process-agents, github-sync-push, github-sync-deploy, ship-events |
  | Every 5 min | process-sla, process-reminders, process-escalations |
  | Every 10 min | process-deletions, directory-sync, oauth-refresh |
  | Daily (UTC) | process-retention 03:00, cleanup-logs 04:00 |

  The list lives in `lib/jobs/registry.ts`.
- **Idle jobs are skipped.** One query per tick (`cron_tick_probe()`) checks
  whether each job has anything to do: an empty queue, no GitHub sync or
  directory connection, no OAuth connector tokens, no enabled log
  destination, no active schedule or SLA. Skipped jobs cost nothing else.
- **No overlap.** A tick holds a lease (`app_cron.tick_lock`, 55 s). If the
  previous tick is still running, the next one skips its minute. A daily job
  whose minute was skipped runs on a later tick that day (within 6 hours).
  Each job has its own time budget; a job that overruns is reported as
  `timeout` and finishes in the background (all jobs claim their work, so
  nothing runs twice).
- **History.** `app_cron.tick_runs` keeps each job's last start, finish,
  status, duration and error.
- **Housekeeping.** `usertasks-cron-housekeeping` (daily 03:30 UTC, pure SQL,
  no HTTP) deletes `cron.job_run_details` older than 2 days and
  `net._http_response` older than 1 hour. The migration also purges the
  existing backlog once.
- **Endpoints unchanged.** `/api/cron/process-schedules`,
  `/api/workflows/process`, `/api/cron/ship-events` and the rest still work
  on their own for external schedulers, in-app kicks and manual runs. Their
  logic moved to `lib/jobs/*` so the tick and the endpoints share it.
  `/api/cron/process-agents` now runs the agent queue directly instead of
  forwarding to `/api/agents/process` over HTTP.

## Expected effect

pg_cron runs drop from about 7 to 1 a minute (one new connection per minute
instead of ~7), plus one daily housekeeping run. `cron.job_run_details`
stays at about 3,000 rows (two days of ticks).

## Upgrade

1. Deploy the app version with `/api/cron/tick`.
2. Apply `supabase/migrations/20261103100000_cron_consolidation.sql`
   (`npx supabase db push`, or run it in the SQL editor). It is idempotent.
3. Check: `select jobname, schedule from cron.job where jobname like
   'usertasks-%';` shows two rows, and after a minute
   `select * from app_cron.tick_runs;` shows runs.

Applying the migration before the deploy stops all background jobs until the
deploy lands (the tick gets a 404). Rollback: re-run
`20261015000002_cron_jobs.sql` and the last block of
`20261024000003_log_shipper.sql`.

New optional environment variable: `CRON_TICK_CONCURRENCY` (default 4).
