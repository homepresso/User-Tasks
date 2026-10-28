# Performance baseline (before optimisation)

Recorded 2026-10-24 on branch `perf` at `e197f1c6` (the `log-export` head),
before any change from the performance plan. Full output:
`scripts/bench/results/baseline.json` / `.md`, query plans in
`scripts/bench/results/baseline/plans/`. The harness and how to re-run it:
`scripts/bench/README.md`.

After all optimisation phases: [results.md](results.md).

## Environment

| | |
|---|---|
| Machine | Apple M1 Pro, 10 cores, 32 GB, macOS 27 (arm64) |
| Node | v20.19.5 (app under test: `next start`, production build of 16.2.1) |
| Database | Local Supabase stack (CLI 2.84.4, Postgres 17.6) in Docker 28.3.2 on the same machine |
| Data | Seeded bench tenant: 50k tasks (~60k task_assignees), 100k workflow_runs, 1M workflow_logs, 1.1M event_stream rows, 50k historical queue jobs; plus a noise tenant (20k tasks, 20k runs) and 25 users with personal workspaces |
| Command | `npx tsx scripts/bench/run.ts --label baseline --app-dir <clone> --build --docker --slow` |

**The numbers are relative.** Everything — app, Postgres, PostgREST, Kong — runs
on one laptop over loopback, so absolute latencies are lower than a hosted
deployment (no network hop to the database) and noisier. Compare later labels
against this one on the same machine; don't quote these as production figures.

## Engine (in-process `executeWorkflow`, median of 3 after 1 warm-up)

| case | wall ms | DB round trips | rows written |
|---|---|---|---|
| 50-node linear | 32 | 6 | 55 |
| loop ×500 (set_variable, math, condition, expression functions) | 170 | 6 | 2 508 |
| 500 data-table inserts + active `data_table_event` workflow | 5 359 | 3 006 | 1 007 |
| decision table in loop ×200 | 466 | 206 | 607 |
| call_reference ×100 (local echo server) | 241 | 106 | 107 |

Per-node writes are already batched (6 round trips regardless of graph size).
The cost is in per-iteration reads: each data-table insert does 6 round trips
(custom_tables ×2, workflows, workflow_versions, insert, `enqueue_workflow`)
plus an unawaited queue kick; each decision-table and call_reference iteration
re-reads its definition.

## Queue (`enqueue_workflow` → `/api/workflows/process`, 5-node workflow)

| scenario | result |
|---|---|
| 1 job, enqueue + kick (current API path) | start p50 6 ms, complete p50 27 ms |
| 1 job, processor called directly | start p50 5 ms, complete p50 20 ms |
| 1 job, pg_cron only (no kick) | started after 57.5 s (1 sample; expected 0–60 s) |
| 200 jobs, kick after every enqueue | all done in 2.3 s (87 jobs/s) |
| 200 jobs, one kick then pg_cron | all done in 598 s (0.3 jobs/s) |
| 200 jobs, direct, 1 worker (batch 20) | 3.2 s (63 jobs/s) |
| 200 jobs, direct, 4 concurrent workers | 1.2 s (168 jobs/s) |

Jobs within a processor call run strictly one after another; throughput only
comes from concurrent callers. Anything that relies on pg_cron (DB-trigger
enqueues, batches that kick once) drains at 20 jobs/minute.

## API (100 sequential requests, tenant API key)

| request | p50 ms | p95 ms |
|---|---|---|
| `GET /api/v1/workflows?active=false` | 80 | 86 |
| `GET /api/v1/tasks` | 102 | 113 |
| `GET /api/v1/me` | 79 | 84 |
| MCP `tools/list` (154 tools, 126 KB) | 96 | 105 |
| MCP `tools/call workflows_list` | 94 | 99 |

Every request pays the same ~80 ms floor, which matches per-request API-key
validation (bcrypt compare at cost 10, key lookup, `last_used_at` write) — not
yet profiled separately. MCP is ~15 ms slower than REST, consistent with
registering all 154 tools on every request.

## Database (EXPLAIN ANALYZE, warm cache)

| query | as member (RLS) | as service_role |
|---|---|---|
| tasks list, newest 50 | **1 546 ms**, seq scan of 70k rows, 137k `get_current_tenant_id()` calls (~2 per row) | 2.9 ms |
| task title `ILIKE '%invoice 4%'` | **1 613 ms**, seq scan, 140k function calls | 43 ms (scans all 50k tenant rows) |
| runs by workflow, newest 50 (`select *`) | 18 ms (sorts 5k rows) | 5.1 ms |
| workflow_logs for one run | 0.4 ms (2 function calls per row) | 0.02 ms |
| queue claim (`claim_next_job` select) | n/a | 0.7 ms |
| event_stream cursor read (101) | permission denied (service-only, by design) | 0.04 ms |

## Size

| measure | value |
|---|---|
| Client JS | 122 chunks, 7.6 MB (2.0 MB gzip), CSS 130 KB |
| Largest chunks | 448 KB (contains `lucide` marker), 402 KB `xlsx`, 392 KB `zod` (API explorer), `recharts` 357 KB ×3 copies, 2 more 278 KB `zod` copies |
| `.next/server` | 189 MB |
| `node_modules` | 937 MB |
| Docker image | 92 MB (standalone build, `node:22-alpine`) |
| `next build` | 38 s; `docker build` 113 s |

## Findings confirmed while measuring

- **Delays over 30 s are skipped.** A `delay` node of 45 s returned
  immediately; the run completed in 13 ms and the node reports
  `{"waited_ms": 45000}` (`probes` suite). `pause_until` has the same cap.
- **Whole-string expression functions are evaluated twice.** Resolving
  `{{=UPPER(probe)}}` reads the variable 3 times vs 2 for
  `x {{=UPPER(probe)}}`: the function runs once in the substitution loop and
  again for the raw return value (non-deterministic functions like `GUID()`/
  `NOW()` return the second result). Every call also spreads all variables
  even when the string has no `{{` (8.5 µs/call with 200 variables).
- **Queue kicks never authenticate when only `CRON_SECRET` is set.**
  `kickQueueProcessor()` sends `X-Processor-Secret` only from
  `WORKFLOW_PROCESSOR_SECRET`, while `/api/workflows/process` accepts
  `WORKFLOW_PROCESSOR_SECRET ?? CRON_SECRET`. With the documented setup
  (`CRON_SECRET` only) every kick is a 401 and all dispatch falls back to the
  minute cron. The bench sets both so the kick path is measured at its best.
- **A kick per enqueue under load can fail runs.** In a trial run of the
  200-job kick burst, 7 of 200 jobs failed with `Failed to update workflow run
  …: TypeError: fetch failed` (local PostgREST connections exhausted by 200
  concurrent processor calls); the recorded baseline run had none.
- **RLS dominates user-facing task queries**: ~2 `get_current_tenant_id()`
  calls per row scanned, and a sequential scan of every tenant's tasks.
- **Each data-table row write re-reads the trigger set** (all active
  `data_table_event` workflows and their published versions) and kicks the
  processor once per row.
