# Self-hosting UserTasks

UserTasks is a Next.js application backed by Supabase (Postgres, Auth,
Storage, Vault, pg_cron and pg_net). Self-hosting means running the Next.js
app yourself and pointing it at a Supabase project you control, either on
supabase.com or a self-hosted Supabase stack.

This is the starting point for every install: on Supabase, with no provider
settings. Supabase is an excellent platform and our recommended way to run
UserTasks. The other free standard stack is the bundled one: PostgreSQL,
sign-in, files, live updates and the worker, all installed with UserTasks
(the one-line installer's default).

If you'd like to use other services, each infrastructure area (database,
auth, storage, realtime, scheduler, email APIs, secrets, KMS, cache) can move
to AWS, Azure, Google Cloud or your own servers, one area at a time. Use the
[Infrastructure add-on](infrastructure-add-on.md), a paid extension,
whenever you're ready: `usertasks-admin switch` or Settings → Infrastructure.
The free edition runs any configuration, including installs that moved
services with v0.2.0 / v0.3.0.
[Choose your topology](topologies/README.md) helps you decide where each one
should run, and [Choosing each service](services/README.md) lists the options.

Requirements: Node.js 22 LTS (20.18.1 or later works, with an `EBADENGINE`
warning from one package) and Docker. Building the Docker image needs about
10 GB of memory for Docker ([Deployment profiles: Memory](deployment-profiles.md#memory));
running from source doesn't build anything in Docker.

Just want it running on your own computer? From a checkout, `npm run setup:local`
does everything below for a local Supabase in Docker (sections 1–3: start the
stack, apply migrations, write `.env.local` with fresh secrets, store the cron
secret in Vault), then `npm run dev`. It works in PowerShell, cmd, bash and
zsh, is safe to re-run, never overwrites values already in `.env.local` and
never prints secrets; `--reset` (after a confirmation) rebuilds the local
database from scratch. Beginners: [/docs/self-hosting/quick-start](/docs/self-hosting/quick-start).

New to self-hosting? The step-by-step guide on the docs site walks through
choosing how to run it, installing, creating your admin account at `/setup`,
inviting people, the CLI, updates, backups and troubleshooting:
[/docs/self-hosting/choose](/docs/self-hosting/choose).

## 1. Supabase project

1. Create a project on supabase.com, or run a local stack with
   `npx supabase start` (`supabase/config.toml` is in the repository, so no
   `supabase init`; `npm run setup:local` does this and the steps below).
2. Enable the `pg_cron` and `pg_net` extensions (Database → Extensions).
   The cron migration also runs `create extension if not exists` for both.
3. Apply the migrations. Hosted project (moving from a local stack with data? See
   [Move from your local Supabase to Supabase Cloud](https://usertasks.com/docs/self-hosting/local-to-supabase-cloud)):

   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push --linked
   ```

   Local stack: `npx supabase start` applies `supabase/migrations/` to a new
   database; `npx supabase migration up` applies new ones to an existing
   database (data kept) and `npx supabase db reset` rebuilds it from scratch
   (data lost).

   This builds the whole schema from scratch: baseline, `auth.users`
   trigger, pg_cron jobs, the public `task-files` and `logos` Storage buckets
   with their policies, Realtime publication membership, and the strip-back
   migration. See [migrations.md](migrations.md).
4. Regenerate the TypeScript types if you change the schema:
   `npm run db:types:local` (local stack) or `npm run db:types` (linked
   project).

## 2. Environment

Copy `.env.example` to `.env.local` (for `npm run dev` / `npm start`) or to
`.env` (for Docker Compose) and fill it in (`npm run setup:local` writes
`.env.local` for a local stack). The minimum is:

| Variable | Notes |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Read at runtime and passed to the browser by the server (restart, no rebuild, after changing them). `SUPABASE_URL` / `SUPABASE_ANON_KEY` take precedence when set. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. |
| `NEXT_PUBLIC_APP_URL` | The public origin users and pg_cron reach the app on (`APP_URL` takes precedence when set). |
| `CRON_SECRET` | Shared with pg_cron through Vault (below). |
| `ENCRYPTION_KEY` | Encrypts stored connector secrets. Without it they are stored in plaintext. |
| `WORKFLOW_SIGNING_SECRET` | Optional. Signs queued workflow resumes (a run continuing after a user task) and run initiators. When unset a key is derived from `ENCRYPTION_KEY` (else the service-role key is used), so set at least one of the three. |

`DEPLOYMENT_MODE` defaults to `self_hosted` when unset. In that mode the
marketing pages, contact form and self-signup are disabled, `/robots.txt`
disallows all crawling, the sitemap is empty, and `/` redirects to `/tasks`
(signed in) or `/login` — or to `/setup` while the install has no admin
account yet ([First admin account](#4-first-admin-account)). Some of these routes are statically rendered, so
set `DEPLOYMENT_MODE` (and the app URL, used for Open Graph and sitemap
links) at build time as well as at runtime.

`USERTASKS_BETA` (`on` / `off`, read at runtime) controls the beta lines in
the getting-started welcome ("thank you for joining the beta"). Unset, they
show in cloud mode only. In-app **Send feedback** is offered only when the
contact pipeline (`CHIRPME_API_KEY`, `CHIRPME_CHANNEL_ID`) is configured, or
when `TEAM_REQUESTS_ENABLED=true` keeps each request as a row that instance
admins read in **Settings → Requests** (on by default in cloud mode only).

### Your own address (https://tasks.example.com)

Moving from `http://localhost:3000` to a domain name takes four steps; the
beginner's walkthrough, with Caddy, nginx + certbot, Helm and Compose
examples, is [Give your install a friendly address](https://usertasks.com/docs/self-hosting/friendly-address).

1. **DNS**: an `A` / `AAAA` record (or a `CNAME` to your load balancer) for
   `tasks.example.com` pointing at the server.
2. **HTTPS**: a reverse proxy in front of port 3000 that holds the
   certificate, passes the original `Host` header, sets `X-Forwarded-Proto` /
   `X-Forwarded-For` (appending; the client address is read from its right
   end, one hop per proxy — set `TRUSTED_PROXY_HOPS` when more than one proxy
   appends, e.g. `2` for a CDN plus nginx), doesn't buffer Server-Sent Events (nginx:
   `proxy_buffering off;` and a long `proxy_read_timeout`) and accepts the
   upload size below. With Docker Compose, `APP_PORT=127.0.0.1:3000` keeps
   the app's port off the network so only the proxy reaches it. Serve
   HTTP/2: every open UserTasks page holds a live-update (SSE) connection,
   and over HTTP/1.1 browsers allow six per address, so several open tabs
   make saves and page loads queue (hidden tabs release theirs after 30 s).
3. **`APP_URL` and `NEXT_PUBLIC_APP_URL`** set to `https://tasks.example.com`.
   The server reads `APP_URL` at runtime (restart); `NEXT_PUBLIC_APP_URL` is
   also read at build time (a Docker build arg), so rebuild as well.
4. **Things that remember the old address**: OIDC redirect URIs
   (`<APP_URL>/auth/sso/<id>/callback`), SAML ACS and the default SP entity
   ID (`<APP_URL>/auth/saml/<id>/…`), the Supabase Auth Site URL and Redirect
   URLs (`<APP_URL>/auth/callback`), OAuth connector redirect URIs
   (`<APP_URL>/api/connectors/oauth/callback`), `usertasks login --url`,
   inbound webhooks, and the pg_cron `app_base_url` Vault secret
   (`npm run scheduler -- install-pg-cron --base-url <APP_URL>`). The app
   doesn't redirect other host names to `APP_URL`.

### Workspace addresses (optional)

Each workspace can have its own address, `acme.example.com`, and every
reusable form a friendly link on it, `acme.example.com/form/<system name>`.
They are off on a self-hosted install until you set a base domain:

| Variable | Notes |
|----------|-------|
| `APP_BASE_DOMAIN` | The domain workspace addresses live under, e.g. `example.com` (then `acme.example.com`). The cloud edition defaults to the `APP_URL` host (`www.` / `app.` stripped). `off` turns addresses off. Use the `APP_URL` host (or its parent when `APP_URL` is `www.` / `app.`): any other name one level under the base domain, `tasks` in `tasks.example.com` included, is read as a workspace address. |

What it needs (instance admins: **Settings → Workspace DNS** shows the
records for your base domain and checks DNS, the certificate and whether the
app answers):

1. **Wildcard DNS**: `*.example.com` pointing at the app (a CNAME to your
   load balancer, or an A / AAAA record), next to the apex record you already
   have.
2. **Wildcard TLS**: a certificate for `*.example.com` as well as
   `example.com`. A wildcard certificate can only be issued through a DNS-01
   challenge (Let's Encrypt and most ACME CAs refuse HTTP-01 for wildcards),
   so your certificate tooling (cert-manager, Caddy, Traefik, your load
   balancer) needs API access to the DNS zone, or you upload a purchased
   wildcard certificate.
3. **The proxy in front of the app forwards the original `Host`** header
   (Next.js resolves the workspace from it). The apex, `www.` and `app.`
   keep working as before.
4. **Nothing else served under the base domain.** With addresses on, the
   session cookie is scoped to `Domain=example.com` (`__Secure-ut_session`
   for built-in auth, `__Secure-sb-ut-auth-token` for Supabase Auth; HttpOnly,
   Secure, SameSite=Lax) so one sign-in works on every workspace address and
   one sign-out clears it everywhere. Every host under the base domain
   receives that cookie: don't host a blog, status page or anything
   third-party on `*.example.com` — use a separate domain for those, or a
   dedicated base domain (`APP_BASE_DOMAIN=tasks.example.com`) for the app.
   Sharing needs https; on plain http (local development) each address keeps
   its own host-only session.
5. **Sign-in stays on the apex.** A signed-out visitor of
   `acme.example.com/…` is sent to `example.com/login` and back afterwards,
   so OIDC / SAML redirect URIs and the Supabase Auth redirect allow-list
   need no wildcard entries.

On Vercel with the domain's DNS at GoDaddy: add `*.example.com` to the
Vercel project (Settings → Domains), then either switch the nameservers to
`ns1.vercel-dns.com` / `ns2.vercel-dns.com` in GoDaddy (DNS → Nameservers →
Change Nameservers → "I'll use my own nameservers") after exporting the zone
file and importing every record (MX, TXT, Microsoft 365 CNAMEs) into Vercel,
or keep GoDaddy DNS and add `CNAME *` → `cname.vercel-dns.com` plus `NS`
records `_acme-challenge` → `ns1.vercel-dns.com` and `ns2.vercel-dns.com`.
Vercel only documents the nameserver route for wildcard certificates.

Local development: `APP_BASE_DOMAIN=localhost`, then open
`http://acme.localhost:3000` (browsers resolve `*.localhost` to 127.0.0.1).
Sign in on that address itself: browsers don't share cookies between
`localhost` and its subdomains.

Queue tuning (optional): `WORKFLOW_CONCURRENCY` (jobs one processor
invocation runs at once, default 5), `WORKFLOW_PROCESSOR_BUDGET_MS` (how long
it keeps starting jobs, default 50 000) and `QUEUE_RETENTION_DAYS` (finished
queue rows kept by the daily cleanup, default 7). Enqueuing code kicks the
processor right away (at most one kick in flight per server instance); the
per-minute scheduler tick is the safety net.

## 3. Scheduled jobs (pg_cron + Vault)

Background work (schedule triggers, the workflow and agent queues, SLA
checks, reminders, escalations, the deletion queue, retention, log cleanup,
log export shipping, GitHub sync, directory sync and OAuth token refresh) runs
when pg_cron calls the app through `app_cron.invoke_endpoint`. That function
reads two Vault secrets at call time. Create them once in the SQL editor:

```sql
select vault.create_secret('<same value as CRON_SECRET>', 'cron_secret',
  'Bearer secret for usertasks cron endpoints');
select vault.create_secret('https://tasks.example.com', 'app_base_url',
  'Public base URL of the UserTasks app');
```

For a local stack, `npm run setup:local` stores both (`app_base_url` =
`http://host.docker.internal:3000`, `cron_secret` = `CRON_SECRET` from
`.env.local`). Or let the app do it from its own configuration:
`DATABASE_URL=… npm run scheduler -- install-pg-cron` (idempotent). Without
pg_cron or Vault, use the built-in worker or an external scheduler instead —
see [Infrastructure and providers](infrastructure.md#scheduler).

If you set `WORKFLOW_PROCESSOR_SECRET`, the app accepts only that value, so
`cron_secret` must hold it instead of `CRON_SECRET`. The URL must be
reachable from the database: for a local stack and an app on your machine,
use `http://host.docker.internal:3000`.

pg_cron runs three jobs, created by
`supabase/migrations/20261103100000_cron_consolidation.sql` and
`20261109500000_instance_housekeeping.sql` (both re-runnable):

| Job | Schedule | What it does |
|-----|----------|--------------|
| `usertasks-tick` | every minute | `POST /api/cron/tick`: the app runs every job below that is due in that minute, in-process |
| `usertasks-housekeeping` | every 15 min | Pure SQL (`app_cron.run_housekeeping()`): when the housekeeping interval (default hourly) is due, deletes `cron.job_run_details` older than 1 day, `net._http_response` older than 1 hour and expired cache / sign-in rows — see [Housekeeping](infrastructure.md#housekeeping) |
| `usertasks-cron-housekeeping` | daily 03:30 UTC | The same pass, forced, with a larger time budget (catch-up) |

The jobs the tick runs are defined in `lib/jobs/registry.ts` (times are UTC):

| Cadence | Jobs | Skipped when |
|---------|------|--------------|
| Every minute | process-schedules | no active schedule-triggered workflow |
| | process-workflows | no runnable `workflow_queue` job |
| | process-agents | no pending or processing `agent_queue` job |
| | process-media | no due or processing `media_jobs` job (long media steps, provider jobs being polled) |
| | esign-poll | no due or processing `esign_waits` row (Wait for Signature steps: polling fallback, timeouts) |
| | github-sync-push | no enabled GitHub sync connection and no pending sync run |
| | github-sync-deploy | no pending or running GitHub deployment |
| | ship-events | no enabled log destination |
| | provider-switches | no provider switch queued from Settings → Infrastructure (or interrupted), no long-running process / `DATABASE_URL`, or no licensed [Infrastructure add-on](infrastructure-add-on.md) |
| | report-rollups | no queued rollup rebuild, every workspace backfilled and none due its hourly reconcile ([Query settings](query-settings.md#how-the-flat-tables-stay-correct)) |
| Every 5 min | process-sla | no active run with an SLA |
| | process-reminders | no unsent task reminder |
| | process-escalations | no pending task escalation |
| Every 10 min | process-deletions | empty deletion queue |
| | directory-sync | no enabled Entra / Okta / LDAP / Google Workspace connector and no pending sync run |
| | oauth-refresh | no enabled connector with an OAuth token expiry |
| | cache-sweep | the cache provider isn't `postgres` (a no-op run) |
| Every 15 min | housekeeping | the scheduler is `pg_cron` (the database runs it), or the interval isn't due |
| Daily | process-retention (03:00), cleanup-logs (04:00) | never |
| | housekeeping-daily (03:30) | the scheduler is `pg_cron` |

The "skipped when" checks are one query per tick (`cron_tick_probe()`). A
tick runs up to `CRON_TICK_CONCURRENCY` jobs at once (default 4) and stops
starting jobs after 50 s; each job has its own time budget. A tick that
finds the previous one still running skips its minute (lease in
`app_cron.tick_lock`). A daily job whose minute was skipped runs on a later
tick the same day (within 6 hours). The last run of each job is in
`app_cron.tick_runs`:

```sql
select job_name, last_started_at, last_status, last_duration_ms, last_error
  from app_cron.tick_runs order by job_name;
```

Every job keeps its own endpoint (`/api/cron/process-schedules`,
`/api/workflows/process`, `/api/cron/ship-events`, …), so an external
scheduler can still call them individually with the same secret.

Why one job: with `cron.use_background_workers = off`,
every pg_cron run opens a new database connection. The 14 jobs the
earlier migrations scheduled meant about 7 connections a minute, plus an
ever-growing `cron.job_run_details`; on a small instance memory crept up
until runs failed with "job startup timeout". Do not re-run
`20261015000002_cron_jobs.sql` or the last block of
`20261024000003_log_shipper.sql`: they bring the old jobs back. If you did,
re-run `20261103100000_cron_consolidation.sql`.

The migration succeeds before the Vault secrets exist; until they do, each
tick fails fast with "vault secrets app_base_url / cron_secret are not
configured" in `cron.job_run_details` and does nothing.

Check the jobs with `select jobname, schedule from cron.job order by jobname;`
and recent calls in `net._http_response`.

`vercel.json` also declares three daily Vercel crons (log cleanup, retention,
deletions). They are a fallback for Vercel deployments only; pg_cron is the
primary scheduler and the only one that runs the per-minute queues.

## 4. First admin account

Self-signup is disabled in `self_hosted` mode. A new install has no
workspaces and no users, so the app sends every visitor (`/`, `/login`,
the app pages) to the **Create your admin account** screen at `/setup`.
Open the app's address and fill it in:

- **Organisation name.** The URL slug is made from it, shown, and can be
  edited. People type the slug in the **Organisation** field on the login
  page.
- **Your name, email and password.** The password needs at least 8
  characters and at most 72 bytes.
- **Setup code** (below).

Submitting creates the workspace and its owner (the same provisioning as
`npm run bootstrap`), signs you in and opens `/onboarding`. After that
`/setup` redirects to `/login`. Invite further users from
Settings → Members & invites. The cloud edition has no `/setup`.

### The setup code

The setup code stops a stranger from claiming a fresh install that is
reachable from the internet. The server prints it to its log at startup,
and again whenever `/setup` is opened while setup is needed:

```text
UserTasks setup code: ABCD-EFGH-JKLM (open /setup to create the admin account)
```

Where to find it:

| Running with | Where |
|---|---|
| `npm run dev` / `npm start` | The terminal running it |
| Docker Compose | `docker compose logs app \| grep "setup code"` |
| Kubernetes (Helm) | `kubectl -n <namespace> logs -l app.kubernetes.io/instance=<release>,app.kubernetes.io/component=app --tail=-1 \| grep "setup code"`: the app has two replicas by default and only one prints the code |
| Air-gapped bundle | `./bundle.sh admin setup-code` |

`usertasks-admin setup-code` makes a fresh code at any time, and the old
one stops working. `usertasks-admin setup-code status` says whether setup
is still needed and when the current code was made.

```bash
npm run setup-code                                           # source checkout (= npm run admin -- setup-code)
docker compose exec app node admin.cjs setup-code            # Docker image
kubectl -n usertasks exec deploy/usertasks -- node admin.cjs setup-code   # Helm release "usertasks" (else deploy/<release>-usertasks)
```

To choose the code up front (handy for Docker and Helm), set
`USERTASKS_SETUP_CODE`. It needs at least 8 characters; case, dashes and
spaces don't matter. When it is set, the log says the code comes from that
variable instead of printing it.

Only a hash of the code is stored. A restart while setup is still needed
prints a new code, unless another replica made one in the last minute: then
the log points you to that replica's log or to `usertasks-admin setup-code`.
Wrong codes are rate-limited per IP, and the code stops working once setup
is complete.

### From the command line

The command-line bootstrap creates the first organisation and its owner
without `/setup` (scripted installs, CI). It needs the app's environment
(`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the default
stack; `DB_PROVIDER=postgres`, `DATABASE_URL` and `AUTH_PROVIDER=builtin` on
your own PostgreSQL). Run it from the UserTasks folder (the one with
`package.json`): `npm run bootstrap`, `usertasks-admin bootstrap` and
`usertasks-admin setup-code` read `.env.local`, then `.env`, from the
current folder, and variables already set in the shell win. Other commands
(`db migrate`, `switch`, …) don't read these files and need `DATABASE_URL`
set explicitly. Missing variables are named in the error, with a hint when
the folder has no `package.json` or no `.env.local`.

```bash
npm run bootstrap -- --email admin@example.com --password 'a-strong-password' --org "Acme Inc" [--name "Ada Lovelace"]
# in the Docker image (the password may come from BOOTSTRAP_PASSWORD instead of argv)
docker compose exec -e BOOTSTRAP_PASSWORD=… app node admin.cjs bootstrap --email admin@example.com --org "Acme Inc"
```

The same command is `usertasks-admin bootstrap`. It also creates the storage
buckets on the configured provider (`usertasks-admin storage init` does only
that), `--if-missing` makes it a no-op when the account exists, and
`--api-key <name>` mints a tenant API key with every permission and prints it
once (for provisioning scripts).

The script prints the organisation slug. Sign in at `/login` with that slug,
the email and the password, then finish setup at `/onboarding`.

On Windows the npm scripts work the same in PowerShell and cmd. `cd` into
the folder with `package.json` first (`Test-Path package.json` in
PowerShell, `dir package.json` in cmd); `npm run …` from another folder
fails in npm itself with `ENOENT … package.json`. Quote a password with
special characters in single quotes in PowerShell and double quotes in cmd.
If the settings still aren't found, pass the file to Node directly
(Node.js 20.6+; tsx passes the flag on):

```bash
npx tsx --env-file=.env.local scripts/bootstrap-tenant.ts --email admin@example.com --password 'a-strong-password' --org "Acme Inc"
```

`docker compose exec app node admin.cjs bootstrap …` and
`docker compose exec app node admin.cjs setup-code` work the same from any
shell.

### More workspaces from automation (instance admin API)

Platforms that provision UserTasks for their own tenants can create
workspaces over REST. Set `INSTANCE_ADMIN_TOKEN` (at least 32 characters,
e.g. `openssl rand -hex 32`) in the app environment; without it the
endpoints answer 404. The token belongs to the installation: only it is
accepted, and a workspace API key or OAuth token gets 403. Requests are rate
limited per IP and each new workspace is recorded in its audit log.

```bash
curl -X POST https://tasks.example.com/api/v1/admin/workspaces \
  -H "Authorization: Bearer $INSTANCE_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"slug":"acme","name":"Acme Inc","owner_email":"ada@acme.example","create_api_key":true}'
# CLI: USERTASKS_API_KEY=$INSTANCE_ADMIN_TOKEN usertasks admin-workspaces create --url https://tasks.example.com …
```

- The call is idempotent on `slug`. A new workspace returns 201 with
  `created: true`. An existing live workspace returns 200 with
  `created: false`, unchanged. A slug of a deleted workspace returns 409.
- `slug` follows the workspace address rules: a–z, 0–9 and hyphens,
  3–40 characters, not a reserved name.
- If `owner_email` belongs to an existing user, they become the workspace's
  owner and their home workspace is unchanged. Otherwise an account is
  created with the email already confirmed. It gets `owner_password`, or
  a random password nobody knows, in which case the owner signs in with SSO
  or "Forgot password". No invitation email is sent.
- `create_api_key: true` mints a workspace API key with every permission,
  or `api_key_permissions`. Optional fields are `api_key_name` and
  `api_key_expires_in_days`. The key is returned once, as `key`. On an
  existing workspace it mints another key only when asked.
- `GET /api/v1/admin/workspaces/{slug}` returns a workspace's id, slug, name
  and address.

## 5. Running the app

### Node

```bash
npm ci
npm run build
npm start
```

`npm start` serves on port 3000.

The server loads each page's code on that page's first request rather than
all of it at start, which keeps an idle server at roughly a third of the
memory (about 140 MiB instead of 415 MiB for the standalone server; see
[Deployment profiles: server memory](deployment-profiles.md#server-memory)).
Set `NEXT_PRELOAD_ENTRIES=true` to preload everything at start instead — read
when `npm start` starts, and at build time for the Docker image
(`--build-arg NEXT_PRELOAD_ENTRIES=true`).

### Docker

The `Dockerfile` builds Next.js standalone output (`NEXT_OUTPUT_STANDALONE=true`
is set inside the image build; ordinary `npm run build` and Vercel builds are
unaffected). `docker-compose.yml` has two profiles: the default (`supabase`)
runs the app only, against your Supabase project:

Copy `.env.example` to `.env` and fill it in, then build and start:

```bash
cp .env.example .env
docker compose up --build
```

and `standalone` runs everything on your own services: PostgreSQL 16, MinIO,
the scheduler worker, built-in auth, SSE realtime and Mailpit:

```bash
npm run stack -- up --email admin@example.com --org "Acme Inc"
```

The standalone profile has no Supabase service-role key: set `ENCRYPTION_KEY`
(and optionally `WORKFLOW_SIGNING_SECRET`; `npm run stack -- init` generates
both), or runs waiting on a user task cannot be resumed.

See [Deployment profiles](deployment-profiles.md) for both, PgBouncer, and
the on-premises, Azure and Google Cloud reference profiles.

The image needs no Supabase build args: the Supabase URL and keys (and
`NEXT_PUBLIC_SSO_MICROSOFT`) are read from the container's environment at
runtime, so one image can serve any Supabase project. Only `DEPLOYMENT_MODE`
and `NEXT_PUBLIC_APP_URL` are build args, because statically rendered routes
use them; rebuild after changing those two. If Supabase runs on the host
(`supabase start`), use `http://host.docker.internal:54321` as
`NEXT_PUBLIC_SUPABASE_URL` and make sure browsers can reach the same URL.

### Windows hosts: antivirus exclusions

Running on Windows without Docker, exclude the app, data and PostgreSQL
folders from Microsoft Defender's real-time scanning (`Add-MpPreference
-ExclusionPath …`, as administrator): on-access scanning of PostgreSQL's
files, the logs and the app's code (after each restart or upgrade) slows
the app down (5–14 s vs under 1 s to read 1,500 freshly written app files
on a test server). Exclude folders, not `node.exe` / `postgres.exe`
processes, keep unscanned uploads out of the excluded folders, and restrict
who can write there: malware in an excluded folder isn't caught. Details and
the trade-off: [Requirements → Windows servers](https://usertasks.com/docs/self-hosting/requirements#windows-servers-antivirus).

### Version and health check

Unauthenticated endpoints that return nothing secret:

- `GET /api/version` returns `{ "version": "0.1.0", "commit": "…" | null, "buildTime": "…" | null }` (cached 60 s).
- `GET /api/config/public` returns the browser config plus `version` and `commit` (cached 60 s).
- `GET /api/health` (liveness) answers 200 while the process runs; no dependency checks.
- `GET /api/ready` (readiness, the Compose healthcheck and the Helm readiness probe)
  answers 200 `{ "status": "ready" }` when the database responds within 3 s, otherwise
  503 `{ "status": "unavailable", "checks": { "database": "unavailable" } }`.

`version` comes from `package.json`. `commit` comes from
`VERCEL_GIT_COMMIT_SHA` on Vercel, otherwise from `GIT_COMMIT` or
`SOURCE_COMMIT` (only a hex SHA is shown). `buildTime` comes from `BUILD_TIME`.
The Docker image takes them as build args:

```bash
docker build --build-arg GIT_COMMIT=$(git rev-parse HEAD) \
  --build-arg BUILD_TIME=$(date -u +%FT%TZ) -t usertasks .
# or: GIT_COMMIT=$(git rev-parse HEAD) docker compose build
```

### Optional drivers

The Snowflake (`snowflake-sdk`), Oracle (`oracledb`) and MongoDB (`mongodb`)
drivers, the S3 / Azure Blob / Cloud Storage SDKs, the SMTP, SES, Azure
email, secret-store and KMS SDKs and the SAML library are
`optionalDependencies`. Postgres, SQL Server and MySQL are always included.
A feature whose package is missing fails with a message naming the package,
the version to install and the Docker build arg.

- **Node**: `npm ci` installs them all. A package missing at build time is
  replaced by a stub, so after adding one, rebuild (`npm run build`).
- **Docker**: the image leaves the three database drivers out by default
  (about 40 MB smaller) and includes the rest. Include the drivers with the
  build arg:

  ```bash
  docker build --build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true -t usertasks .
  # or with compose: INCLUDE_OPTIONAL_DB_DRIVERS=true in .env, then
  docker compose up --build
  ```

[Optional drivers](optional-drivers.md) has the full list, versions,
defaults per deployment (source, Docker, Kubernetes, Vercel, air-gapped),
how to check for a missing package, and the Snowflake, Oracle and MongoDB
connection specifics.

### File uploads and request size limits

Form **Attachments** fields upload one file per request, and choose the path
per file automatically on any host:

- **Straight to storage** whenever the storage provider signs uploads —
  Supabase Storage, S3 / MinIO / R2, Azure Blob, Google Cloud Storage. The
  app checks the user and the field's limits, hands the browser a signed URL
  for that one object (valid for `FORM_ATTACHMENT_UPLOAD_WINDOW_MINUTES`,
  default 15), the browser PUTs the file to the store, and the app then reads
  it back and verifies it (size, content type by magic bytes, blocked types,
  SVG sanitising, checksum, optional virus scan) before it can be submitted.
  No request body limit of the app's host applies. For S3, Azure Blob and
  GCS the bucket / account needs a **CORS rule** allowing `PUT` from the
  app's origin with the `Content-Type` (and, on Azure, `x-ms-blob-type`)
  header; the app's Content-Security-Policy already allows the store's
  origin (`S3_ENDPOINT`, the Azure account, `storage.googleapis.com`).
- **Through the app** for local-disk storage (or if signing fails): the file
  is the request body, up to `FORM_UPLOAD_MAX_BODY_MB` (default **50**; it
  also sets Next.js `proxyClientMaxBodySize` and is read at **build time** —
  a Docker build arg). On Vercel it is capped at 4 MB (functions refuse
  bodies over ~4.5 MB); larger files there need a storage provider with
  signed uploads, and the user gets an error saying so.

Every proxy in front of the app must allow at least that body size for the
streamed path:

| Front end | Setting |
|---|---|
| nginx | `client_max_body_size 64m;` in the `server` / `location` block |
| ingress-nginx (Helm chart) | `ingress.maxBodySize: "64m"` (default) → `nginx.ingress.kubernetes.io/proxy-body-size` |
| Traefik | a `buffering` middleware with `maxRequestBodyBytes: 67108864` (Traefik doesn't limit by default) |
| Caddy | `request_body { max_size 64MB }` (no limit by default) |
| Azure Container Apps | no small body cap on HTTP ingress, but a request must finish within the ingress timeout (240 s) — prefer direct uploads for big files |
| Google Cloud Run | 32 MiB per HTTP/1 request — keep `FORM_UPLOAD_MAX_BODY_MB` ≤ 32 or use GCS direct uploads |
| AWS ECS behind an ALB | no ALB body limit; API Gateway in front caps at 10 MB |
| Docker Compose | `FORM_UPLOAD_MAX_BODY_MB` in `.env` (build arg) plus your reverse proxy's limit |

The size of a single file is limited separately by each field and by
`FORM_ATTACHMENT_MAX_MB` (default 25, at most 45).

### Document converter (optional)

Convert Document turns Word, Excel, PowerPoint and OpenDocument files into
PDF with a built-in renderer that keeps the text, headings, lists and tables
but not the layout, and can't read the 97–2003 formats (`.doc`, `.xls`,
`.ppt`). For a faithful copy, run a [Gotenberg](https://gotenberg.dev)-compatible
service next to the app and point the app at it:

```bash
docker run -d --name gotenberg --network <app-network> gotenberg/gotenberg:8
```

```bash
DOCUMENT_CONVERTER_URL=http://gotenberg:3000
# DOCUMENT_CONVERTER_TOKEN=               # bearer token, if a proxy in front of it requires one
# DOCUMENT_CONVERTER_TIMEOUT_SECONDS=120
```

The app posts Office files to `/forms/libreoffice/convert` and HTML and
Markdown to `/forms/chromium/convert/html` and
`/forms/chromium/convert/markdown`, and accepts only a PDF back. Only the
file being converted is sent. Run it on your own network, without a public
address — never use a public conversion service. Private addresses are
allowed for this URL (it is instance configuration, not workflow input).
With it set, Convert Document's **Automatic** engine uses it for Office →
PDF; see [Convert Document](/docs/workflows/documents/convert-document).

### Google Fonts

Workspace themes and forms can use any Google Fonts family. The app serves
them itself from `/fonts/g/…`: the first request for a family makes the
server download it once from `fonts.googleapis.com` / `fonts.gstatic.com`
(nowhere else; https only, size limits, rate limited) and store it in the
storage provider (bucket `task-files`, prefix `google-fonts/`), so browsers
never contact Google and the CSP allows fonts only from this origin. Set
`FONTS_REMOTE=off` (or the instance setting `instance.fonts_remote` =
`false`) where the server has no internet access: only fonts already stored
are offered and served, others fall back to a similar system font. Pre-seed
them with `usertasks-admin fonts seed <family>…` (or `--dir` on a connected
machine, then `usertasks-admin fonts import`); see
[Air-gapped installs](/docs/self-hosting/air-gapped#google-fonts).

### Licences for paid extensions

Paid extensions (SharePoint Server, the Infrastructure add-on, and the
Processing add-on once it is released) all ship in one image,
[UserTasks Enterprise](#editions), and each needs its own licence. Instance
admins install a licence in Settings → Licence, with
`usertasks-admin licence install <file>`, or through `USERTASKS_LICENCE` /
`USERTASKS_LICENCE_FILE`. Licensed extensions stop 24 hours after the licence
expires. See [Licences for paid extensions](licensing.md).

### Editions

**Enterprise edition: one image, licences unlock extensions.**

The public image (`ghcr.io/homepresso/usertasks`) has no paid extension.
**UserTasks Enterprise** is the same UserTasks with every paid extension
compiled in: today SharePoint Server and the Infrastructure add-on. Each
extension stays locked until its own licence is installed, and the check is
made by your server, offline, every time it is used. So once an install runs
the Enterprise image, adding an extension later is just installing its
licence (Settings → Licence): **no reinstall, no new image**. Settings →
Extensions shows which edition the server runs, which paid extensions the
image contains and which of them are licensed.

The Enterprise image is not public; usertasks.com lets you download it with
**any** valid trial or purchased licence for an extension it contains:

1. The installer sends the `.licence` file to
   `POST https://usertasks.com/api/public/extensions/enterprise/pull-token`.
   usertasks.com checks its signature (the same verifier as UserTasks), that
   it grants an extension of the build (SharePoint, Infrastructure, …), and
   its dates (it is refused 24 hours after expiry), and returns a read-only
   download pass for that one image, valid for 30 minutes, with the edition
   manifest signed by the UserTasks release key. The manifest lists every
   extension in the build and its version.
2. The installer checks that signature with the release key it already
   trusts, pulls the image from `usertasks.com/editions/enterprise` **by the
   signed digest**, checks the image it got against the manifest, tags it
   `usertasks.com/editions/enterprise:<version>` and logs out again. The pass
   is never written to the install folder.

Versions are `<UserTasks version>-ent.<build>`, for example `0.4.0-ent.2`:
every UserTasks release gets Enterprise builds (usually within a few hours of
its release), and a new extension release adds a build for the current
release. The extension versions in each build are in its `edition.json`.

| | Linux / macOS | Windows (PowerShell) |
|---|---|---|
| New install | `curl -fsSL https://usertasks.com/install.sh \| sh -s -- --licence usertasks.licence` | `& ([scriptblock]::Create((irm https://usertasks.com/install.ps1))) -Licence .\usertasks.licence` |
| Switch an existing install (data kept, backup first) | `usertasks upgrade --edition enterprise` | `usertasks upgrade -Edition enterprise` |
| Upgrade | `usertasks upgrade` | `usertasks upgrade` |
| Add another extension | install its licence in Settings → Licence (no command) | the same |
| Back to the public image (data kept) | `usertasks upgrade --edition core` | `usertasks upgrade -Edition core` |
| Offline bundle (connected machine) | `curl -fsSL https://usertasks.com/install.sh \| sh -s -- --bundle-download --licence usertasks.licence` | `install.ps1 -BundleDownload -Licence <file>` |
| Install / upgrade from the bundle (offline host) | `sh install.sh --bundle <file>` · `usertasks upgrade --bundle <file>` | `install.ps1 -Bundle <file>` · `usertasks upgrade -Bundle <file>` |
| A prebuilt bundle in parts (over 2 GB) | `--bundle <folder with the parts>`, or `--bundle-download --from <.parts.json address>` to download them ([details](setup-air-gapped.md#bundles-in-parts)) | `-Bundle <folder>`, `-BundleDownload -From <address>` |

- **A licence picks the Enterprise image.** `--licence <file>` without
  `--edition` installs UserTasks Enterprise (`--edition enterprise` says so
  explicitly). If there is no Enterprise build for that release yet, or
  usertasks.com cannot be reached, the installer says so and installs the
  public image instead; the licence is still installed, and
  `usertasks upgrade --edition enterprise` switches later. A refused licence
  (expired, withdrawn) stops the install. `--edition core` keeps the public
  image even with a licence.
- **Which licence**: `--licence <file>` when given (it is kept in the install
  folder as `licences/<edition>.licence` and installed in UserTasks);
  otherwise the licence installed in UserTasks (Settings → Licence, so a trial
  started in Settings → Extensions or a renewal counts), read with
  `usertasks-admin licence export --ext <extension>`.
- **A lapsed licence**: `usertasks upgrade` asks usertasks.com before it
  changes anything; a refusal (expired, withdrawn) stops it with the reason and
  UserTasks keeps running as it is. The running install never needs
  usertasks.com.
- **The SharePoint edition** (`--edition sharepoint`, versions
  `<UserTasks version>-sp<extension version>`) was the first, SharePoint-only
  edition. It keeps working with no change: installs made as the SharePoint
  edition upgrade as before, and usertasks.com now serves them the Enterprise
  image under a signed SharePoint manifest for the same image, so after the
  next `usertasks upgrade` they run UserTasks Enterprise (Settings → Extensions
  shows the Infrastructure add-on as *in this build, not licensed*). To use the
  new name too: `usertasks upgrade --edition enterprise` (the SharePoint
  licence the install kept is used; data kept).
- **Installed another way** (your own Compose file, Kubernetes): get a pass
  and pull the image yourself, then push it to your own registry (a pass lasts
  30 minutes, so cluster nodes should pull from your registry, not ours):

  ```bash
  curl -fsS https://usertasks.com/api/public/extensions/enterprise/pull-token \
    -H 'Content-Type: application/json' \
    -d "{\"licence\":\"$(base64 < usertasks.licence | tr -d '\n')\",\"version\":\"latest\"}" > pass.json
  jq -r .edition_manifest pass.json | base64 -d > edition.json
  jq -r .edition_signature pass.json | base64 -d > edition.json.sig
  openssl pkeyutl -verify -pubin -inkey release-key.pub.pem -rawin -in edition.json -sigfile edition.json.sig
  jq -r .password pass.json | docker login usertasks.com -u licence --password-stdin
  docker pull "$(jq -r .image pass.json)"
  docker logout usertasks.com
  ```

  `release-key.pub.pem` is attached to every UserTasks release. `version` is
  `latest`, a UserTasks version (`0.4.0`) or an edition version
  (`0.4.0-ent.2`). Run `usertasks-admin ext migrate` after
  `usertasks-admin db migrate` when you upgrade.
- **Air-gapped**: see [Air-gapped installs](setup-air-gapped.md#enterprise-edition).

### Connecting to on-premises systems

Connectors (REST / OData / webhook integrations, Windows-authenticated
SharePoint and other on-premises HTTP services, database and SFTP connectors,
workflow HTTP requests, log destinations) are checked by the egress guard on
every call and every redirect. By default they may only reach public
addresses over HTTPS: private (10/8, 172.16/12, 192.168/16, 100.64/10,
fc00::/7), loopback and link-local addresses are blocked, and plain
`http://` base URLs are refused (loopback excepted). Cloud metadata endpoints
(169.254.169.254, fd00:ec2::254, the ECS / EKS credential endpoints,
100.100.100.200) are **always** blocked, whatever you configure.

On a self-hosted server you open exactly the systems you need. These settings
have **no effect in the cloud edition** (`DEPLOYMENT_MODE=cloud`).

**1. HTTPS with your internal CA (recommended).** Most on-premises services
already have a certificate from an internal CA. Keep `https://` and either
paste the CA bundle on the connection (Windows authentication connections
have a **CA bundle** field) or trust it server-wide with
`NODE_EXTRA_CA_CERTS=/path/to/internal-ca.pem`.

**2. The private network allowlist** — `EGRESS_PRIVATE_ALLOW`, a comma
separated list of:

| Entry | Matches |
|---|---|
| `spsites` | exactly that hostname |
| `*.contoso.local` | any name under `contoso.local` (not `contoso.local` itself) |
| `10.0.0.0/8`, `192.168.10.0/24` | any target whose resolved address is in the range |
| `fd00:1234::/32` | IPv6 ranges the same way |
| `10.1.2.3` | one address (= `/32`, or `/128` for IPv6) |

A private target is allowed when its **hostname** matches an entry, or when
the **address it resolves to** is inside a listed CIDR. The decision is made
on the resolved addresses, at connect time, so a name cannot be re-pointed
(DNS rebinding) at another address after the check: a listed hostname that
resolves to a metadata address is still blocked. Loopback (127.0.0.0/8,
::1) and link-local (169.254.0.0/16, fe80::/10) addresses need a CIDR entry
that covers them — a hostname entry is not enough. Ranges broader than `/8`
are refused.

```bash
# SharePoint farm and file shares in the contoso.local domain, plus the 10.x network
EGRESS_PRIVATE_ALLOW=*.contoso.local,spsites,10.0.0.0/8
```

The same list can be kept in the database instead of the environment (the
environment wins when both are set):

```bash
npm run admin -- egress allow-private '*.contoso.local' spsites 10.0.0.0/8
npm run admin -- egress show
npm run admin -- egress remove-private 10.0.0.0/8      # or --all
```

The app picks a change up within about 30 seconds. **Settings →
Infrastructure → Network access** shows the effective lists (read-only).

**3. Plain HTTP for specific hosts** — `EGRESS_HTTP_ALLOW`, same syntax.
Some SharePoint farms are only published over `http://` (e.g.
`http://spsites`). List them to allow an `http://` base URL; anything not
listed must use HTTPS:

```bash
EGRESS_HTTP_ALLOW=spsites,*.contoso.local
# or: npm run admin -- egress allow-http spsites '*.contoso.local'
```

A host on a private address must also be in the private network allowlist.
The list applies to connector base URLs and to plain-`http://` log
destinations. Over
plain HTTP, Windows authentication (NTLM / Kerberos) is a challenge-response
and never sends the password; Basic, Bearer and API-key credentials travel in
clear text — the connection form warns when you combine them with
`http://`. Prefer HTTPS for those.

**`ALLOW_PRIVATE_EGRESS=true`** still works and opens *every* private range
(and plain `http://` log destinations) to every connector. It is broad: any
workspace administrator can then point an integration at any internal
service. Prefer the allowlist, which names the hosts and networks you mean.

When a call is blocked, the error says which setting to change, for example
`Connection to spsites is not allowed: resolves to a private address
(10.20.0.15) is blocked; add the host or its network to EGRESS_PRIVATE_ALLOW …`.

### Trusted embedding

Some integrations show UserTasks inside another site — for example a dialog in SharePoint opened by the UserTasks add-in. UserTasks pages refuse to be framed (`frame-ancestors 'none'`, `X-Frame-Options: DENY`) unless you approve the sites:

```bash
EMBED_FRAME_ANCESTORS="https://intranet.contoso.com https://*.sharepoint.contoso.com"
# or, stored in the database (the environment wins):
usertasks-admin embed allow https://intranet.contoso.com
usertasks-admin embed show
```

Entries are origins (scheme, host, optional port; `https://*.domain` for subdomains; `http://` only when you list it so). A bare `*`, paths and CSP keywords are refused. Only the embeddable pages (`/embed/…`, declared by extensions) are opened to these sites — `frame-ancestors 'self' <origins>` and no `X-Frame-Options`; every other page stays unframable.

**Signed in inside the frame.** A frame from another site only gets the session cookie when it is `SameSite=None; Secure`. With origins configured and UserTasks on https, session cookies are issued that way (at the next sign-in). To keep the protection SameSite=Lax gave against cross-site request forgery, the server then drops the session cookie from every cross-site request Lax would not have carried it on — cross-site form posts, fetches, images, frames of other pages — and keeps it only for top-level navigations (as before) and the framed loading of an embeddable page (Fetch Metadata headers; for browsers without them, unsafe requests from another origin). Server actions keep their own origin check. Browsers that block third-party cookies (Safari; Chrome or Firefox with strict settings) show "Open UserTasks" inside the frame instead — the page then opens in a new tab. On plain http (development) cookies stay Lax and framed pages ask to open a new tab. The one other cookie that may be `SameSite=None` is the SSO flow-binding cookie of an automatic sign-in that runs inside a frame (below): it is a random, single-flow value, not a credential, so sending it cross-site grants nothing.

### Automatic sign-in

When UserTasks is opened from another system — the UserTasks button in SharePoint, a portal link to an extension page — people who are signed in to your identity provider should land in UserTasks without seeing a sign-in page. With SSO configured (built-in auth with OIDC / SAML identity providers, `AUTH_SSO_PROVIDERS`), that is the default:

1. UserTasks asks the identity provider **passively** first — OIDC `prompt=none`, SAML `IsPassive="true"`. An IdP that can sign the person in by itself (AD FS with Windows Integrated Authentication on the intranet, an Entra ID or Okta session) answers at once, and the person is in.
2. If the IdP needs the person (`login_required` / `interaction_required`, SAML `NoPassive`), UserTasks continues with the IdP's own sign-in — still no UserTasks sign-in page — and returns to the page that was opened.
3. Inside a frame (a dialog or web part on another site), where IdP pages can't be shown, the passive attempt runs in a hidden frame (embeddable pages allow frames to the IdP's sign-in origin only); if it can't finish, a **Sign in with …** button opens a small popup that completes the sign-in and closes, then the frame reloads signed in. Browsers that block cookies in embedded windows are first asked for storage access (**Continue**), else offered "Open UserTasks" in a new tab.

**No identity is taken from the launching system.** A SharePoint add-in launch (and most portal links) carries no signed statement of who the user is; a user name in such a request could be forged by anyone, so UserTasks never signs anybody in from it. Only the identity provider's signed answer (ID token / SAML assertion), checked exactly as for any SSO sign-in, decides who is signed in. People brought in by a directory source (e.g. SharePoint site users and groups) become UserTasks users at that first SSO sign-in, with their workspace membership and groups (that is when their seat is counted). Someone an organisation brought in — the IdP's `defaultOrg`, or a directory source's pending entry — is created in that workspace and lands there; no personal workspace is created for them.

**Per workspace** (**Settings → SSO & Directory → Single sign-on**, `PATCH /api/v1/workspace/sso`, `usertasks workspace-sso update`, MCP `workspace_sso_update`):

| Setting | Default | |
|---|---|---|
| `auto_sign_in` | on | Sign in automatically with SSO when opened from another system |
| `sso_only` | off | Skip the sign-in page: `/login` goes straight to the identity provider |
| `idp` | automatic | Which identity provider: automatic = the one whose `defaultOrg` is this workspace, else the instance's only one |

`AUTH_SSO_ONLY=true` (or `auth.sso_only`) skips the sign-in page for every workspace. The page still shows after signing out, after an SSO error and at **`/login?local=1`** — keep a password administrator for the day the IdP is down. Signing out of UserTasks never signs anyone out of the identity provider, so opening UserTasks from SharePoint again signs the person straight back in (by design).

Which workspace: the workspace address, else the add-in's workspace hint (`?ut_org=<slug>`, added by extensions with `ctx.launchUrl`), else the instance's only workspace. With Supabase Auth (the cloud edition) a workspace chooses its provider explicitly (`idp: "microsoft"` with Entra ID; AD FS federated with Entra ID works through it — set `domainHint` on configured Entra IdPs to skip home-realm discovery).

**AD FS with Windows sign-in.** For browsers on domain-joined machines to be signed in silently, AD FS must offer Windows Integrated Authentication on the intranet (`Set-AdfsGlobalAuthenticationPolicy -PrimaryIntranetAuthenticationProvider WindowsAuthentication,FormsAuthentication`) to Chromium browsers — add their user agents, e.g. `Set-AdfsProperties -WIASupportedUserAgents ((Get-AdfsProperties).WIASupportedUserAgents + '=~Windows\s*NT.*Edg/' + '=~Windows\s*NT.*Chrome')` — and browsers must send Kerberos to AD FS (its address in the Local intranet zone, or the `AuthServerAllowlist` policy for Edge / Chrome). AD FS answers `prompt=none` with redirects only (Windows sign-in, or `login_required` when it can't), so the silent attempt never shows an AD FS page. Inside frames a session also needs the browser to allow cookies in embedded windows: Edge and Chrome with third-party cookies blocked refuse them, and the dialog then asks for storage access (one **Continue** click) — or open UserTasks full page (the SharePoint add-in's launch does).


**Embedded designers.** The workflow designer and the form designer can also be shown inside an approved site, without the UserTasks navigation (no sidebar, top bar, breadcrumbs, search or New menu) — e.g. a SharePoint page that edits the workflow or form of one of its lists:

| Page | Embedded at |
|---|---|
| Workflow designer | \`/embed/workflows/<id>\` (its runs: \`/embed/workflows/<id>/runs\`, one run: \`/embed/runs/<run id>\`) |
| Form designer | \`/embed/forms/<id>/design\` |

They are the normal designers (save, publish, test run, preview, version history) with the same permissions, under a compact header: what is open, whether it has unsaved changes, **Open in UserTasks** (new tab) and **Done**. Optional parameters: \`return=<URL>\` and \`return_label=<name>\` add "Back to *name*" (Back and Done take the whole window there) — accepted only when the URL is on one of the approved origins, otherwise ignored; \`host_origin=<origin>\` (same rule) when there is no return URL; \`header=0\` hides the header when the host page draws its own. Links stay inside the embed (the embedded equivalent) or open in a new tab — the full UserTasks app never opens inside the frame. The embedding page receives \`window.postMessage\` events \`{ type: 'usertasks:designer', event: 'ready' | 'state' | 'done' | 'deleted', kind, id, … }\` (\`state\` carries \`dirty\` for an unsaved-changes warning) sent only to its approved origin; it may answer \`done\` with \`{ type: 'usertasks:host', event: 'ack' }\` to navigate itself. Inside the frame the designer's own saves and reads are same-origin requests and keep the session; the same calls from the host page or any other site stay signed out.

## 6. Security checklist

- Keep `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ENCRYPTION_KEY` and
  `WORKFLOW_SIGNING_SECRET` out of the client and out of version control.
- Custom workflow actions run in a QuickJS WebAssembly sandbox with only the
  capabilities an administrator grants (`ENABLE_CUSTOM_ACTIVITY_CODE` is no
  longer used). Set `CUSTOM_ACTIONS_DISABLED=true` to switch them off on a
  server, and `CUSTOM_ACTION_MAX_TIMEOUT_MS` to lower the per-run time limit
  (see [Custom workflow actions](/docs/workflows/custom-actions#security-model)).
- Leave `ALLOW_PRIVATE_EGRESS` off. To reach services on your private
  network, list them in `EGRESS_PRIVATE_ALLOW` (see
  [Connecting to on-premises systems](#connecting-to-on-premises-systems)).
- Serve the app over HTTPS; it sends HSTS and a strict CSP by default.
