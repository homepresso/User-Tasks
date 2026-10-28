# Bench results: phase12-supabase

Updated 2026-10-26T15:53:14.561Z.

| Environment | |
|---|---|
| machine | Apple M1 Pro |
| cpus | 10 |
| memory_gb | 32 |
| os | darwin 27.0.0 arm64 |
| node | v20.19.5 |
| git_commit | ac4cc7d6 |
| git_branch | providers |
| supabase_cli | 2.122.0 |
| postgres_server | 17.11 |
| docker | 28.3.2 |

## engine

_ran 2026-10-26T15:53:09.509Z in 15.2 s_

**Engine (in-process executeWorkflow, 3 reps after 1 warm-up)**

| case | wall p50 ms | wall max ms | DB round trips | DB time ms | rows written | external calls | queue kicks |
|---|---|---|---|---|---|---|---|
| 50-node linear | 36.5 | 60.7 | 6 | 46 | 54 | 0 | 0 |
| loop ×500 (set_variable + condition + functions) | 265.5 | 313.1 | 6 | 240 | 2507 | 0 | 0 |
| 500 data-table inserts (+ active data_table_event workflow) | 2411.2 | 2461.8 | 1008 | 2069 | 1006 | 0 | 500 |
| decision table in loop ×200 | 76.7 | 89.9 | 7 | 93 | 606 | 0 | 0 |
| call_reference ×100 (local echo) | 80.7 | 90.1 | 7 | 50 | 106 | 100 | 0 |

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

## api

_ran 2026-10-26T15:53:16.022Z in 3.8 s_

**API latency (100 sequential requests each after 5 warm-ups, tenant API key, ms)**

| request | p50 | p95 | max | mean | statuses | response bytes |
|---|---|---|---|---|---|---|
| GET /api/v1/workflows?active=false | 5.1 | 7.1 | 9.4 | 5.3 | 200×100 | 6193 |
| GET /api/v1/tasks | 7.6 | 8.7 | 9 | 7.7 | 200×100 | 35411 |
| GET /api/v1/me | 4.2 | 5 | 5.9 | 4.3 | 200×100 | 1251 |
| MCP tools/list | 3.1 | 5.1 | 8 | 3.4 | 200×100 | 133302 |
| MCP tools/call workflows_list | 5.5 | 6.6 | 8.1 | 5.6 | 200×100 | 10428 |

- MCP server exposes 162 tools; tools/call used workflows_list with no arguments.

> Note (providers phase 12): recorded on a second, disposable local Supabase
> stack (ports 553xx, full seed) with the same build for both runs;
> `phase12-postgres` used `DB_PROVIDER=postgres` (pg-query over DATABASE_URL).
> Compared with `phase3-supabase` / `phase3-postgres`: API p50s within ±1 ms,
> engine cases within run-to-run noise (±15%; the engine runs in-process and
> phase 12 changed no runtime code paths). No regressions. pg-query bypasses
> the global `fetch`, so its DB round-trip columns read 0.
