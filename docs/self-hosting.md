# Self-hosting UserTasks

UserTasks is a Next.js application backed by Supabase (Postgres, Auth,
Storage, Vault, pg_cron and pg_net). Self-hosting means running the Next.js
app yourself and pointing it at a Supabase project you control, either on
supabase.com or a self-hosted Supabase stack.

This is the starting point for every install: on Supabase, with no provider
settings. Supabase is an excellent platform and our recommended way to run
UserTasks. If you'd like to use other services, each infrastructure area
(database, auth, storage, realtime, scheduler, email, secrets, KMS, cache)
can move to AWS, Azure, Google Cloud or your own servers with
`usertasks-admin switch` whenever you're ready, one area at a time.
[Choose your topology](topologies/README.md) helps you decide where each one
should run, and [Choosing each service](services/README.md) lists the options.

Requirements: Node.js 22 LTS (20.9 or later works, with an `EBADENGINE`
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
3. Apply the migrations. Hosted project:

   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
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
contact pipeline (`CHIRPME_API_KEY`, `CHIRPME_CHANNEL_ID`) is configured.

### Workspace addresses (optional)

Each workspace can have its own address, `acme.example.com`, and every
reusable form a friendly link on it, `acme.example.com/form/<system name>`.
They are off on a self-hosted install until you set a base domain:

| Variable | Notes |
|----------|-------|
| `APP_BASE_DOMAIN` | The domain workspace addresses live under, e.g. `example.com` (then `acme.example.com`). The cloud edition defaults to the `APP_URL` host (`www.` / `app.` stripped). `off` turns addresses off. |

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
| | provider-switches | no provider switch queued from Settings → Infrastructure (or interrupted), or no long-running process / `DATABASE_URL` |
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

### Version and health check

Two unauthenticated endpoints, cached for 60 seconds, that return nothing
secret:

- `GET /api/version` returns `{ "version": "0.1.0", "commit": "…" | null, "buildTime": "…" | null }`.
- `GET /api/config/public` (the container healthcheck) returns the browser
  config plus `version` and `commit`.

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

## 6. Security checklist

- Keep `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ENCRYPTION_KEY` and
  `WORKFLOW_SIGNING_SECRET` out of the client and out of version control.
- Custom workflow actions run in a QuickJS WebAssembly sandbox with only the
  capabilities an administrator grants (`ENABLE_CUSTOM_ACTIVITY_CODE` is no
  longer used). Set `CUSTOM_ACTIONS_DISABLED=true` to switch them off on a
  server, and `CUSTOM_ACTION_MAX_TIMEOUT_MS` to lower the per-run time limit
  (see [Custom workflow actions](/docs/workflows/custom-actions#security-model)).
- Leave `ALLOW_PRIVATE_EGRESS` off unless workflows must call services on
  your private network.
- Serve the app over HTTPS; it sends HSTS and a strict CSP by default.
