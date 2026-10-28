# Bench results: final

Updated 2026-10-24T23:26:08.084Z.

| Environment | |
|---|---|
| machine | Apple M1 Pro |
| cpus | 10 |
| memory_gb | 32 |
| os | darwin 27.0.0 arm64 |
| node | v20.19.5 |
| git_commit | 4aa41a26 |
| git_branch | perf |
| supabase_cli | 2.122.0 |
| postgres_server | 17.6 |
| docker | 28.3.2 |

## engine

_ran 2026-10-24T23:25:36.985Z in 15.3 s_

**Engine (in-process executeWorkflow, 3 reps after 1 warm-up)**

| case | wall p50 ms | wall max ms | DB round trips | DB time ms | rows written | external calls | queue kicks |
|---|---|---|---|---|---|---|---|
| 50-node linear | 34.6 | 35.8 | 6 | 44 | 54 | 0 | 0 |
| loop ×500 (set_variable + condition + functions) | 287.7 | 348 | 6 | 247 | 2507 | 0 | 0 |
| 500 data-table inserts (+ active data_table_event workflow) | 2290.6 | 2358.2 | 1008 | 1954 | 1006 | 0 | 500 |
| decision table in loop ×200 | 90.6 | 110.1 | 7 | 100 | 606 | 0 | 0 |
| call_reference ×100 (local echo) | 77.7 | 86.7 | 7 | 40 | 106 | 100 | 0 |

**Most frequent DB operations (last rep)**

| case | ops |
|---|---|
| linear50 | GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1, RPC record_workflow_run ×1, POST workflow_logs ×1, PATCH workflow_runs ×1 |
| loop500 | GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1, RPC record_workflow_run ×1, POST workflow_logs ×1, PATCH workflow_runs ×1 |
| dataTable500 | POST custom_table_rows ×500, RPC enqueue_workflow_batch ×500, GET custom_tables ×2, GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1 |
| decision200 | GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1, GET decision_tables ×1, RPC record_workflow_run ×1, POST workflow_logs ×1 |
| callRef100 | GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1, GET integration_references ×1, RPC record_workflow_run ×1, POST workflow_logs ×1 |

- dataTable500 enqueued 2000 data_table_event jobs over 4 runs (deleted afterwards, not executed).
- Echo server received 400 requests.
- wall = executeWorkflow call; DB round trips include fire-and-forget writes that settle after it returns. DB time sums request durations (parallel requests overlap).

## probes

_ran 2026-10-24T23:25:38.654Z in 0.5 s_

**Correctness probes**

| probe | observed | verdict |
|---|---|---|
| delay node, 45 s (cap 30 s) | run waiting_for_event in 16 ms; node output {"delay_ms":45000,"resume_at":"2026-10-24T23:26:22.019Z"} | ok: run waited/paused |
| {{=UPPER(probe)}} vs "x {{=UPPER(probe)}}" | variable read 1× vs 1× | ok: evaluated once |

**resolveExpression cost (µs/call, ctx with 200 variables)**

| expression | µs/call |
|---|---|
| plain text, no {{ | 0.11 |
| "Hello {{name}}" | 0.97 |
| {{=UPPER(CONCAT("a", name))}} (whole string) | 2.54 |
| x {{=UPPER(CONCAT("a", name))}} (mixed) | 2.39 |

## queue

_ran 2026-10-24T23:26:05.437Z in 22.4 s_

**Single job latency (10 samples unless noted, ms)**

| scenario | start p50 | start p95 | start max | complete p50 | complete max |
|---|---|---|---|---|---|
| 1 job, enqueue + kickQueueProcessor() | 5.9 | 9.6 | 9.6 | 20.3 | 44.2 |
| 1 job, processor invoked directly | 2.1 | 5.5 | 5.5 | 16.6 | 20.1 |
| 1 job, pg_cron only (no kick; 1 sample) | 17184 | — | — | 17206 | — |

**200-job burst (5-node workflow)**

| scenario | enqueue → all done ms | jobs/s | start p50 ms | start max ms | failed |
|---|---|---|---|---|---|
| 200 jobs, kickQueueProcessor() after each enqueue (+ cron) | 860 | 232.6 | 379.7 | 508.8 | 0 |
| 200 jobs, one kick then pg_cron | 890 | 224.7 | 428.5 | 708.8 | 0 |
| 200 jobs, processor direct, 1 worker (batch 20) | 813 | 246 | 387.8 | 629 | 0 |
| 200 jobs, processor direct, 4 concurrent workers | 1195 | 167.4 | 362.2 | 1007.1 | 0 |

- 1 other pending/processing jobs were in the queue at start.
- Latencies come from workflow_queue timestamps (created_at → started_at / completed_at), so they include claim and run time but not the enqueue round trip.

## api

_ran 2026-10-24T23:26:09.252Z in 2.6 s_

**API latency (100 sequential requests each after 5 warm-ups, tenant API key, ms)**

| request | p50 | p95 | max | mean | statuses | response bytes |
|---|---|---|---|---|---|---|
| GET /api/v1/workflows?active=false | 4 | 4.7 | 5.4 | 4.1 | 200×100 | 6391 |
| GET /api/v1/tasks | 7.5 | 9.7 | 14.5 | 8 | 200×100 | 32025 |
| GET /api/v1/me | 3.6 | 4.3 | 6.4 | 3.7 | 200×100 | 1227 |
| MCP tools/list | 2.8 | 4 | 4.3 | 2.9 | 200×100 | 125796 |
| MCP tools/call workflows_list | 4.9 | 5.9 | 6.2 | 5 | 200×100 | 10803 |

- MCP server exposes 154 tools; tools/call used workflows_list with no arguments.

## db

_ran 2026-10-24T23:25:40.539Z in 0.7 s_

**Query plans (EXPLAIN ANALYZE, warm cache; authenticated = a member via RLS)**

| query | role | exec ms | seq scans | rows scanned / returned | fn calls | fn calls per scanned row (top) |
|---|---|---|---|---|---|---|
| tasks list for a user (newest 50) | authenticated | 38.12 | tasks | 70000 / 50 | 3 | 0 (public.get_current_tenant_id×2, public.rls_visible_tenant_ids×1) |
| tasks list for a user (newest 50) | service_role | 0.21 | none | 327 / 50 | 0 | 0 |
| runs list by workflow, newest 50 (select *) | authenticated | 0.33 | none | 50 / 50 | 2 | 0.04 (public.get_user_tenant_ids×1, public.rls_member_tenant_ids×1) |
| runs list by workflow, newest 50 (select *) | service_role | 0.04 | none | 50 / 50 | 0 | 0 |
| queue claim (claim_next_job SELECT … FOR UPDATE SKIP LOCKED) | authenticated | n/a (service only) | — | — | — | — |
| queue claim (claim_next_job SELECT … FOR UPDATE SKIP LOCKED) | service_role | 0.02 | none | 1 / 0 | 0 | 0 |
| task title ILIKE '%invoice 4%' (20) | authenticated | 41.91 | tasks | 70000 / 20 | 3 | 0 (public.get_current_tenant_id×2, public.rls_visible_tenant_ids×1) |
| task title ILIKE '%invoice 4%' (20) | service_role | 4.11 | none | 721 / 20 | 0 | 0 |
| workflow_logs for one run | authenticated | 0.16 | none | 10 / 10 | 3 | 0.3 (public.get_current_tenant_id×2, public.rls_visible_tenant_ids×1) |
| workflow_logs for one run | service_role | 0.03 | none | 10 / 10 | 0 | 0 |
| event_stream cursor read (101 after cursor) | authenticated | error: permission denied for table event_stream | — | — | — | — |
| event_stream cursor read (101 after cursor) | service_role | 0.04 | none | 101 / 101 | 0 | 0 |

- Plans saved in scripts/bench/results/final/plans/.
- Function calls = pg_stat_xact_user_functions delta (track_functions = all) for the EXPLAIN ANALYZE run.

## size

_ran 2026-10-24T23:25:20.190Z in 111.0 s_

**Build & install size**

| measure | value |
|---|---|
| client JS chunks (count) | 117 |
| client JS total MB (gzip MB) | 5.6 (1.5) |
| client CSS KB | 127 |
| .next/server MB | 188.9 |
| .next/standalone MB | — |
| node_modules MB | 865.9 |
| Docker image MB | 88.5 |
| next build s | 38.9 |

**Largest client chunks**

| chunk | KB | gzip KB | contains |
|---|---|---|---|
| 010tjym0h44v..js | 527 | 135 | recharts |
| 0_zrhxs91x0kf.js | 271 | 49 | — |
| 0mc9_9lq.9nx-.js | 271 | 49 | — |
| 14..7~~-ew5lz.js | 271 | 47 | lucide |
| 0-iymheo6-.4a.js | 259 | 64 | react-query |
| 14pofykpskj6v.js | 221 | 69 | react-dom |
| 177sbmcti1xvy.js | 219 | 58 | supabase-js |
| 07f04x94vimry.js | 146 | 37 | lucide |
| 0yzr_cghy18h_.js | 122 | 32 | react-query |
| 03~yq9q893hmn.js | 110 | 39 | — |

**First-load JS per route (root + route entry chunks; lazy chunks excluded)**

| route | KB | gzip KB | chunks |
|---|---|---|---|
| /automations/[id] | 1565 | 414 | 21 |
| /automations/runs/[id] | 1023 | 290 | 18 |
| /reports | 1063 | 300 | 18 |
| /reports/workflows | 1020 | 289 | 18 |
| /reports/workflows/[id] | 1023 | 290 | 18 |
| /reports/[id] | 1061 | 298 | 18 |
| /reports/builder | 1140 | 319 | 19 |
| /settings/api-keys | 1145 | 312 | 19 |
| /docs/api-explorer | 721 | 197 | 13 |
| /tasks | 1117 | 319 | 20 |
