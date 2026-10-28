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

## 1. Supabase project

1. Create a project on supabase.com, or run a local stack with
   `npx supabase init` (first time only) and then `npx supabase start`.
2. Enable the `pg_cron` and `pg_net` extensions (Database → Extensions).
   The cron migration also runs `create extension if not exists` for both.
3. Apply the migrations. Hosted project:

   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

   Local stack: `npx supabase db reset` applies `supabase/migrations/`.

   This builds the whole schema from scratch: baseline, `auth.users`
   trigger, pg_cron jobs, the public `task-files` and `logos` Storage buckets
   with their policies, Realtime publication membership, and the strip-back
   migration. See [migrations.md](migrations.md).
4. Regenerate the TypeScript types if you change the schema:
   `npm run db:types:local` (local stack) or `npm run db:types` (linked
   project).

## 2. Environment

Copy `.env.example` to `.env.local` (for `npm run dev` / `npm start`) or to
`.env` (for Docker Compose) and fill it in. The minimum is:

| Variable | Notes |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Read at runtime and passed to the browser by the server (restart, no rebuild, after changing them). `SUPABASE_URL` / `SUPABASE_ANON_KEY` take precedence when set. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. |
| `NEXT_PUBLIC_APP_URL` | The public origin users and pg_cron reach the app on (`APP_URL` takes precedence when set). |
| `CRON_SECRET` | Shared with pg_cron through Vault (below). |
| `ENCRYPTION_KEY` | Encrypts stored connector secrets. Without it they are stored in plaintext. |

`DEPLOYMENT_MODE` defaults to `self_hosted` when unset. In that mode the
marketing pages, contact form and self-signup are disabled, `/robots.txt`
disallows all crawling, the sitemap is empty, and `/` redirects to `/tasks`
(signed in) or `/login`. Some of these routes are statically rendered, so
set `DEPLOYMENT_MODE` (and the app URL, used for Open Graph and sitemap
links) at build time as well as at runtime.

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

Or let the app do it from its own configuration:
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

## 4. First tenant

Self-signup is disabled in `self_hosted` mode. Create the first organisation
and its owner from the command line, with the app's environment
(`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the default
stack; `DB_PROVIDER=postgres`, `DATABASE_URL` and `AUTH_PROVIDER=builtin`
on your own PostgreSQL):

```bash
set -a; . ./.env.local; set +a
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
the email and the password, then finish setup at `/onboarding`. Invite
further users from Settings → Invitations.

## 5. Running the app

### Node

```bash
npm ci
npm run build
npm start          # serves on port 3000
```

### Docker

The `Dockerfile` builds Next.js standalone output (`NEXT_OUTPUT_STANDALONE=true`
is set inside the image build; ordinary `npm run build` and Vercel builds are
unaffected). `docker-compose.yml` has two profiles: the default (`supabase`)
runs the app only, against your Supabase project:

```bash
cp .env.example .env   # fill it in
docker compose up --build
```

and `standalone` runs everything on your own services: PostgreSQL 16, MinIO,
the scheduler worker, built-in auth, SSE realtime and Mailpit:

```bash
npm run stack -- up --email admin@example.com --org "Acme Inc"
```

See [Deployment profiles](deployment-profiles.md) for both, PgBouncer, and
the on-premises, Azure and Google Cloud reference profiles.

The image needs no Supabase build args: the Supabase URL and keys (and
`NEXT_PUBLIC_SSO_MICROSOFT`) are read from the container's environment at
runtime, so one image can serve any Supabase project. Only `DEPLOYMENT_MODE`
and `NEXT_PUBLIC_APP_URL` are build args, because statically rendered routes
use them; rebuild after changing those two. If Supabase runs on the host
(`supabase start`), use `http://host.docker.internal:54321` as
`NEXT_PUBLIC_SUPABASE_URL` and make sure browsers can reach the same URL.

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

## 6. Security checklist

- Keep `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` and `ENCRYPTION_KEY` out of
  the client and out of version control.
- Leave `ENABLE_CUSTOM_ACTIVITY_CODE` off unless every workflow author is
  trusted: custom activity code runs unsandboxed in the app process.
- Leave `ALLOW_PRIVATE_EGRESS` off unless workflows must call services on
  your private network.
- Serve the app over HTTPS; it sends HSTS and a strict CSP by default.
