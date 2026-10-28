# Bench results: phase6

Updated 2026-10-24T23:16:21.942Z.

| Environment | |
|---|---|
| machine | Apple M1 Pro |
| cpus | 10 |
| memory_gb | 32 |
| os | darwin 27.0.0 arm64 |
| node | v20.19.5 |
| git_commit | bce7a20d |
| git_branch | perf |
| supabase_cli | 2.122.0 |
| postgres_server | 17.6 |
| docker | 28.3.2 |

## size

_ran 2026-10-24T23:16:26.939Z in 134.6 s_

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
| next build s | 37.2 |

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
