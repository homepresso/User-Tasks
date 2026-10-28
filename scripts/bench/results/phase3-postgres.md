# Bench results: phase3-postgres

Updated 2026-10-25T20:00:15.957Z.

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

_ran 2026-10-25T20:00:09.741Z in 21.1 s_

**Engine (in-process executeWorkflow, 5 reps after 1 warm-up)**

| case | wall p50 ms | wall max ms | DB round trips | DB time ms | rows written | external calls | queue kicks |
|---|---|---|---|---|---|---|---|
| 50-node linear | 40 | 49.2 | 0 | 0 | 0 | 0 | 0 |
| loop ×500 (set_variable + condition + functions) | 226.1 | 246.5 | 0 | 0 | 0 | 0 | 0 |
| 500 data-table inserts (+ active data_table_event workflow) | 2063.1 | 2786.4 | 0 | 0 | 0 | 0 | 500 |
| decision table in loop ×200 | 83.9 | 91.5 | 0 | 0 | 0 | 0 | 0 |
| call_reference ×100 (local echo) | 82.4 | 86.8 | 0 | 0 | 0 | 100 | 0 |

**Most frequent DB operations (last rep)**

| case | ops |
|---|---|
| linear50 |  |
| loop500 |  |
| dataTable500 |  |
| decision200 |  |
| callRef100 |  |

- dataTable500 enqueued 3000 data_table_event jobs over 6 runs (deleted afterwards, not executed).
- Echo server received 600 requests.
- wall = executeWorkflow call; DB round trips include fire-and-forget writes that settle after it returns. DB time sums request durations (parallel requests overlap).

## api

_ran 2026-10-25T20:00:17.104Z in 5.5 s_

**API latency (200 sequential requests each after 5 warm-ups, tenant API key, ms)**

| request | p50 | p95 | max | mean | statuses | response bytes |
|---|---|---|---|---|---|---|
| GET /api/v1/workflows?active=false | 5 | 6.3 | 8.7 | 5 | 200×200 | 6192 |
| GET /api/v1/tasks | 7.2 | 8.2 | 8.8 | 7.3 | 200×200 | 35261 |
| GET /api/v1/me | 3.5 | 4.9 | 10.5 | 3.7 | 200×200 | 1251 |
| MCP tools/list | 2.7 | 3.6 | 5.3 | 2.8 | 200×200 | 133302 |
| MCP tools/call workflows_list | 5.6 | 7.5 | 14.2 | 5.8 | 200×200 | 10432 |

- MCP server exposes 162 tools; tools/call used workflows_list with no arguments.

> Note (phase 3): this run used `DB_PROVIDER=postgres` (pg-query over
> DATABASE_URL) on the same build and seed as `phase3-supabase`. The engine
> suite's "DB round trips / DB time / rows written" columns count requests
> through the global `fetch`, which pg-query bypasses, so they read 0 here;
> compare the wall-clock columns. Recorded before the phase 3 commits (git_commit
> shows the base).
