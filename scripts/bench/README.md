# Benchmarks (`scripts/bench`)

Opt-in performance harness for the workflow engine, queue, API, database and
build size. It runs only against a **local** Supabase stack: every entry point
refuses a database or API URL whose host is not `localhost`/`127.0.0.1`, and it
never reads `.env*` files.

Results go to `scripts/bench/results/<label>.json` (machine-readable) and
`<label>.md` (summary tables); query plans to `results/<label>/plans/`. Re-running
a suite replaces only that suite's entry, so suites can be run separately.
`docs/perf/baseline.md` explains the baseline numbers and
`docs/perf/results.md` compares them with the final (`final`) run.

## 1. Local stack and seed

```sh
npx supabase start                      # Docker must be running
npx tsx scripts/bench/seed.ts           # ~3 min; add --reset to start over
```

URLs and keys come from `npx supabase status` unless `BENCH_SUPABASE_URL`,
`BENCH_ANON_KEY`, `BENCH_SERVICE_ROLE_KEY` and `BENCH_DB_URL` are set. The seed
creates the "Perf Bench" tenant (20 users) and a "Perf Bench Noise" tenant with:

| data | bench | noise |
|---|---|---|
| tasks (+ task_assignees) | 50 000 (~60 000) | 20 000 |
| workflow_runs | 100 000 over 20 workflows | 20 000 |
| workflow_logs (→ event_stream via trigger) | 1 000 000 | — |
| workflow_queue history (completed/dead) | 50 000 | — |
| data tables | orders (5 000 rows), events (bench target) | — |
| decision table | 20 rules | — |
| integration + reference | `http://127.0.0.1:4599/echo` (the suites' echo server) | — |

plus the bench workflows (`lib/workflows.ts`, fixed ids, published) and a
tenant API key. Ids and the key are written to `scripts/bench/.state.json`
(gitignored). `--scale 0.1` seeds a tenth of the volume.

## 2. Run

```sh
# All suites. --app-dir is a clone used for the build and `next start`
# (APFS: cp -c -R; remove .env* there). The runner starts the server on
# --app-url (default http://127.0.0.1:3311, never :3000) when nothing answers.
npx tsx scripts/bench/run.ts --label baseline --app-dir ../perfclone --build

# Individual suites
npx tsx scripts/bench/run.ts --label baseline --suites engine,probes,db
npx tsx scripts/bench/run.ts --label baseline --suites queue,api --app-dir ../perfclone
```

| flag | meaning |
|---|---|
| `--label <name>` | results file name (required) |
| `--suites a,b` | `engine,probes,queue,api,db,size` (default: all) |
| `--app-dir <dir>` | app to build/measure/start (needed for `size`, and for `queue`/`api` unless a server is already up) |
| `--app-url <url>` | where the app under test listens (default `http://127.0.0.1:3311`) |
| `--build` | `npm run build` in `--app-dir` first (with the local-stack env; `NEXT_PUBLIC_*` are inlined at build time) |
| `--docker` | also `docker build` the app dir and record the image size (slow) |
| `--slow` | queue: measure pg_cron-only dispatch (single job up to 60 s, 200 jobs ~10 min) instead of projecting it |
| `--reps N` | engine repetitions after one warm-up (default 3) |
| `--requests N` | API requests per endpoint (default 100) |
| `--secret <s>` | processor secret of an already-running server (default `bench-processor-secret`) |

A server started by the runner gets the local stack's URL/keys,
`NEXT_PUBLIC_APP_URL=<app-url>` and `CRON_SECRET`/`WORKFLOW_PROCESSOR_SECRET`
= the secret. If you start it yourself, build it with the same `NEXT_PUBLIC_*`.

## Suites

- **engine** — bench workflows run in-process through `executeWorkflow`
  (queue call shape: pinned published version): 50-node linear; loop ×500 with
  set_variable/math/condition and expression functions; 500 data-table inserts
  with an active `data_table_event` workflow; decision table ×200; call_reference
  ×100 against the echo server. A global fetch wrapper counts Supabase round
  trips by operation, rows written, DB wait and queue kicks (kicks are answered
  in-process, never sent).
- **probes** — audit findings as checks: a 45 s `delay` node (should pause; is
  skipped today), whole-string `{{=FUNC()}}` double evaluation, and
  `resolveExpression` µs/call.
- **queue** — `enqueue_workflow` + `/api/workflows/process`: single-job
  enqueue→start/complete latency with today's unawaited kick vs. a direct
  processor call; 200-job bursts with a kick per enqueue, and drained directly
  by 1 and 4 workers. pg_cron is simulated (same endpoint and batch size at each
  minute) with `--slow`, otherwise projected.
- **api** — p50/p95/max of `GET /api/v1/workflows`, `/tasks`, `/me`, MCP
  `tools/list` and one `tools/call`, sequential, API key auth.
- **db** — `EXPLAIN (ANALYZE, BUFFERS)` of hot queries as a member through RLS
  (`SET ROLE authenticated` + `request.jwt.claims`) and as `service_role`:
  tasks list, runs by workflow, queue claim, task title ILIKE, logs by run,
  event_stream cursor read. Counts user-function calls with
  `pg_stat_xact_user_functions` (connects as the local `supabase_admin`
  superuser for `track_functions`; override with `BENCH_ADMIN_DB_URL`).
- **size** — client JS chunks (total, gzip, largest), CSS, `.next/server`,
  `.next/standalone`, `node_modules`, and the Docker image with `--docker`.

Numbers are only comparable between runs on the same machine and stack;
compare labels, not absolute values.
