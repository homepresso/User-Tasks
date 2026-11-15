# On-premises gateway

How UserTasks (in particular the serverless, multi-tenant cloud edition) reaches systems behind a customer's firewall. Admin-facing usage is in the in-app docs (`/docs/integrations/gateways`); this document is the design, protocol, threat model and operations reference.

| Piece | Where | Licence |
|---|---|---|
| Protocol (signing, job shape, validation) | `lib/gateway/protocol.ts` — shared by cloud and gateway | Apache-2.0 |
| Cloud side: queue, gateway API, connection transport, admin service | `lib/gateway/*`, `app/api/gateway/v1/[...path]`, `lib/services/gateways.ts`, `/api/v1/gateways`, MCP `gateways_*`, CLI `usertasks gateways …`, Settings → On-premises gateways | Apache-2.0 |
| The gateway program | `packages/gateway` (one Node 20 file, no runtime dependencies; Windows service installer, Dockerfile) | Apache-2.0 |
| Per-workspace trusted embedding | `lib/embedding.ts`, `lib/embedding-token.ts`, `lib/embedding-server.ts`, `proxy.ts`, `/api/v1/workspace/embedding`, Settings → Trusted embedding | Apache-2.0 |
| Extension SDK | `ctx.gateways`, `ctx.embedding`, `ctx.workspaceUrl()`, `ExtensionConnection.gateway`, `PublicRoute` handler `via` | Apache-2.0 |
| Licence limits in the cloud | `lib/extensions/host.ts`: limit usage counted per workspace when limits come from the workspace's subscription | Apache-2.0 |
| SharePoint-specific use (gateway connection modes, add-in callbacks through the relay) | the private SharePoint extension | commercial |

The gateway is generic: any connector whose connection can name a transport (core `windows`-style connections, extension connectors) can go through it. Nothing in it knows about SharePoint.

## Why this shape

- **The cloud cannot dial in.** Customer farms sit on private networks; firewalls allow outbound HTTPS (often through a proxy) and nothing inbound.
- **Vercel functions cannot hold sockets.** No WebSockets, no long-lived TCP; a function lives at most `maxDuration` (60 s here). So the channel is **HTTPS long polling** against a **Postgres job queue**: the gateway keeps one poll open (≤ 25 s, then re-polls), each connector request is a row, answers are posted back. Alternatives considered: Azure Relay / ngrok-style tunnels (a third-party dependency and a second trust boundary that still needs per-tenant auth), Supabase Realtime (exposes the database's realtime channel to customer machines), WebSockets on a separate long-running service (a new always-on component outside the serverless deployment). The queue keeps everything inside the existing app and database, works identically self-hosted, and gives an audit trail for free.
- **Credentials stay on-prem.** The gateway authenticates to its targets with credentials it reads locally (a file or an environment variable, never `gateway.json`); the cloud connection holds none. The one exception is SharePoint high-trust: UserTasks signs the S2S token (the add-in key lives in UserTasks) and the gateway forwards that `Authorization` header only to targets configured `forwardAuthorization: true`.

## Protocol (v1)

All gateway → cloud requests go to `/api/gateway/v1/*` (one route file = one serverless function).

| Call | Auth | Purpose |
|---|---|---|
| `POST register` | one-time token (`utgwr_…`, 24 h, SHA-256 stored) | the instance sends its Ed25519 **public** key; gets its key id and the cloud's public key(s) |
| `POST poll` | signed | heartbeat (version, targets, relay URL, load, security events) + long poll; returns jobs |
| `POST jobs/<id>/result` | signed | the answer (status, headers, body inline ≤ 256 KB or in parts) |
| `PUT jobs/<id>/parts/<n>` / `GET jobs/<id>/request-parts/<n>` | signed | large bodies in 2 MB parts (under the 4.5 MB serverless body limit) |
| `POST relay` | signed | an inbound callback the gateway took on the customer network, dispatched to `/ext-public/<ext>/…` |
| `POST rotate` | signed (old key) | replace the instance key |
| `POST release` | signed | graceful stop: hand back claimed jobs not yet started |

**Request signature** (`x-utgw-key/timestamp/nonce/signature`): Ed25519 over `UTGW1-REQ \n METHOD \n path+query \n timestamp \n nonce \n sha256(body)`. The cloud refuses timestamps outside ±60 s and any nonce already seen for that key (`gateway_nonces`, unique), and keys that are not `active` or whose gateway is revoked. Refusals are recorded as gateway events.

**Response signature** (`x-utgw-cloud-key/signature`): Ed25519 over `UTGW1-RES \n status \n request nonce \n sha256(body)` with the cloud key (`GATEWAY_SIGNING_KEY`, or derived with HKDF from `ENCRYPTION_KEY`). The gateway discards any unsigned or mis-signed answer, so a TLS-inspecting proxy, a DNS hijack or someone able to write the jobs table cannot hand it work, and a recorded answer cannot be replayed for another request. Key roll: `GATEWAY_SIGNING_KEY_NEXT` is advertised inside signed answers; gateways start trusting it, then the operator swaps it in.

**Jobs never carry a URL.** A job is `{ target, method, path, headers, body, anonymous, expiresAt }`. The cloud maps a connection's origin onto the targets the gateway *advertised*; the gateway resolves the path against *its own* configured origin and refuses anything that leaves it, any path outside the target's `pathPrefixes`, any method not allowed, expired jobs, bodies over its limits. Hop-by-hop headers, `Host`, cookies and `x-utgw-*` are stripped on both sides; `Authorization` only reaches targets with `forwardAuthorization`. Redirects are returned to the cloud, which follows them as new jobs (credentials never cross origins — a cross-origin hop is sent `anonymous`).

**Queue semantics** (`gateway_jobs`, `claim_gateway_jobs` with `FOR UPDATE SKIP LOCKED`): an instance claims up to its free capacity under a 15 s lease. Leases are renewed **only by messages the instance itself sends** — the start of each poll, and a heartbeat every 5 s while it runs jobs — so a dead instance always loses its leases within 15 s (GET requests of callers with budgets above ~20 s survive a crash) (an earlier design that also renewed at the end of a long poll kept leases alive after a crash; caught in the lab). Lost leases: GET/HEAD/OPTIONS jobs are re-queued once for another instance; anything else fails with `gateway_instance_lost` (never executed twice). A graceful stop lets the poll in flight finish, runs its jobs, then calls `release`; a poll whose client disconnects hands its claims back immediately. The caller waits on its row (25 ms → 250 ms back-off) until its own deadline (default 120 s, max 300 s) and cancels the job if it gives up. An in-process wake-up bus removes the polling delay whenever the enqueue and the poll share a process (always self-hosted; often on Vercel Fluid compute).

**Connections.** `auth_config = { _transport: 'gateway', gateway_id, gateway_target? }`. The core transport (`lib/gateway/transport.ts`) is marked *remote*: `connectorFetch` skips the server's egress guard (the server never dials the URL) and the gateway's allowlist applies. "Gateway offline", "revoked" and "does not serve that address" fail immediately (not retried) and extension endpoints answer them with 502 / 503 instead of 500.

## Threat model (short)

| Threat | Mitigation |
|---|---|
| A tenant uses a gateway to reach arbitrary hosts in the customer network (SSRF / pivot) | Targets exist only in the customer's `gateway.json`; jobs name a target id + path; the gateway re-validates origin, path prefix and method; its egress shim refuses any host not configured (and link-local / metadata addresses) before a socket opens. Refusals are reported as `allowlist_refused` events. |
| Another workspace (or an attacker) drives someone's gateway | Gateways, keys and jobs are tenant-scoped; a connection can only name a gateway of its own workspace (checked on every request); keys authenticate the instance, not users. Relayed callbacks carry `via.tenantId`; the SharePoint handlers refuse records of another workspace. |
| Stolen registration token | Single use, 24 h, only its hash is stored; pending tokens can be revoked. |
| Stolen instance key (from the gateway host) | Per-instance keys; revoke in Settings (immediate: requests refused, in-flight jobs failed); rotation built in. The key only lets that machine take its own workspace's jobs. |
| TLS interception / network attacker between gateway and cloud | TLS; plus both directions signed and bound to nonces: no injection, no replay; stale timestamps refused. |
| Replay of a signed gateway request | Nonce table (unique per key) + ±60 s window. |
| Compromised cloud database writer | Cannot create work a gateway accepts without the cloud signing key (jobs only arrive in signed answers). Can read job metadata (bodies are not kept after delivery). |
| Compromised cloud (application + key) | Can ask the gateway for anything **within its allowlist** with its credentials — the customer bounds the blast radius with targets, `pathPrefixes`, `methods` and a least-privilege service account. Inherent to any connector. |
| Resource exhaustion | Body caps (64 MB hard, 50 MB default, configurable lower), per-instance concurrency, per-key rate limit (1,200 calls/min), relay body cap (1 MB default), relay source CIDR allowlist. |
| Inbound exposure on-prem (relay) | Off unless configured; only `/relay/ext-public/<configured prefixes>`; TLS unless `allowHttp` is set explicitly; source CIDRs; the cloud only dispatches `/ext-public/*` public routes, which keep their own secrets (SharePoint receiver URLs carry a secret). |
| Audit | Every job: tenant, gateway, instance, integration, target, method, path, status, sizes, timings (30 days). Gateway events (registrations, rotations, revocations, refused signatures, replays, allowlist refusals, revoked keys trying). Admin actions in the workspace audit log. |

## Per-workspace trusted embedding

The cloud is multi-tenant, so one instance-wide `EMBED_FRAME_ANCESTORS` cannot express "workspace A trusts A's SharePoint farm". With `EMBED_WORKSPACE_ORIGINS=true`:

- Each workspace stores its approved origins (`tenants.settings.embedding.frame_ancestors`; Settings → Trusted embedding, `PUT /api/v1/workspace/embedding`, MCP, CLI).
- Whenever UserTasks sends a browser to an embeddable page (`ctx.embedding.url('/embed/…')`, e.g. the SharePoint add-in launch redirect) it appends `ut_ea=<payload>.<HMAC>`: the workspace's subdomain, its origins, an expiry (1 h). Key: `EMBED_SIGNING_SECRET`, else HKDF from `ENCRYPTION_KEY`.
- `proxy.ts` verifies the token **without a database lookup** and sets `frame-ancestors 'self' <instance origins> <token origins>` only if the MAC matches, it has not expired and the request's Host is that workspace's own address. A token copied to another workspace's host, or forged, gives `'none'` + `X-Frame-Options: DENY`.
- **CSRF analysis.** Framed sessions need `SameSite=None` session cookies. The proxy cannot know per request which workspace embeds, so with the switch on the cookies are `SameSite=None; Secure` for everyone and the proxy's existing cookie stripping (`sessionCookiesAllowed`) runs on every request: it removes the session cookies from every cross-site request that `SameSite=Lax` would not have carried them on (POST/PUT/…, fetch/XHR, subresources, frames of non-embeddable routes), keeping only cross-site top-level GET navigations (as Lax does) and the framed GET of an `/embed/` route (what trusted embedding adds; `frame-ancestors` restricts who can frame it). CSRF properties therefore stay those of `SameSite=Lax` for every request, embedded or not; server actions additionally keep Next's Origin check. Without `Secure` cookies (plain http) nothing changes. Browsers that block third-party cookies (Safari) show the in-frame "Open UserTasks" sign-in, as before.

## Cloud deployment (coordinator)

1. Apply migration `20270114200000_onprem_gateways.sql` (additive, idempotent; service-role-only tables + the NOTIFY trigger; passes the migration-safety check).
2. Set `GATEWAY_LISTEN_DATABASE_URL` to the **direct / session** Supabase connection (port 5432, not the 6543 transaction pooler) so idle gateways cost one claim per poll; without it the queue falls back to back-off polling.
3. Environment (Vercel production): `ENCRYPTION_KEY` (already set) derives the gateway and embedding keys. Recommended: `GATEWAY_SIGNING_KEY` (a dedicated Ed25519 seed / PEM, so the gateway trust anchor is independent of the data key) and `EMBED_SIGNING_SECRET`. `EMBED_WORKSPACE_ORIGINS` (off by default) `=true` turns on per-workspace embedding **and** instance-wide `SameSite=None` session cookies with the proxy's Lax-equivalent stripping — deploy it separately and smoke-test sign-in flows. Optional `GATEWAY_MIN_VERSION` / `GATEWAY_LATEST_VERSION`.
4. `/api/gateway/v1/[...path]` sets `maxDuration = 60`. Fluid compute bills the 25 s waits as provisioned memory, not CPU — one held function per connected instance.
5. Publish the gateway: `npm run build -w @user-tasks/gateway` → a release zip with `usertasks-gateway.mjs` + `install/Install-UserTasksGateway.ps1` + README; a container image from `packages/gateway/Dockerfile`. Apache-2.0, no paid code.

## Capacity and cost

Each connected instance holds one function for up to 25 s at a time. Waking it is cheap:

- **With LISTEN / NOTIFY** (a session-level database connection: `GATEWAY_LISTEN_DATABASE_URL`, else `POSTGRES_URL_NON_POOLING` / `SUPABASE_DB_URL`, else `DATABASE_URL` with `DB_PROVIDER=postgres`): a trigger on `gateway_jobs` sends `NOTIFY usertasks_gateway, 'q:<gateway>'` when a job becomes claimable and `'j:<job>'` when it finishes; one listening connection per server process turns them into wake-ups. An idle long poll claims **once per 25 s poll**; a new job is claimed the moment its NOTIFY arrives; waiting callers re-read their job only on its NOTIFY (2 s safety re-check). Never point it at a transaction-mode pooler (Supabase 6543): LISTEN is silently dropped there.
- **Without** (transaction pooler only): claims back off from 250 ms to 4 s — about 9 claims per poll instead of 125 — and the first pick-up on an idle gateway can take up to 4 s. In-process wake-ups still short-cut both whenever the enqueue and the poll share a process.
- Each poll also writes the instance's heartbeat (last seen, status, lease renewal): 3–4 small writes per 25 s per instance.

`__tests__/gateway-queue-wakeups.test.ts` pins the counts (1 claim per idle poll with notifications, ≤ 10 without); the trigger and listener were checked against plain Postgres (both payloads received within 90 ms of the writes).

## Limits (v1)

- HTTP(S) only: LDAP/SMTP/SQL through the gateway are not supported (core LDAP directory sync cannot reach an on-prem AD from the cloud; the SharePoint directory source works because it uses SharePoint's own group expansion).
- Bodies up to 50 MB by default (64 MB hard cap), stored transiently in `gateway_job_parts`; no streaming.
- No automatic self-update (customer change control; would need code signing): the cloud advertises latest / minimum versions, instances below the minimum get no work, Settings shows "Update available".
