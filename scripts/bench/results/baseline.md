# Bench results: baseline

Updated 2026-10-24T20:24:54.102Z.

| Environment | |
|---|---|
| machine | Apple M1 Pro |
| cpus | 10 |
| memory_gb | 32 |
| os | darwin 27.0.0 arm64 |
| node | v20.19.5 |
| git_commit | e197f1c6 |
| git_branch | perf |
| supabase_cli | 2.84.4 |
| postgres_server | 17.6 |
| docker | 28.3.2 |

## engine

_ran 2026-10-24T20:12:45.888Z in 30.5 s_

**Engine (in-process executeWorkflow, 3 reps after 1 warm-up)**

| case | wall p50 ms | wall max ms | DB round trips | DB time ms | rows written | external calls | queue kicks |
|---|---|---|---|---|---|---|---|
| 50-node linear | 31.8 | 61.3 | 6 | 52 | 55 | 0 | 0 |
| loop ×500 (set_variable + condition + functions) | 169.5 | 184.6 | 6 | 210 | 2508 | 0 | 0 |
| 500 data-table inserts (+ active data_table_event workflow) | 5359.3 | 5370.3 | 3006 | 4855 | 1007 | 0 | 500 |
| decision table in loop ×200 | 466.4 | 498.3 | 206 | 450 | 607 | 0 | 0 |
| call_reference ×100 (local echo) | 241.2 | 256.3 | 106 | 184 | 107 | 100 | 0 |

**Most frequent DB operations (last rep)**

| case | ops |
|---|---|
| linear50 | GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1, PATCH workflow_runs ×1, PATCH workflows ×1, POST workflow_logs ×1 |
| loop500 | GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1, PATCH workflow_runs ×1, PATCH workflows ×1, POST workflow_logs ×1 |
| dataTable500 | GET custom_tables ×1000, GET workflows ×501, GET workflow_versions ×501, POST custom_table_rows ×500, RPC enqueue_workflow ×500, POST workflow_runs ×1 |
| decision200 | GET decision_tables ×200, GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1, PATCH workflow_runs ×1, PATCH workflows ×1 |
| callRef100 | GET integration_references ×100, GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1, PATCH workflow_runs ×1, PATCH workflows ×1 |

- dataTable500 enqueued 2000 data_table_event jobs over 4 runs (deleted afterwards, not executed).
- Echo server received 400 requests.
- wall = executeWorkflow call; DB round trips include fire-and-forget writes that settle after it returns. DB time sums request durations (parallel requests overlap).

## probes

_ran 2026-10-24T20:12:48.729Z in 2.3 s_

**Correctness probes**

| probe | observed | verdict |
|---|---|---|
| delay node, 45 s (cap 30 s) | run completed in 13 ms; node output {"waited_ms":45000} | BUG: delay silently skipped |
| {{=UPPER(probe)}} vs "x {{=UPPER(probe)}}" | variable read 3× vs 2× | BUG: whole-string function evaluated twice |

**resolveExpression cost (µs/call, ctx with 200 variables)**

| expression | µs/call |
|---|---|
| plain text, no {{ | 8.5 |
| "Hello {{name}}" | 8.67 |
| {{=UPPER(CONCAT("a", name))}} (whole string) | 12.54 |
| x {{=UPPER(CONCAT("a", name))}} (mixed) | 10.54 |

## queue

_ran 2026-10-24T20:24:05.917Z in 663.8 s_

**Single job latency (10 samples unless noted, ms)**

| scenario | start p50 | start p95 | start max | complete p50 | complete max |
|---|---|---|---|---|---|
| 1 job, enqueue + kick (current API path) | 6.3 | 9.9 | 9.9 | 27.4 | 379.1 |
| 1 job, processor invoked directly | 4.6 | 5.2 | 5.2 | 19.9 | 23.6 |
| 1 job, pg_cron only (no kick; 1 sample) | 57484 | — | — | 57615 | — |

**200-job burst (5-node workflow)**

| scenario | enqueue → all done ms | jobs/s | start p50 ms | start max ms | failed |
|---|---|---|---|---|---|
| 200 jobs, kick after each enqueue (+ cron) | 2306 | 86.7 | 287.1 | 511 | 0 |
| 200 jobs, one kick then pg_cron | 597953 | 0.3 | 297829.1 | 597812.7 | 0 |
| 200 jobs, processor direct, 1 worker (batch 20) | 3161 | 63.3 | 1557.7 | 3046.8 | 0 |
| 200 jobs, processor direct, 4 concurrent workers | 1189 | 168.2 | 592.8 | 991.3 | 0 |

- Latencies come from workflow_queue timestamps (created_at → started_at / completed_at), so they include claim and run time but not the enqueue round trip.

## api

_ran 2026-10-24T20:24:54.891Z in 48.2 s_

**API latency (100 sequential requests each after 5 warm-ups, tenant API key, ms)**

| request | p50 | p95 | max | mean | statuses | response bytes |
|---|---|---|---|---|---|---|
| GET /api/v1/workflows?active=false | 80.1 | 86.1 | 135.1 | 81.1 | 200×100 | 6190 |
| GET /api/v1/tasks | 102 | 112.7 | 115 | 105 | 200×100 | 32336 |
| GET /api/v1/me | 79 | 83.9 | 99.2 | 79.4 | 200×100 | 1227 |
| MCP tools/list | 95.8 | 104.5 | 114.4 | 96.7 | 200×100 | 125796 |
| MCP tools/call workflows_list | 93.6 | 98.7 | 107 | 94.2 | 200×100 | 10468 |

- MCP server exposes 154 tools; tools/call used workflows_list with no arguments.

## db

_ran 2026-10-24T20:13:00.051Z in 10.5 s_

**Query plans (EXPLAIN ANALYZE, warm cache; authenticated = a member via RLS)**

| query | role | exec ms | seq scans | rows scanned / returned | fn calls | fn calls per scanned row (top) |
|---|---|---|---|---|---|---|
| tasks list for a user (newest 50) | authenticated | 1546.03 | tasks | 70010 / 50 | 137220 | 1.96 (public.get_current_tenant_id×137220) |
| tasks list for a user (newest 50) | service_role | 2.87 | none | 2500 / 50 | 0 | 0 |
| runs list by workflow, newest 50 (select *) | authenticated | 17.92 | none | 5000 / 50 | 1 | 0 (public.get_user_tenant_ids×1) |
| runs list by workflow, newest 50 (select *) | service_role | 5.08 | none | 5000 / 50 | 0 | 0 |
| queue claim (claim_next_job SELECT … FOR UPDATE SKIP LOCKED) | authenticated | n/a (service only) | — | — | — | — |
| queue claim (claim_next_job SELECT … FOR UPDATE SKIP LOCKED) | service_role | 0.71 | none | 0 / 0 | 0 | 0 |
| task title ILIKE '%invoice 4%' (20) | authenticated | 1612.95 | tasks | 70010 / 20 | 140020 | 2 (public.get_current_tenant_id×140020) |
| task title ILIKE '%invoice 4%' (20) | service_role | 43.17 | none | 50000 / 20 | 0 | 0 |
| workflow_logs for one run | authenticated | 0.4 | none | 10 / 10 | 20 | 2 (public.get_current_tenant_id×20) |
| workflow_logs for one run | service_role | 0.02 | none | 10 / 10 | 0 | 0 |
| event_stream cursor read (101 after cursor) | authenticated | error: permission denied for table event_stream | — | — | — | — |
| event_stream cursor read (101 after cursor) | service_role | 0.04 | none | 101 / 101 | 0 | 0 |

- Plans saved in scripts/bench/results/baseline/plans/.
- Function calls = pg_stat_xact_user_functions delta (track_functions = all) for the EXPLAIN ANALYZE run.

## size

_ran 2026-10-24T20:12:14.493Z in 152.4 s_

**Build & install size**

| measure | value |
|---|---|
| client JS chunks (count) | 122 |
| client JS total MB (gzip MB) | 7.6 (2) |
| client CSS KB | 130 |
| .next/server MB | 189.2 |
| .next/standalone MB | — |
| node_modules MB | 936.5 |
| Docker image MB | 92.1 |
| next build s | 37.9 |

**Largest client chunks**

| chunk | KB | gzip KB | contains |
|---|---|---|---|
| 03n~bye4ls3x7.js | 448 | 91 | lucide |
| 0rvqm0vktswnk.js | 402 | 137 | xlsx |
| 0bg7j_21khcgs.js | 392 | 104 | zod |
| 0fdd0dewb8q9p.js | 357 | 103 | recharts |
| 0kyeyc8kobkan.js | 357 | 103 | recharts |
| 0zht_fixubbj5.js | 357 | 103 | recharts |
| 0373j2_9j8zqo.js | 278 | 63 | zod |
| 094dst-w3ehr6.js | 278 | 63 | zod |
| 0hu8~auz-vcxm.js | 271 | 48 | — |
| 0zgqc.pptxdm2.js | 271 | 48 | — |
