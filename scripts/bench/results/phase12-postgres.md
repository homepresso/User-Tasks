# Bench results: phase12-postgres

Updated 2026-10-26T15:53:35.678Z.

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

_ran 2026-10-26T15:53:31.003Z in 12.7 s_

**Engine (in-process executeWorkflow, 3 reps after 1 warm-up)**

| case | wall p50 ms | wall max ms | DB round trips | DB time ms | rows written | external calls | queue kicks |
|---|---|---|---|---|---|---|---|
| 50-node linear | 28.1 | 40 | 0 | 0 | 0 | 0 | 0 |
| loop ×500 (set_variable + condition + functions) | 217.3 | 258.6 | 0 | 0 | 0 | 0 | 0 |
| 500 data-table inserts (+ active data_table_event workflow) | 1778.6 | 1791.6 | 0 | 0 | 0 | 0 | 500 |
| decision table in loop ×200 | 96.7 | 102.6 | 0 | 0 | 0 | 0 | 0 |
| call_reference ×100 (local echo) | 81.6 | 94 | 0 | 0 | 0 | 100 | 0 |

**Most frequent DB operations (last rep)**

| case | ops |
|---|---|
| linear50 |  |
| loop500 |  |
| dataTable500 |  |
| decision200 |  |
| callRef100 |  |

- dataTable500 enqueued 2000 data_table_event jobs over 4 runs (deleted afterwards, not executed).
- Echo server received 400 requests.
- wall = executeWorkflow call; DB round trips include fire-and-forget writes that settle after it returns. DB time sums request durations (parallel requests overlap).

## api

_ran 2026-10-26T15:53:37.080Z in 3.6 s_

**API latency (100 sequential requests each after 5 warm-ups, tenant API key, ms)**

| request | p50 | p95 | max | mean | statuses | response bytes |
|---|---|---|---|---|---|---|
| GET /api/v1/workflows?active=false | 5.4 | 8.3 | 13.4 | 5.6 | 200×100 | 6194 |
| GET /api/v1/tasks | 7.3 | 9 | 10.7 | 7.6 | 200×100 | 35411 |
| GET /api/v1/me | 3.6 | 4.9 | 5.2 | 3.7 | 200×100 | 1251 |
| MCP tools/list | 3 | 4 | 5 | 3.1 | 200×100 | 133302 |
| MCP tools/call workflows_list | 5.5 | 7.2 | 8.7 | 5.6 | 200×100 | 10429 |

- MCP server exposes 162 tools; tools/call used workflows_list with no arguments.

> Note (providers phase 12): recorded on a second, disposable local Supabase
> stack (ports 553xx, full seed) with the same build for both runs;
> `phase12-postgres` used `DB_PROVIDER=postgres` (pg-query over DATABASE_URL).
> Compared with `phase3-supabase` / `phase3-postgres`: API p50s within ±1 ms,
> engine cases within run-to-run noise (±15%; the engine runs in-process and
> phase 12 changed no runtime code paths). No regressions. pg-query bypasses
> the global `fetch`, so its DB round-trip columns read 0.
