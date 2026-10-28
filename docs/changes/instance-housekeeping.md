# Release notes: instance housekeeping

System tables that grow on their own are now purged little and often, by
default, with settings an instance admin can change in the CLI or on
Settings → Infrastructure. See
[Infrastructure: Housekeeping](../infrastructure.md#housekeeping).

Why: production's `cron.job_run_details` reached 138 MB for about 18,000
rows. Every pg_cron run inserts into it, the daily purge (rows older than
2 days) let a day of dead rows pile up between runs, and the table belongs
to `supabase_admin`, so we can't `VACUUM FULL` it. Each insert had slowed to
~0.25 s, adding to the memory and connection stalls on the database.

## Added

- **Housekeeping pass** (`app_cron.run_housekeeping()`, migration
  `20261109500000_instance_housekeeping.sql`): deletes `cron.job_run_details`
  rows older than 1 day, `net._http_response` rows older than 1 hour, and
  expired rows of the cache store (`app_cache.entries`: rate limits,
  idempotency claims) and built-in auth (`app_auth.sessions`, `tokens`,
  `flow_states`, `replay_cache`). At most 5,000 rows per statement, each in
  its own subtransaction with `lock_timeout = 2s`, stopping at a time budget
  and continuing next pass. Tables that aren't installed (no pg_cron, pg_net,
  …) or that the role may not delete from are reported, not failed. Every
  pass is logged in `app_cron.housekeeping_runs` (30 days).
- **Settings** (`housekeeping.*` instance settings, defaults in brackets):
  `enabled` (true), `interval_minutes` (60; 15 … 1440),
  `cron_history_hours` (24; 1 hour – 90 days), `http_response_minutes`
  (60; 5 minutes – 7 days). Invalid stored values fall back to the default.
- **Every scheduler.** pg_cron: `usertasks-housekeeping` every 15 minutes
  (runs when the interval is due) and `usertasks-cron-housekeeping`, now the
  daily forced pass with a larger budget. Worker / external: the job
  registry's `housekeeping` (every 15 min) and `housekeeping-daily` (03:30
  UTC), which call the same function; `/api/cron/housekeeping` runs a pass
  on demand.
- **`usertasks-admin housekeeping show | set <setting> <value|default> | run
  [--dry-run]`**; `run` reports rows deleted per table. `status` prints a
  housekeeping line, and `status` / `doctor` warn about a late or disabled
  pass and about large or bloated purged tables (with the hint that a
  Supabase-owned table needs `VACUUM FULL` by its owner — Supabase support).
- **Settings → Infrastructure → Housekeeping** (instance admins): the
  settings with validation, each table's size and row estimate, recent
  passes, *Run now* and *Dry run*. Saving and running are server actions that
  re-check instance-admin access; a workspace owner is refused.

## Changed

- `usertasks-cron-housekeeping` keeps its name and 03:30 UTC slot but now
  runs `app_cron.run_housekeeping('pg_cron-daily', …)`; the old
  `app_cron.housekeeping(interval, interval)` stays for compatibility and is
  no longer scheduled. pg_cron run history is kept 1 day instead of 2.
- `npm run scheduler -- install-pg-cron` / `switch scheduler --to pg_cron`
  install three jobs and require the new migration.

## Not changed

Tenant data: queue history, the `event_stream` outbox and OAuth rows stay
with the daily `cleanup-logs` job and per-workspace retention; workspace
content with Retention Policies. The provider switch log is kept.

## Deploying

Apply `20261109500000_instance_housekeeping.sql` (it adds objects, schedules
the pg_cron job and runs one bounded pass — seconds on production). The app
and the migration can go in either order: before the app update the new
pg_cron job already purges; before the migration the registry jobs and the
Infrastructure card report "not installed". The disk space
`cron.job_run_details` already holds is only returned by `VACUUM FULL` by
`supabase_admin` (Supabase support); housekeeping keeps it from growing.
