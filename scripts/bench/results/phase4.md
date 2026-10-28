# Bench results: phase4

Updated 2026-10-24T22:30:13.659Z.

| Environment | |
|---|---|
| machine | Apple M1 Pro |
| cpus | 10 |
| memory_gb | 32 |
| os | darwin 27.0.0 arm64 |
| node | v20.19.5 |
| git_commit | cfbf4ef4 |
| git_branch | perf |
| supabase_cli | 2.84.4 |
| postgres_server | 17.6 |
| docker | 28.3.2 |

## api

_ran 2026-10-24T22:30:14.198Z in 3.4 s_

**API latency (100 sequential requests each after 5 warm-ups, tenant API key, ms)**

| request | p50 | p95 | max | mean | statuses | response bytes |
|---|---|---|---|---|---|---|
| GET /api/v1/workflows?active=false | 5 | 8.1 | 23.2 | 5.6 | 200×100 | 6188 |
| GET /api/v1/tasks | 8.2 | 9.1 | 9.6 | 8.3 | 200×100 | 32025 |
| GET /api/v1/me | 3.8 | 5.1 | 5.3 | 3.9 | 200×100 | 1227 |
| MCP tools/list | 2.9 | 3.8 | 4.7 | 3 | 200×100 | 125796 |
| MCP tools/call workflows_list | 5.5 | 6.6 | 7.3 | 5.6 | 200×100 | 10263 |

- MCP server exposes 154 tools; tools/call used workflows_list with no arguments.

## size

_ran 2026-10-24T22:30:09.643Z in 39.7 s_

**Build & install size**

| measure | value |
|---|---|
| client JS chunks (count) | 122 |
| client JS total MB (gzip MB) | 7.6 (2) |
| client CSS KB | 130 |
| .next/server MB | 203.5 |
| .next/standalone MB | — |
| node_modules MB | 936.5 |
| Docker image MB | — |
| next build s | 38.4 |

**Largest client chunks**

| chunk | KB | gzip KB | contains |
|---|---|---|---|
| 02doau-b9shzp.js | 448 | 91 | lucide |
| 0rvqm0vktswnk.js | 402 | 137 | xlsx |
| 0bg7j_21khcgs.js | 392 | 104 | zod |
| 0fdd0dewb8q9p.js | 357 | 103 | recharts |
| 0kyeyc8kobkan.js | 357 | 103 | recharts |
| 0zht_fixubbj5.js | 357 | 103 | recharts |
| 0373j2_9j8zqo.js | 278 | 63 | zod |
| 094dst-w3ehr6.js | 278 | 63 | zod |
| 0hu8~auz-vcxm.js | 271 | 48 | — |
| 0zgqc.pptxdm2.js | 271 | 48 | — |

- Docker image not built (pass --docker).
