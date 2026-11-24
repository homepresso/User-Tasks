# Query settings and report rollups

Report metrics — the reports hub and workflow reports, app dashboard
widgets, extension pages' run and submission stats, and the run analytics
of the API and MCP — can come from two places:

- **Flat tables (report rollups):** per-day totals per workspace ×
  workflow, form, and team / assignee, kept current **as things happen**:
  when a run starts, moves on, completes or fails, when a task is created,
  reassigned or completed, and when a form is submitted, the same database
  transaction adds the change to the day's totals. A 180-day reports hub
  reads a few thousand small rows instead of every run.
- **Real time:** aggregating the raw runs, tasks and submissions on each
  load, as before.

Both give the same numbers (see [Accuracy](#accuracy)) and apply the same
permissions. **Settings → Query** chooses, per service, which one is used.

## Settings → Query

**Self-hosted** (and any edition other than cloud): settings are per
workspace. Workspace admins (*Edit settings*) change them; *View settings*
can see them. Every change is audited in the workspace.

**Cloud edition** (`DEPLOYMENT_MODE=cloud`): **one configuration for every
workspace** on the instance — the page says "Applies to every workspace on
this cloud instance". Only **instance admins** (`INSTANCE_ADMIN_EMAILS` /
`usertasks-admin instance-admins add`, the Settings → Infrastructure gate,
verified email) can open the page or call the endpoints; everyone else,
workspace owners included, gets a 404 and doesn't see it in Settings.
Workspace-level settings are ignored. The configuration is stored in the
instance settings (`instance.query_settings`). Per-app and per-widget
overrides apply only while the instance admin allows them ("Allow per-app
and per-widget data sources"); otherwise the widget's Data source control is
hidden in the app builder and stored widget choices are ignored. Rollup
actions can target **all workspaces** or one chosen workspace. Changes are
recorded on the instance setting (who changed it), in the acting admin's
workspace audit log (scope `instance`) and in the server log.

| Level | Where | Inherits from |
|-------|-------|---------------|
| Workspace default | Settings → Query | — (default **Auto**) |
| Service | Settings → Query → Services | the workspace default |
| App | Settings → Query → Apps | App widgets |
| Widget | App builder → widget settings → **Data source** (shown only when the workspace allows per-widget overrides) | the app |

| Mode | What reads do |
|------|---------------|
| **Auto** (default) | Flat tables when they cover the period and nothing is queued for the workspace; otherwise real time |
| **Flat table** | Flat tables whenever they cover the period |
| **Real time** | Always the raw rows |

Real time is always the fallback: when the flat tables can't answer — not
installed yet, the workspace not backfilled that far back, or
`REPORT_ROLLUPS=off` on the instance — the read is made in real time.

| Service | Flat tables? |
|---------|--------------|
| Reports hub and workflow reports | yes (daily stats, duration stats, compare page node visits) |
| App widgets | yes: metric, KPI, goal, gauge, chart and pivot (grouped by time, status, workflow, form or assignee), throughput, submission trend, cycle time, SLA trend |
| Extension pages stats (`ctx.workflows.stats`) | yes |
| Form submission stats (`ctx.forms.submissionStats`) | yes |
| API and MCP report endpoints | yes |
| Report charts (saved reports) | real time only: they filter and group by any column |
| Home stats | real time only: your own work, in your time zone, already a quick query |
| Task SLA and workload | real time only: what is open right now |

Each service also has a **cache** (seconds, 0 = off; default 20): identical
reads within that time share one result. The cache is per workspace and per
viewer scope — two people share a cached result only when they may see
exactly the same rows — and lives in the cache provider (memory, PostgreSQL
or Redis; see [Infrastructure: Cache](infrastructure.md#cache)), so replicas
share it with a shared store.

The page also shows, per service, what reads use right now and the median
read time on each path (reads this server answered since it started), the
workspace's coverage (backfill progress, queued rebuilds, last rebuild and
reconcile), and **Run backfill**, **Reconcile now** and **Rebuild rollups**.

API: `GET` / `PATCH /api/v1/settings/query`, `POST /api/v1/settings/query/rollups`
(`{ "action": "backfill" | "rebuild" | "reconcile", "tenant_id": "<workspace id>" | "all" }` —
`tenant_id` on the cloud edition only). MCP:
`query_settings_get`, `query_settings_update`, `query_rollups_run`. CLI:
`usertasks query-settings get | update | rollups`.

```json title="PATCH /api/v1/settings/query"
{
  "default_mode": "auto",
  "allow_widget_override": true,
  "services": { "app_widgets": { "mode": "rollup", "cache_ttl_seconds": 30 }, "api_reports": { "mode": "live" } },
  "apps": { "3f2504e0-4f89-41d3-9a0c-0305e82c3301": "live" }
}
```

## Permissions

Flat tables hold totals for a whole workspace, so every read first narrows
them to what the viewer may see, exactly as the real-time path does:

- **Runs:** *View all runs* (`workflows.view_runs`) sees every workflow.
  *View queue* with View grants on some workflows sees those workflows only
  — the totals of other workflows are never read. When a person's scope
  includes runs they are merely involved in (they started it, their form
  started it, a task of theirs is in it), that is per run, not per
  workflow: their reads use real time.
- **Tasks:** *View all tasks*, or the tasks assigned to them and queued for
  their teams (the flat tables are kept per assignee and team).
- **Submissions:** *Edit forms* sees all; people who only see their own
  submissions read real time.

Row-level security on the rollup tables allows the same: run totals with
`workflows.view_runs`, submission totals with `forms.edit`, task totals
with `tasks.view_all` or for the caller's own and team rows. Nobody writes
them except the database itself.

## Accuracy

- **Counts, sums and averages are exact**, today included.
- **Any period is exact**: whole UTC days come from the flat tables; a
  period that starts or ends inside a day (a rolling "last 7 days", a page
  that ends an hour ago) aggregates those partial days from the raw rows.
- **Medians and percentiles** (p50 / p90 / p95 durations, cycle time) come
  from a duration histogram (four buckets per doubling) and are **within
  9.1%** of the exact value. Durations under 1 ms show as 0.
- **Days are UTC**, as the reports were before. A viewer's own time zone
  only matters where a page groups by day: those groups are UTC days.
  Home → My activity, which uses your time zone, stays real time.
- The compare page's node visits count every run in the period (the
  real-time path counted the newest 5,000).
- Widgets on flat tables are never truncated (the real-time path counts at
  most 5,000 rows).

## How the flat tables stay correct

- **In the same transaction:** triggers on `workflow_runs`, `tasks` and
  `form_submissions` turn each change into a difference (new minus old) and
  add it to the affected day's row. A status change counts once (the old
  status is subtracted, the new one added); a retry that writes the same
  values adds nothing. Appended trace entries are counted from the old
  length on. Busy workflow-days are spread over 4 rows per day to avoid
  contention. Measured cost: see [Performance](#performance).
- **Reconcile (hourly per workspace):** today and yesterday are rebuilt
  from the raw rows — a safety net that also merges the day's 4 rows.
- **Queued rebuilds:** `usertasks-admin rollups rebuild --from --to` (or a
  bulk load run with `SET usertasks.report_rollups = 'defer'`) queues days
  that the scheduler rebuilds.
- **Backfill:** history is built per workspace from today backwards, a
  month at a time. It resumes where it stopped; until a workspace is
  covered far enough back, reads of older periods use real time.

All of this runs in the scheduler's `report-rollups` job (every minute,
skipped when there is nothing to do) on every scheduler: `pg_cron`, the
built-in worker and an external scheduler (`/api/cron/report-rollups`).

### Admin CLI

```bash
usertasks-admin rollups status [--json]
usertasks-admin rollups backfill [--tenant <workspace id>] [--max-seconds 600]
usertasks-admin rollups rebuild --tenant <workspace id> [--from 2026-10-01 --to 2026-10-31]
usertasks-admin rollups reconcile [--tenant <workspace id>]
```

`usertasks-admin doctor` reports backfill progress, queued rebuilds and
reconcile freshness under Scheduler. Settings → Infrastructure shows the
same for every workspace.

### Databases

Plain SQL only, on every database UserTasks supports — Supabase, PostgreSQL
14+ self-hosted, in Docker or Kubernetes, air-gapped, and managed
PostgreSQL (RDS / Aurora, Azure Database for PostgreSQL, Cloud SQL /
AlloyDB, Neon). No extensions beyond the existing requirements and no
pg_cron dependency. Transaction-mode PgBouncer is fine: the triggers'
advisory locks are transaction-scoped, there is no session state (the
`usertasks.report_rollups` switch is for `SET LOCAL` in bulk jobs) and no
LISTEN.

### Large installs

The migration adds three indexes (`workflow_runs (tenant_id, completed_at)`,
`tasks (tenant_id, completed_at)`, `form_submissions (tenant_id,
created_at)`). On large tables, create them first with
`CREATE INDEX CONCURRENTLY` (same names) so the migration doesn't block
writes while it builds them. A bulk statement touching runs of many days
holds one lock per workspace-day for the rest of its transaction; very
large retention deletes are already batched.

## Performance

Measured with `scripts/bench-report-rollups.mjs` on a local stack with
200,000 runs, 50,000 tasks and 20,000 submissions over 180 days (medians):
see the [release note](changes/report-rollups.md) for the numbers (reports hub ×25, compare page ×80; +0.5–0.9 ms per run transition).

## Turning it off

`REPORT_ROLLUPS=off` (environment) makes every read real time on that
instance; the triggers keep the tables current, so turning it back on is
immediate. To stop the triggers too, an operator can run bulk jobs with
`SET LOCAL usertasks.report_rollups = 'off'` and queue a rebuild afterwards.
