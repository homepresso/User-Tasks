# Bench results: phase1

Updated 2026-10-24T20:54:38.069Z.

| Environment | |
|---|---|
| machine | Apple M1 Pro |
| cpus | 10 |
| memory_gb | 32 |
| os | darwin 27.0.0 arm64 |
| node | v20.19.5 |
| git_commit | d72c1d65 |
| git_branch | perf |
| supabase_cli | 2.84.4 |
| postgres_server | 17.6 |
| docker | 28.3.2 |

## engine

_ran 2026-10-24T20:54:37.577Z in 23.8 s_

**Engine (in-process executeWorkflow, 3 reps after 1 warm-up)**

| case | wall p50 ms | wall max ms | DB round trips | DB time ms | rows written | external calls | queue kicks |
|---|---|---|---|---|---|---|---|
| 50-node linear | 21.2 | 38.8 | 6 | 26 | 54 | 0 | 0 |
| loop ×500 (set_variable + condition + functions) | 246.9 | 254.6 | 6 | 205 | 2507 | 0 | 0 |
| 500 data-table inserts (+ active data_table_event workflow) | 4617.1 | 4670 | 2507 | 4038 | 1006 | 0 | 500 |
| decision table in loop ×200 | 79 | 87.6 | 7 | 91 | 606 | 0 | 0 |
| call_reference ×100 (local echo) | 69.7 | 82.3 | 7 | 51 | 106 | 100 | 0 |

**Most frequent DB operations (last rep)**

| case | ops |
|---|---|
| linear50 | GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1, RPC record_workflow_run ×1, POST workflow_logs ×1, PATCH workflow_runs ×1 |
| loop500 | GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1, RPC record_workflow_run ×1, POST workflow_logs ×1, PATCH workflow_runs ×1 |
| dataTable500 | GET workflows ×501, GET workflow_versions ×501, GET custom_tables ×501, POST custom_table_rows ×500, RPC enqueue_workflow ×500, POST workflow_runs ×1 |
| decision200 | GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1, GET decision_tables ×1, RPC record_workflow_run ×1, POST workflow_logs ×1 |
| callRef100 | GET workflows ×1, GET workflow_versions ×1, POST workflow_runs ×1, GET integration_references ×1, RPC record_workflow_run ×1, POST workflow_logs ×1 |

- dataTable500 enqueued 2000 data_table_event jobs over 4 runs (deleted afterwards, not executed).
- Echo server received 400 requests.
- wall = executeWorkflow call; DB round trips include fire-and-forget writes that settle after it returns. DB time sums request durations (parallel requests overlap).

## probes

_ran 2026-10-24T20:54:38.607Z in 0.5 s_

**Correctness probes**

| probe | observed | verdict |
|---|---|---|
| delay node, 45 s (cap 30 s) | run waiting_for_event in 14 ms; node output {"delay_ms":45000,"resume_at":"2026-10-24T20:55:22.611Z"} | ok: run waited/paused |
| {{=UPPER(probe)}} vs "x {{=UPPER(probe)}}" | variable read 1× vs 1× | ok: evaluated once |

**resolveExpression cost (µs/call, ctx with 200 variables)**

| expression | µs/call |
|---|---|
| plain text, no {{ | 0.05 |
| "Hello {{name}}" | 0.7 |
| {{=UPPER(CONCAT("a", name))}} (whole string) | 2.46 |
| x {{=UPPER(CONCAT("a", name))}} (mixed) | 2.37 |
