# Bench results: phase2

Updated 2026-10-24T21:34:32.920Z.

| Environment | |
|---|---|
| machine | Apple M1 Pro |
| cpus | 10 |
| memory_gb | 32 |
| os | darwin 27.0.0 arm64 |
| node | v20.19.5 |
| git_commit | e19327b2 |
| git_branch | perf |
| supabase_cli | 2.84.4 |
| postgres_server | 17.6 |
| docker | 28.3.2 |

## engine

_ran 2026-10-24T21:34:26.491Z in 18.2 s_

**Engine (in-process executeWorkflow, 3 reps after 1 warm-up)**

| case | wall p50 ms | wall max ms | DB round trips | DB time ms | rows written | external calls | queue kicks |
|---|---|---|---|---|---|---|---|
| 50-node linear | 22.2 | 23.9 | 6 | 36 | 54 | 0 | 0 |
| loop ×500 (set_variable + condition + functions) | 247.5 | 258 | 6 | 256 | 2507 | 0 | 0 |
| 500 data-table inserts (+ active data_table_event workflow) | 2261.1 | 3339.7 | 1008 | 1964 | 1006 | 0 | 500 |
| decision table in loop ×200 | 87.8 | 104.8 | 7 | 115 | 606 | 0 | 0 |
| call_reference ×100 (local echo) | 62.8 | 63 | 7 | 43 | 106 | 100 | 0 |

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

## queue

_ran 2026-10-24T21:34:33.560Z in 6.4 s_

**Single job latency (10 samples unless noted, ms)**

| scenario | start p50 | start p95 | start max | complete p50 | complete max |
|---|---|---|---|---|---|
| 1 job, enqueue + kickQueueProcessor() | 6.2 | 10.2 | 10.2 | 19.2 | 36.3 |
| 1 job, processor invoked directly | 2.1 | 5.8 | 5.8 | 16.9 | 18.9 |
| 1 job, pg_cron only (no kick) — expected | 30000 | 57000 | 60000 | — | — |

**200-job burst (5-node workflow)**

| scenario | enqueue → all done ms | jobs/s | start p50 ms | start max ms | failed |
|---|---|---|---|---|---|
| 200 jobs, kickQueueProcessor() after each enqueue (+ cron) | 952 | 210.1 | 264.7 | 513.5 | 0 |
| 200 jobs, one kickQueueProcessor() after the last enqueue (no cron) | 996 | 200.8 | 477.8 | 806.3 | 0 |
| 200 jobs, processor direct, 1 worker (batch 20) | 1224 | 163.4 | 431.9 | 959.8 | 0 |
| 200 jobs, processor direct, 4 concurrent workers | 2030 | 98.5 | 830.4 | 1520.4 | 0 |

- pg_cron-only single-job latency is not measured without --slow: a job waits for the next minute tick (uniform 0–60 s, mean 30 s).
- Latencies come from workflow_queue timestamps (created_at → started_at / completed_at), so they include claim and run time but not the enqueue round trip.
