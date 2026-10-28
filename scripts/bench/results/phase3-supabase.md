# Bench results: phase3-supabase

Updated 2026-10-25T19:59:44.215Z.

| Environment | |
|---|---|
| machine | Apple M1 Pro |
| cpus | 10 |
| memory_gb | 32 |
| os | darwin 27.0.0 arm64 |
| node | v20.19.5 |
| git_commit | 5e3970f9 |
| git_branch | providers |
| supabase_cli | 2.122.0 |
| postgres_server | 17.6 |
| docker | 28.3.2 |

## engine

_ran 2026-10-25T19:59:38.141Z in 22.3 s_

**Engine (in-process executeWorkflow, 5 reps after 1 warm-up)**

| case | wall p50 ms | wall max ms | DB round trips | DB time ms | rows written | external calls | queue kicks |
|---|---|---|---|---|---|---|---|
| 50-node linear | 43.4 | 94.9 | 6 | 141 | 54 | 0 | 0 |
| loop ×500 (set_variable + condition + functions) | 237.8 | 293.8 | 6 | 222 | 2507 | 0 | 0 |
| 500 data-table inserts (+ active data_table_event workflow) | 2373.1 | 2467.7 | 1008 | 2004 | 1006 | 0 | 500 |
| decision table in loop ×200 | 101.4 | 117.3 | 7 | 113 | 606 | 0 | 0 |
| call_reference ×100 (local echo) | 70.2 | 86.9 | 7 | 39 | 106 | 100 | 0 |

**Most frequent DB operations (last rep)**

| case | ops |
|---|---|
| linear50 | GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1, RPC record_workflow_run ×1, POST workflow_logs ×1, PATCH workflow_runs ×1 |
| loop500 | GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1, RPC record_workflow_run ×1, POST workflow_logs ×1, PATCH workflow_runs ×1 |
| dataTable500 | POST custom_table_rows ×500, RPC enqueue_workflow_batch ×500, GET custom_tables ×2, GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1 |
| decision200 | GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1, GET decision_tables ×1, RPC record_workflow_run ×1, POST workflow_logs ×1 |
| callRef100 | GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1, GET integration_references ×1, RPC record_workflow_run ×1, POST workflow_logs ×1 |

- dataTable500 enqueued 3000 data_table_event jobs over 6 runs (deleted afterwards, not executed).
- Echo server received 600 requests.
- wall = executeWorkflow call; DB round trips include fire-and-forget writes that settle after it returns. DB time sums request durations (parallel requests overlap).

## api

_ran 2026-10-25T19:59:45.424Z in 5.3 s_

**API latency (200 sequential requests each after 5 warm-ups, tenant API key, ms)**

| request | p50 | p95 | max | mean | statuses | response bytes |
|---|---|---|---|---|---|---|
| GET /api/v1/workflows?active=false | 4.1 | 5.5 | 6.4 | 4.3 | 200×200 | 6191 |
| GET /api/v1/tasks | 7.7 | 8.9 | 9.5 | 7.9 | 200×200 | 35261 |
| GET /api/v1/me | 3.5 | 4.3 | 4.7 | 3.6 | 200×200 | 1251 |
| MCP tools/list | 2.8 | 3.7 | 5 | 2.9 | 200×200 | 133302 |
| MCP tools/call workflows_list | 4.9 | 6.4 | 13.6 | 5.1 | 200×200 | 10430 |

- MCP server exposes 162 tools; tools/call used workflows_list with no arguments.
