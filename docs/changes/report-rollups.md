# Release notes: Report rollups and Settings → Query

Report metrics now read flat per-day tables kept current as things happen,
instead of aggregating every run on each load — and workspace admins choose,
per service, flat tables or real-time queries.

## New

- **Report rollups.** Per-day totals per workspace × workflow (runs started
  by status, durations, node visits; runs completed on time / late against
  their SLA, cycle time), per node, per form, and per workflow × team ×
  assignee for tasks (created by status; completed on time / late, time to
  complete). They are updated **in the same database transaction** as the
  change — a run starting, moving on, completing or failing, a task created,
  reassigned or completed, a form submitted — as a difference (new minus
  old), so a status change counts once and a retry adds nothing. Today is
  included; any period is exact (partial days at the edges are read from the
  raw rows); medians and percentiles are within 9.1%.
- **Faster reads.** The reports hub, process overview, compare page, app
  widgets (metric, KPI, goal, gauge, chart, pivot, throughput, submission
  trend, cycle time, SLA trend), extension pages' `ctx.workflows.stats` /
  `ctx.forms.submissionStats` and the API / MCP run analytics use them. Same
  response shapes. Widgets on rollups are complete (no 5,000-row cap).
- **Settings → Query.** Workspace default → service → app → widget (the
  widget level when the workspace allows it: App builder → widget settings →
  **Data source**), each **Auto** (flat tables when populated and current),
  **Flat table** or **Real time**; a cache TTL per service (default 20 s, 0 =
  off); per service the effective mode, what reads use now and recent median
  read times on each path; the workspace's coverage with **Run backfill**,
  **Reconcile now** and **Rebuild rollups**. Changes need *Edit settings* and
  are audited. `GET` / `PATCH /api/v1/settings/query`,
  `POST /api/v1/settings/query/rollups`; MCP `query_settings_get` /
  `_update`, `query_rollups_run`; `usertasks query-settings`.
- **Cloud edition: one instance-wide configuration.** On `DEPLOYMENT_MODE=cloud`,
  Settings → Query applies to every workspace and only instance admins
  (`INSTANCE_ADMIN_EMAILS` / `instance.admin_emails`) can see or change it
  (404 for everyone else, workspace owners included); workspace settings are
  ignored, per-app / per-widget overrides only when the instance admin
  allows them, and rollup actions can target all workspaces or one.
  Self-hosted is unchanged (per workspace, *Edit settings*). No migration
  (stored in the instance settings as `instance.query_settings`).
- **Permissions unchanged.** Totals are narrowed to what the viewer may see
  before they are summed (every workflow with *View all runs*; only granted
  workflows with *View queue*; own and team tasks without *View all tasks*;
  all submissions with *Edit forms*). Viewers whose run access is per run
  (runs they are involved in) read real time. Row-level security on the
  rollup tables enforces the same.
- **Operations.** The scheduler's `report-rollups` job (every minute,
  skipped when idle; all schedulers) backfills history per workspace from
  today backwards (resumable), rebuilds queued day ranges and reconciles
  today + yesterday hourly. `usertasks-admin rollups status | backfill |
  rebuild | reconcile`; `usertasks-admin doctor` and Settings →
  Infrastructure show coverage, queued rebuilds and reconcile freshness.
  `REPORT_ROLLUPS=off` makes every read real time.

## Performance

`scripts/bench-report-rollups.mjs`, local Supabase stack (PostgreSQL 17,
laptop), 200,000 runs, 50,000 tasks, 20,000 submissions over 180 days, both
sides serialised to JSON in the database, medians of 5:

| Read | Real time | Flat tables |
|------|-----------|-------------|
| Reports hub, 180 days, every workflow | 1,280 ms | 52 ms (×25) |
| Compare page node visits, 2 workflows | 93 ms | 1.2 ms (×80) |
| Duration stats with p50 / p95, 90 days | 84 ms | 32 ms (×2.6) |
| Extension run stats, 10 workflows, 30 days | 281 ms | 152 ms (×1.9) |
| Widget: runs per day × status, rolling 90 days | 118 ms | 39 ms (×3) |
| Widget: tasks created per day, 90 days | 11 ms | 2.4 ms (×4.7) |
| Widget: submissions per day, 90 days | 3.7 ms | 1.4 ms (×2.6) |
| Widget: task cycle time p50 / p90, 90 days | 7.9 ms | 16.8 ms (×0.5) |

Writes (each statement in its own transaction): starting a run 0.64 → 1.10 ms
(+0.46 ms median), completing a run with a 12-entry trace 0.65 → 1.50 ms
(+0.85 ms median). The initial backfill of that history took 15 s.

Small, simple aggregates (a few thousand tasks) were already fast in real
time; a service can be set to Real time.

## For operators

- Migration `20270123100000_report_rollups.sql`: additive; apply before or
  after the code (until it is applied, everything reads real time). It adds
  three indexes; on large tables create them `CONCURRENTLY` first (see
  [Query settings](../query-settings.md#large-installs)).
- Plain SQL, verified on Supabase (PostgreSQL 17) and plain PostgreSQL 16
  (`usertasks-admin db migrate`); no extensions, no pg_cron dependency,
  transaction-mode PgBouncer safe.
- The first backfill runs in the scheduler (a month of history per step, per
  workspace); `usertasks-admin rollups backfill` runs it now.
