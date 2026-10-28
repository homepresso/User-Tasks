# Release notes: performance and size

Work on the `perf` branch: faster workflow execution, queue dispatch, API
authentication and database queries, smaller client bundles, and removal of
code and dependencies that no longer earn their place. It also fixes two
engine bugs (long delays were skipped; whole-string expression functions ran
twice) and a few database privilege problems.

Measured on a local stack (relative numbers; details and caveats in
[docs/perf/results.md](../perf/results.md)):

| measure | before | after |
|---|---|---|
| API p50 (`/workflows`, `/tasks`, `/me`, MCP) | 79–102 ms | 3–8 ms |
| Tasks list as a member (RLS, 70k rows) | 1 546 ms | 38 ms |
| 200 queued jobs with one kick | 598 s (pg_cron, 20 jobs/min) | 0.9 s |
| 500 data-table inserts with a trigger workflow | 5.4 s, 3 006 round trips | 2.3 s, 1 008 |
| Decision table ×200 / call_reference ×100 | 466 / 241 ms | 91 / 78 ms |
| Client JS (gzip) | 7.6 MB (2.0) | 5.6 MB (1.5) |
| `node_modules` / Docker image | 936 / 92 MB | 866 (786 without optional drivers) / 88.5 MB |

Apply the migrations (below and in [docs/migrations.md](../migrations.md))
together with the deploy; `20261028000000` must be in place **before** the new
app serves report pages.

## Breaking changes

- **`/api/v1/workflows/author` is removed.** Use:
  - `POST /api/v1/workflows` to create a workflow. It takes the same body as
    `POST /workflows/author` did (`name`, `trigger_type`, `nodes`, `edges`,
    `user_variables`, `description`, `trigger_config`, `swimlanes`,
    `sections`, `tags`, `is_active`, and `publish` / `publish_notes` to also
    publish version 1), returns `201` with `{ workflow_id, name, published }`,
    and needs `workflows.edit` or `workflows.create` (plus
    `workflows.activate` with `publish: true`).
  - `PATCH /api/v1/workflows/{id}` to update one (it replaces
    `PUT /workflows/author`; the id moves from the `workflow_id` body field to
    the path). Same fields, all optional, plus `publish` / `publish_notes`.

  Requests to the old path now get `405`. MCP tools are unchanged.
- **SDK / CLI.** The SDK operation `createWorkflow` and
  `usertasks workflows create` now call `POST /workflows`. The SDK
  `updateWorkflow` operation is **removed**: use `updateWorkflowDefinition`
  (`usertasks workflows update`).
- **Excel is `.xlsx` only, dates are ISO strings.** `read_excel`, `doc_excel`,
  report export and the agent doc tool use ExcelJS instead of SheetJS 0.18
  (unmaintained, open CVEs). Only `.xlsx` workbooks are read (`.xls`, `.ods`
  and CSV files saved as workbooks fail with "Not a readable .xlsx
  workbook"); use `read_csv` for CSV. Date cells are read as ISO 8601 strings
  (`2026-01-15`, or a full timestamp when there is a time part) instead of
  Excel serial numbers — workflows that did arithmetic on the serial number
  should use the date functions (`ADD_DAYS`, `DAY_DIFF`, `FORMAT_DATE`, …). `doc_excel` now keeps
  most template formatting (SheetJS dropped cell styles on save).
- **Optional database drivers / Docker.** Snowflake (`snowflake-sdk`), Oracle
  (`oracledb`) and MongoDB (`mongodb`) are `optionalDependencies`. The Docker
  image leaves them out unless built with
  `--build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true`; without the driver the
  connector fails with "The Snowflake connector requires the optional package
  snowflake-sdk; install it with `npm i snowflake-sdk` …". See
  [Optional drivers](../optional-drivers.md).
- **Removed routes and pages.** `POST /api/webhooks/dispatch` and
  `POST /api/decision-tables/execute` (internal, uncalled) return 404. The
  old `/api-keys` and `/webhooks` pages redirect (308) to
  `/settings/api-keys` and `/settings/webhooks`. The legacy integration
  "endpoints" list and its table are gone (references and objects replaced
  them).
- **Retired node types.** `send_push` and `ai_action` ("coming soon"
  placeholders) are no longer offered. Stored workflows that contain them
  still load and run; the engine skips them as unknown node types.

## Behaviour changes

- **Task completion resumes the workflow from the queue.** Completing a
  workflow task (`POST /api/v1/tasks/{id}/action`, MCP
  `tasks_complete_workflow`, `/api/events/complete`, the agent action tool and
  the UI) no longer runs the rest of the workflow inside the request. It
  enqueues a signed `task_resume` job and returns at once with
  `workflow_resumed: true`, `workflow_status: "queued"`, `run_id` and
  `resumed: "queued"` (previously `workflow_status` was the run's status
  after the downstream nodes had run). Poll
  `GET /api/v1/workflows/runs/{run_id}` for the outcome. Resumes are claimed
  atomically: a double submit resumes the run once.
- **Delays over 30 s pause the run.** `delay` and `pause_until` longer than
  30 s used to return immediately (reporting the full wait). The run now
  goes to `waiting_for_event` and a `delay_resume` queue job continues it at
  the next node, variables intact, when the time is up (within the queue's
  dispatch latency: the next kick or pg_cron minute). Waits of 30 s or less
  still happen inline. **Exception:** inside a loop body the wait is still
  skipped, with a warning in the run log, because loop state is not
  resumable.
- **Regex safety limits.** User patterns in `REGEX_MATCH` / `REGEX_EXTRACT` /
  `REGEX_REPLACE`, the condition operator `matches` and the Regex node are
  rejected when longer than 500 characters or when they nest unbounded
  quantifiers (`(a+)+`, `(\d*)*`, `(a|b+){2,}`), and the input is capped at
  100 000 characters. The functions and `matches` treat a rejected pattern
  like an invalid one (`false`, `""`, or the input unchanged); the Regex node
  fails with a "Regex rejected: …" error.
- **Stored run output is capped.** Each node's output in
  `workflow_runs.node_results` is stored up to 32 KB; a larger output is
  replaced by a `_truncated` preview (the run itself still sees the full
  value). `execution_trace` and `workflow_logs` keep at most 5 000 entries
  per run (head and tail, with a "truncated" marker). Tune with
  `WORKFLOW_NODE_RESULT_MAX_BYTES`, `WORKFLOW_TRACE_MAX_ENTRIES`,
  `WORKFLOW_LOG_MAX_ENTRIES`.
- **API key validation is cached.** A successful validation is cached
  in-process for 60 s (keyed by the token's SHA-256, at most 1 000 entries,
  never past the key's expiry). Revoking or deleting a key, changing roles,
  revoking an OAuth grant or deactivating a user through directory sync
  invalidates the cache **on the instance that handled the change**; other
  instances (serverless or multiple containers) keep accepting the key for
  **up to 60 s**. `last_used_at` is written at most once a minute per key.
- **Queue dispatch.** One processor invocation claims jobs in batches and
  runs up to `WORKFLOW_CONCURRENCY` (default 5) at once, so jobs of a burst
  start in parallel and DB-trigger enqueues no longer wait 20 per cron
  minute. Deployments that set only `CRON_SECRET` now get immediate kicks
  (they were rejected with 401 and fell back to pg_cron). Completed queue jobs
  store `{status, run_id}` instead of the full node results, and finished
  `workflow_queue` / `agent_queue` rows are purged after 7 days
  (`QUEUE_RETENTION_DAYS`). `/api/cron/process-workflows` only drains the
  queue; retention runs once a day and SLA checks every 5 minutes.
- **Run statistics.** `workflows.run_count` is incremented atomically
  (concurrent runs no longer lose counts).
- **Reports aggregate in the database.** The workflow report pages (hub,
  workflow detail, compare) use SQL RPCs instead of downloading up to 10 000
  runs with their traces into the browser: totals, status counts and daily
  trends now cover every run in the selected period (not just the newest
  10 000), p50/p95 durations are interpolated percentiles
  (`percentile_cont`), the compare page's per-node visit counts use the
  newest 5 000 runs per workflow, and the workflow detail heat map loads the
  traces of the newest 2 000 runs from a server route only when it is shown.
  Expect small differences from the old figures on busy workflows.
- **Workflow list.** `GET /api/v1/workflows` and the UI list read a stored
  `node_count` instead of downloading every definition.

## Security fixes

- `workflow_logs` inserts through RLS were allowed for anyone (`WITH CHECK
  (true)`); now member tenants only (the engine uses the service role).
- `tag_definitions` inserts need an authenticated user and their current
  tenant (anon and tenant-less inserts were allowed).
- `create_task_with_subtasks` rejects assignees outside the caller's tenant.
- Every `SECURITY DEFINER` function has a pinned `search_path`; queue worker
  RPCs (`claim_jobs`, `release_jobs`, `purge_queue_history`,
  `record_workflow_run`) are service-role only.
- `user_memberships` reads no longer fail with 42P17 (recursive policy), which
  broke the org switcher for end users.

## New environment variables (all optional)

| variable | default | what it does |
|---|---|---|
| `WORKFLOW_CONCURRENCY` | `5` | jobs one queue-processor invocation runs at once |
| `WORKFLOW_PROCESSOR_BUDGET_MS` | `50000` | how long one invocation keeps starting jobs (unstarted claims are released) |
| `QUEUE_RETENTION_DAYS` | `7` | days finished `workflow_queue` / `agent_queue` rows are kept |
| `WORKFLOW_NODE_RESULT_MAX_BYTES` | `32768` | max stored size of one node's output |
| `WORKFLOW_TRACE_MAX_ENTRIES` | `5000` | max `execution_trace` entries per run |
| `WORKFLOW_LOG_MAX_ENTRIES` | `5000` | max `workflow_logs` rows per run |
| `INCLUDE_OPTIONAL_DB_DRIVERS` (Docker build arg) | `false` | install the Snowflake/Oracle/MongoDB drivers in the image |

## Migrations

Apply in order, after the strip-back, CLI and log-export migrations
(full ordered list and the live sequence: [docs/migrations.md](../migrations.md#pending-on-production)).
All are idempotent.

| Migration | What it does | Live notes |
|---|---|---|
| `20261025000000_record_workflow_run.sql` | `record_workflow_run` RPC (atomic `run_count` / stats) | The engine falls back to the old update until it exists: can go before or after the deploy |
| `20261026000000_queue_dispatch.sql` | `claim_jobs`, `release_jobs`, `idx_queue_claim`, slim `complete_job` results, `enqueue_workflow_batch`, `purge_queue_history` | The processor falls back to `claim_next_job` until it exists. `idx_queue_claim` is a small partial index; build it `CONCURRENTLY` first if the queue table is large |
| `20261027000000_rls_initplan.sql` | RLS policies as initplans, redundant policies dropped, `wl_insert` and `user_memberships` fixes, `search_path` on SECURITY DEFINER functions, `create_task_with_subtasks` assignee check | Catalog only (no rewrite) but takes a brief `ACCESS EXCLUSIVE` lock per table; `lock_timeout = 5s`, re-run if it times out |
| `20261027000001_perf_indexes.sql` | Indexes for task/run/log lists, assignees, trigram title search (`pg_trgm`); 11 duplicate indexes dropped | Plain `CREATE INDEX` blocks writes while it builds: on production build the indexes `CONCURRENTLY` first (statements in [docs/migrations.md](../migrations.md#performance-migrations-on-a-live-database-20261027)), then push |
| `20261028000000_perf_api_reports.sql` | `workflows.node_count` (+ trigger, backfill), `tag_definitions` insert policy, run-report RPCs | **Before** the new app version: report pages call the RPCs |
| `20261029000000_drop_integration_endpoints.sql` | Drops the legacy `integration_endpoints` table and `integration_references.endpoint_id` | Irreversible; nothing in the new app reads them. Back up first if you want the rows |

## Development

- `scripts/bench/` is an opt-in benchmark harness (local stack only); see
  its README and [docs/perf](../perf/).
- The `supabase` CLI is no longer a devDependency; scripts and docs use
  `npx supabase` (or a global install).
- `supabase/migrations_archive/` (92 pre-baseline migrations, never applied)
  is removed; it remains in git history.
