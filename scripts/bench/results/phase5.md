# Bench results: phase5

Updated 2026-10-24T22:39:19.039Z.

| Environment | |
|---|---|
| machine | Apple M1 Pro |
| cpus | 10 |
| memory_gb | 32 |
| os | darwin 27.0.0 arm64 |
| node | v20.19.5 |
| git_commit | 07edfb49 |
| git_branch | perf |
| supabase_cli | 2.84.4 |
| postgres_server | 17.6 |
| docker | 28.3.2 |

## api

_ran 2026-10-24T22:39:19.595Z in 3.3 s_

**API latency (100 sequential requests each after 5 warm-ups, tenant API key, ms)**

| request | p50 | p95 | max | mean | statuses | response bytes |
|---|---|---|---|---|---|---|
| GET /api/v1/workflows?active=false | 5.1 | 7.8 | 36 | 5.6 | 200×100 | 6188 |
| GET /api/v1/tasks | 8.2 | 9.5 | 13.2 | 8.3 | 200×100 | 32025 |
| GET /api/v1/me | 3.5 | 4.3 | 6.3 | 3.6 | 200×100 | 1227 |
| MCP tools/list | 3 | 4 | 5.4 | 3.1 | 200×100 | 125796 |
| MCP tools/call workflows_list | 5.2 | 6.2 | 7.4 | 5.3 | 200×100 | 10263 |

- MCP server exposes 154 tools; tools/call used workflows_list with no arguments.

## size

_ran 2026-10-24T22:39:15.110Z in 38.1 s_

**Build & install size**

| measure | value |
|---|---|
| client JS chunks (count) | 119 |
| client JS total MB (gzip MB) | 5.6 (1.5) |
| client CSS KB | 130 |
| .next/server MB | 192.6 |
| .next/standalone MB | — |
| node_modules MB | 936.5 |
| Docker image MB | — |
| next build s | 37.4 |

**Largest client chunks**

| chunk | KB | gzip KB | contains |
|---|---|---|---|
| 0if-x5oj2~_pg.js | 528 | 135 | recharts |
| 0nh4cb5o-kkxh.js | 271 | 47 | lucide |
| 0hu8~auz-vcxm.js | 271 | 48 | — |
| 0zgqc.pptxdm2.js | 271 | 48 | — |
| 0xsf6fbo-gt1-.js | 259 | 64 | react-query |
| 14pofykpskj6v.js | 221 | 69 | react-dom |
| 177sbmcti1xvy.js | 219 | 58 | supabase-js |
| 05.kvpg-~bzxy.js | 146 | 37 | lucide |
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
| /settings/api-keys | 1146 | 312 | 19 |
| /docs/api-explorer | 723 | 197 | 13 |
| /tasks | 1117 | 319 | 20 |

- Docker image not built (pass --docker).
