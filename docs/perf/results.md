# Performance results (before → after)

Final numbers for the performance plan, recorded 2026-10-24 on branch `perf`
at `4aa41a26` (all optimisation phases applied) with the same harness, seed
and machine as the [baseline](baseline.md). Full output:
`scripts/bench/results/final.json` / `.md`, query plans in
`scripts/bench/results/final/plans/`; per-phase runs are
`results/phase1` … `phase6`. Release note:
[docs/changes/performance.md](../changes/performance.md).

## Environment

| | |
|---|---|
| Machine | Apple M1 Pro, 10 cores, 32 GB, macOS 27 (arm64) |
| Node | v20.19.5 (app under test: `next start`, production build of Next 16.2.1) |
| Database | Local Supabase stack (CLI 2.122.0, Postgres 17.6) in Docker 28.3.2 on the same machine |
| Data | Same seed as the baseline: 50k tasks (~60k task_assignees), 100k workflow_runs, 1M workflow_logs, 50k queue history rows, plus a noise tenant (20k tasks, 20k runs) |
| Command | `npx tsx scripts/bench/run.ts --label final --app-dir <clone> --build --docker --slow` (all suites, incl. the real pg_cron path) |

**The numbers are relative.** App, Postgres, PostgREST and Kong all run on one
laptop over loopback: absolute latencies are lower than a hosted deployment
and noisy run to run (two extra engine runs straight after the final one gave
50-node linear 28 / 49 ms and loop ×500 243 / 220 ms). Read the ratios, not
the absolute values, and don't quote them as production figures.

## Headline

| measure | baseline | final | change |
|---|---|---|---|
| API p50, `GET /api/v1/workflows` / `/tasks` / `/me` | 80 / 102 / 79 ms | 4.0 / 7.5 / 3.6 ms | 13–22× faster |
| MCP `tools/list` / `tools/call` p50 | 96 / 94 ms | 2.8 / 4.9 ms | 19–34× faster |
| Tasks list as a member (RLS), newest 50 | 1 546 ms | 38 ms | 41× faster |
| Runs of a workflow (RLS), newest 50 | 17.9 ms | 0.33 ms | 54× faster |
| 200 queued jobs, one kick (rest via pg_cron) | 598 s | 0.89 s | ~670× faster |
| 500 data-table inserts with an active trigger workflow | 5 359 ms, 3 006 round trips | 2 291 ms, 1 008 | 2.3× faster |
| Decision table ×200 / call_reference ×100 | 466 / 241 ms | 91 / 78 ms | 3–5× faster |
| `resolveExpression`, plain text (200 variables) | 8.5 µs | 0.11 µs | 77× faster |
| Client JS total (gzip) | 7.6 MB (2.0 MB) | 5.6 MB (1.5 MB) | −26 % |
| `node_modules` | 936.5 MB | 865.9 MB (786 MB without optional drivers) | −8 % (−16 %) |
| Docker image (compressed) | 92.1 MB | 88.5 MB | −4 % |
| Delay > 30 s | silently skipped | run pauses and resumes from the queue | fixed |
| `{{=FUNC()}}` whole-string | evaluated twice | evaluated once | fixed |

## Engine (in-process `executeWorkflow`, wall p50 of 3 after 1 warm-up)

| case | baseline | phase 1 | phase 2 | final | DB round trips (baseline → final) | rows written |
|---|---|---|---|---|---|---|
| 50-node linear | 31.8 ms | 21.2 | 22.2 | 34.6 | 6 → 6 | 55 → 54 |
| loop ×500 (set_variable, math, condition, functions) | 169.5 ms | 246.9 | 247.5 | 287.7 | 6 → 6 | 2 508 → 2 507 |
| 500 data-table inserts + active `data_table_event` workflow | 5 359 ms | 4 617 | 2 261 | 2 291 | 3 006 → 1 008 | 1 007 → 1 006 |
| decision table in loop ×200 | 466 ms | 79.0 | 87.8 | 90.6 | 206 → 7 | 607 → 606 |
| call_reference ×100 (local echo server) | 241 ms | 69.7 | 62.8 | 77.7 | 106 → 7 | 107 → 106 |

- Decision tables, integration references (with decrypted config), data-table
  columns and roles are read once per run instead of once per iteration
  (phase 1), so those cases now make a fixed 7 round trips.
- The data-table case went from 6 round trips per insert to 2 (the insert and
  one `enqueue_workflow_batch`): the trigger set is cached per tenant and the
  table is read only on a match (phase 2).
- **Linear and loop wall time went up, and that is expected.** The baseline
  wrote the run's logs fire-and-forget after `executeWorkflow` returned; since
  phase 1 the final writes (run row, stats, logs) are awaited together, so the
  wall time now includes inserting 2 500 log rows for loop ×500. Engine CPU
  for that case fell from 69 to 23 ms (phase 1 profile). The linear case is
  within run-to-run noise (28–49 ms across three final runs).

## Correctness probes and expression cost

| probe | baseline | final |
|---|---|---|
| `delay` node of 45 s (inline cap 30 s) | run completed in 13 ms, node output `{"waited_ms":45000}` — **skipped** | run `waiting_for_event` in 16 ms with `{"delay_ms":45000,"resume_at":…}`; a `delay_resume` queue job continues it |
| `{{=UPPER(probe)}}` vs `x {{=UPPER(probe)}}` | variable read 3× vs 2× — **evaluated twice** | 1× vs 1× |

`resolveExpression` µs/call (context with 200 variables):

| expression | baseline | phase 1 | final |
|---|---|---|---|
| plain text, no `{{` | 8.50 | 0.05 | 0.11 |
| `"Hello {{name}}"` | 8.67 | 0.70 | 0.97 |
| `{{=UPPER(CONCAT("a", name))}}` (whole string) | 12.54 | 2.46 | 2.54 |
| `x {{=UPPER(CONCAT("a", name))}}` (mixed) | 10.54 | 2.37 | 2.39 |

## Queue (`enqueue_workflow` → `/api/workflows/process`, 5-node workflow)

| scenario | baseline | phase 2 | final |
|---|---|---|---|
| 1 job, enqueue + kick: start / complete p50 | 6.3 / 27.4 ms (complete max 379) | 6.2 / 19.2 | 5.9 / 20.3 (max 44) |
| 1 job, processor called directly: start / complete p50 | 4.6 / 19.9 ms | 2.1 / 16.9 | 2.1 / 16.6 |
| 1 job, pg_cron only (no kick, 1 sample) | started after 57.5 s | — | started after 17.2 s |
| 200 jobs, kick after every enqueue | 2 306 ms (87 jobs/s) | 952 | 860 (233 jobs/s) |
| 200 jobs, one kick then pg_cron | 597 953 ms (0.3 jobs/s) | 996 | 890 (225 jobs/s) |
| 200 jobs, processor direct, 1 worker | 3 161 ms (63 jobs/s) | 1 224 | 813 (246 jobs/s) |
| 200 jobs, processor direct, 4 concurrent workers | 1 189 ms (168 jobs/s) | 2 030 | 1 195 (167 jobs/s) |

- The processor now claims jobs in batches (`claim_jobs`) and runs
  `WORKFLOW_CONCURRENCY` (default 5) at once, re-kicking itself while work is
  left. One invocation drains a 200-job burst in under a second, where the
  baseline needed one cron minute per 20 jobs.
- The pg_cron-only single job is one sample and depends on where in the
  minute the job lands (expected 0–60 s); the drain after it is the same.
- 4 concurrent direct workers (20 jobs in flight) are no faster than one on a
  laptop stack: the local PostgREST/Postgres is the limit, not the
  processor. In phase 2 this case measured 2.0 s; the final 1.2 s is back at
  the baseline. No job failed in any final scenario.

## API (100 sequential requests after 5 warm-ups, tenant API key)

| request | baseline p50 / p95 | phase 3 | phase 4 | final p50 / p95 |
|---|---|---|---|---|
| `GET /api/v1/workflows?active=false` | 80.1 / 86.1 ms | 82.2 / 93.1 | 5.0 / 8.1 | 4.0 / 4.7 |
| `GET /api/v1/tasks` | 102 / 112.7 ms | 84.9 / 90.1 | 8.2 / 9.1 | 7.5 / 9.7 |
| `GET /api/v1/me` | 79.0 / 83.9 ms | 80.6 / 90.6 | 3.8 / 5.1 | 3.6 / 4.3 |
| MCP `tools/list` (154 tools, 126 KB) | 95.8 / 104.5 ms | 98.7 / 111.1 | 2.9 / 3.8 | 2.8 / 4.0 |
| MCP `tools/call workflows_list` | 93.6 / 98.7 ms | 99.2 / 109.9 | 5.5 / 6.6 | 4.9 / 5.9 |

The ~80 ms floor was API-key validation (bcrypt compare per request plus a
`last_used_at` write). Phase 4 caches successful validations for 60 s
(keyed by SHA-256 of the token) and throttles `last_used_at` to once a minute,
and builds the MCP tool catalog once per process. Benchmarks are warm-cache:
the first request with a key after 60 s still pays the bcrypt compare.

## Database (EXPLAIN ANALYZE, warm cache)

| query | baseline member (RLS) | final member (RLS) | baseline service_role | final service_role |
|---|---|---|---|---|
| tasks list, newest 50 | 1 546 ms, 137k function calls | 38.1 ms, 3 calls | 2.87 ms (2 500 rows read) | 0.21 ms (327) |
| task title `ILIKE '%invoice 4%'` | 1 613 ms, 140k calls | 41.9 ms, 3 calls | 43.2 ms (50k rows read) | 4.1 ms (721, trigram index) |
| runs by workflow, newest 50 (`select *`) | 17.9 ms (sorts 5k rows) | 0.33 ms (index, 50 rows) | 5.08 ms | 0.04 ms |
| workflow_logs for one run | 0.40 ms (2 calls per row) | 0.16 ms (3 calls total) | 0.02 ms | 0.03 ms |
| queue claim (`claim_next_job` select) | n/a | n/a | 0.71 ms | 0.02 ms (`idx_queue_claim`) |
| event_stream cursor read (101) | denied (service only) | denied | 0.04 ms | 0.04 ms |

RLS helpers now run once per statement (initplans) instead of ~2 times per
scanned row. The member tasks queries still scan both tenants' 70k rows: the
bench query has no tenant filter of its own and the tenant set is only known
at run time, so the planner can't use `idx_tasks_tenant_created`. The app's
task lists now add `tenant_id = <current>` (phase 4), which can.

## Size

| measure | baseline | phase 4 | phase 5 | phase 6 / final |
|---|---|---|---|---|
| Client JS chunks | 122 | 122 | 117 | 117 |
| Client JS total (gzip) | 7.6 MB (2.0) | 7.6 (2.0) | 5.6 (1.5) | 5.6 (1.5) |
| Client CSS | 130 KB | 130 | 130 | 127 |
| `.next/server` | 189 MB | 203 | 193 | 189 |
| `node_modules` | 936.5 MB | 936.5 | 936.5 | 865.9 (786 without `snowflake-sdk`/`oracledb`/`mongodb`) |
| Docker image (compressed) | 92.1 MB | — | — | 88.5 (406 MB on disk; 434 MB with optional drivers) |
| `next build` | 37.9 s | 38.4 | 37.4 | 38.9 |

Largest client chunks:

| baseline | final |
|---|---|
| 448 KB `lucide` | 527 KB `recharts` (one shared copy, lazy-loaded on report routes) |
| 402 KB `xlsx` | 271 KB (shared app code) |
| 392 KB `zod` (API explorer) | 271 KB (shared app code) |
| 357 KB `recharts` ×3 copies | 270 KB `lucide` |
| 278 KB `zod` ×2 more copies | 259 KB `react-query` |

`xlsx` and `zod` no longer ship to the browser; the three `recharts` copies
are one chunk.

First-load JS per route (root + route entry chunks, lazy chunks excluded):

| route | before (phase 4 build) | final (gzip) |
|---|---|---|
| `/automations/[id]` (workflow builder) | 1 897 KB | 1 565 KB (414) |
| `/reports/workflows/[id]` | 1 472 KB | 1 023 KB (290) |
| `/settings/api-keys` | 1 430 KB | 1 145 KB (312) |
| `/docs/api-explorer` | 1 004 KB | 721 KB (197) |
| `/reports/builder` | — | 1 140 KB (319) |
| `/tasks` | — | 1 117 KB (319) |

The per-route measure was added to the harness in phase 5; the "before"
column is from the phase 4 build (client bundles were unchanged from the
baseline until phase 5).

## What changed, by phase

| phase | commit | what changed | main effect |
|---|---|---|---|
| 0 | `d72c1d65` | Benchmark harness (`scripts/bench`), seed, baseline | — |
| 1 | `e19327b2` | Delays > 30 s pause and resume via the queue; `resolveExpression` early return, lazy scope, single evaluation, template LRU; ReDoS guard; per-run caches; one Supabase client per run tree; awaited final writes; `record_workflow_run` RPC; stored output caps | decision ×200 466 → 79 ms, call_reference 241 → 70 ms, expressions 4–170× cheaper, two bugs fixed |
| 2 | `36383b92` | `claim_jobs` batch claim + bounded concurrency, `after()` kicks (CRON_SECRET-only kicks fixed), atomic queued resume, data-table trigger cache + batch enqueue, cron split, queue history purge | 200 jobs via pg_cron 598 s → 1 s; data-table ×500 4.6 → 2.3 s |
| 3 | `cfbf4ef4` | RLS initplans, redundant policies dropped, hot-query indexes, duplicate indexes dropped, `search_path` on SECURITY DEFINER functions | tasks list via RLS 1 546 → 36 ms |
| 4 | `07edfb49` | API-key validation cache, MCP catalog built once, explicit column lists, `node_count`, SQL report aggregates, React Query persistence and hydration fixes | API p50 ~80 → 4–8 ms |
| 5 | `588acc88` | API explorer from generated JSON, `next/dynamic` for heavy builder panels, one lazy recharts module, server-side report export | client JS 7.6 → 5.6 MB |
| 6a | `88ea8d67` | `xlsx` → ExcelJS (server only); Snowflake/Oracle/MongoDB drivers optional | unmaintained SheetJS 0.18 (open CVEs) gone; drivers left out of the Docker image by default |
| 6b | `f974d2b7` | `/api/v1/workflows/author` removed (`POST /workflows`, `PATCH /workflows/{id}`) | — |
| 6c | `ec96ffbf` | Legacy `integration_endpoints`, orphan pages/routes, retired node stubs and dead code removed; shared helpers | — |
| 6d | `bce7a20d` | `supabase/migrations_archive/` and the `supabase` CLI devDependency (87 MB) removed | — |
| 6e | `4aa41a26` | Size results | 6a–6d together: `node_modules` 936.5 → 865.9 MB, image 92.1 → 88.5 MB |

## Caveats

- One laptop, everything local, warm caches; network latency to a hosted
  database is not in these numbers. Hosted gains from fewer round trips
  (engine, data-table triggers, API) should be larger than shown here, since
  each saved round trip costs more there.
- Engine and single-job numbers are medians of 3–10 samples and move by
  ±10–20 ms between runs.
- The API benchmark reuses one key, so it measures the cached path; a cold
  key or one used again after more than 60 s pays one bcrypt compare.
- The DB suite measures the bench queries as written; the app's own queries
  also gained explicit tenant filters and column lists in phase 4.
