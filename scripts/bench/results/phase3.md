# Bench results: phase3

Updated 2026-10-24T21:56:22.657Z.

| Environment | |
|---|---|
| machine | Apple M1 Pro |
| cpus | 10 |
| memory_gb | 32 |
| os | darwin 27.0.0 arm64 |
| node | v20.19.5 |
| git_commit | 36383b92 |
| git_branch | perf |
| supabase_cli | 2.84.4 |
| postgres_server | 17.6 |
| docker | 28.3.2 |

## api

_ran 2026-10-24T21:56:23.696Z in 48.2 s_

**API latency (100 sequential requests each after 5 warm-ups, tenant API key, ms)**

| request | p50 | p95 | max | mean | statuses | response bytes |
|---|---|---|---|---|---|---|
| GET /api/v1/workflows?active=false | 82.2 | 93.1 | 101.2 | 83.1 | 200×100 | 6188 |
| GET /api/v1/tasks | 84.9 | 90.1 | 105.5 | 85.4 | 200×100 | 32025 |
| GET /api/v1/me | 80.6 | 90.6 | 106.7 | 81.5 | 200×100 | 1227 |
| MCP tools/list | 98.7 | 111.1 | 124.7 | 100.4 | 200×100 | 125796 |
| MCP tools/call workflows_list | 99.2 | 109.9 | 122.2 | 100.6 | 200×100 | 10263 |

- MCP server exposes 154 tools; tools/call used workflows_list with no arguments.

## db

_ran 2026-10-24T21:55:15.497Z in 0.5 s_

**Query plans (EXPLAIN ANALYZE, warm cache; authenticated = a member via RLS)**

| query | role | exec ms | seq scans | rows scanned / returned | fn calls | fn calls per scanned row (top) |
|---|---|---|---|---|---|---|
| tasks list for a user (newest 50) | authenticated | 36.31 | tasks | 70000 / 50 | 3 | 0 (public.get_current_tenant_id×2, public.rls_visible_tenant_ids×1) |
| tasks list for a user (newest 50) | service_role | 0.18 | none | 327 / 50 | 0 | 0 |
| runs list by workflow, newest 50 (select *) | authenticated | 0.32 | none | 50 / 50 | 2 | 0.04 (public.get_user_tenant_ids×1, public.rls_member_tenant_ids×1) |
| runs list by workflow, newest 50 (select *) | service_role | 0.07 | none | 50 / 50 | 0 | 0 |
| queue claim (claim_next_job SELECT … FOR UPDATE SKIP LOCKED) | authenticated | n/a (service only) | — | — | — | — |
| queue claim (claim_next_job SELECT … FOR UPDATE SKIP LOCKED) | service_role | 0.02 | none | 0 / 0 | 0 | 0 |
| task title ILIKE '%invoice 4%' (20) | authenticated | 40.81 | tasks | 70000 / 20 | 3 | 0 (public.get_current_tenant_id×2, public.rls_visible_tenant_ids×1) |
| task title ILIKE '%invoice 4%' (20) | service_role | 4.26 | none | 721 / 20 | 0 | 0 |
| workflow_logs for one run | authenticated | 0.16 | none | 10 / 10 | 3 | 0.3 (public.get_current_tenant_id×2, public.rls_visible_tenant_ids×1) |
| workflow_logs for one run | service_role | 0.01 | none | 10 / 10 | 0 | 0 |
| event_stream cursor read (101 after cursor) | authenticated | error: permission denied for table event_stream | — | — | — | — |
| event_stream cursor read (101 after cursor) | service_role | 0.04 | none | 101 / 101 | 0 | 0 |

- Plans saved in scripts/bench/results/phase3/plans/.
- Function calls = pg_stat_xact_user_functions delta (track_functions = all) for the EXPLAIN ANALYZE run.
