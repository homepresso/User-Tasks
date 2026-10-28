# Infrastructure and providers

UserTasks runs each infrastructure area through a provider. Unset, every area
uses the default stack (Supabase for the database, auth, storage and realtime;
pg_cron; Resend; environment secrets). A provider is chosen with an
environment variable (`<AREA>_PROVIDER`), or with a `providers.<area>` row in
the `instance_settings` table; the environment wins. Supabase is an
excellent platform and our recommended way to run UserTasks. If you'd like
to use other services, you can move each area whenever you're ready. See
[Environment variables](/docs/self-hosting/environment) for every setting.

To move a running install from one provider to another, use the admin CLI:
`usertasks-admin status`, `doctor` and `switch <area> --to <provider>`
(pre-flight checks, automatic backup, step log, rollback) — see
[Switching providers](switching-providers.md). Ready-made combinations — Docker Compose
`standalone`, on-premises, Azure and Google Cloud, with smoke tests and
Bicep / Terraform templates — are in
[Deployment profiles](deployment-profiles.md); step-by-step setup per
platform in [On-premises](setup-on-prem.md), [Azure](setup-azure.md) and
[Google Cloud](setup-gcp.md). Instance administrators
(`INSTANCE_ADMIN_EMAILS`) see the provider per area, health checks and the
switch log under **Settings → Infrastructure**, and can change providers and
provider settings there with the same engine — see
[Switching providers: from the UI](switching-providers.md#from-the-ui).

| Area | Variable | Options |
|------|----------|---------|
| Database | `DB_PROVIDER` | `supabase` (default), `postgres` |
| Auth | `AUTH_PROVIDER` | `supabase` (default), `builtin`, `oidc`, `saml` |
| Storage | `STORAGE_PROVIDER` | `supabase` (default), `local`, `s3`, `azure_blob`, `gcs` |
| Realtime | `REALTIME_PROVIDER` | `supabase` (default), `sse` |
| Scheduler | `SCHEDULER_PROVIDER` | `pg_cron` (default), `worker`, `external` |
| Email | `EMAIL_PROVIDER` | `resend` (default), `smtp`, `ses`, `azure_communication`, `microsoft_graph`, `gmail`, `console` |
| Secrets | `SECRETS_PROVIDER` | `env` (default), `db`, `supabase_vault`, `hashicorp_vault`, `azure_key_vault`, `gcp_secret_manager`, `aws_secrets_manager` |
| Cache | `CACHE_PROVIDER` | `memory` (default), `postgres`, `redis` |
| KMS | `KMS_PROVIDER` | `env` (default), `vault_transit`, `aws_kms`, `azure_key_vault`, `gcp_kms` |

## Database

`DB_PROVIDER=supabase` (the default) reads and writes through Supabase's REST
API. `DB_PROVIDER=postgres` answers the same queries in-process over
`DATABASE_URL`, with the same row-level security: every request runs in its
own transaction as `anon`, `authenticated` or `service_role` with the
caller's JWT claims, exactly as PostgREST would. With the postgres provider
the database can be any PostgreSQL — Supabase itself, a plain server or a
managed service — and, combined with `AUTH_PROVIDER=builtin|oidc|saml`,
`STORAGE_PROVIDER=local|s3|…`, `REALTIME_PROVIDER=sse` and
`SCHEDULER_PROVIDER=worker|external`, nothing in the install depends on
Supabase.

### Requirements

- **PostgreSQL 15 or later** (the schema uses `UNIQUE NULLS NOT DISTINCT`).
  CI runs plain PostgreSQL 16 and 17 and Supabase's PostgreSQL 17; 15 is
  checked by hand.
- **Extensions:** `pg_trgm` (required; trusted, so the database owner can
  create it). `pgcrypto` is used when available; otherwise the migrations
  install a `gen_random_bytes()` built on the core `gen_random_uuid()`.
  `pg_cron` and `pg_net` are optional: without them the pg_cron sections of
  the migrations are skipped and scheduling is the
  [scheduler provider's](#scheduler) job (`worker` or `external`). Vault and
  Supabase Storage are not needed.
- **Roles.** The schema's RLS policies and grants name the Supabase roles.
  The first migration, `20261014000000_compat_bootstrap.sql`, creates them
  when they are missing (it does nothing on Supabase): `anon`,
  `authenticated`, `service_role` (`NOLOGIN`; `service_role` with
  `BYPASSRLS` when the migrating role may grant it) and `authenticator`
  (`NOLOGIN NOINHERIT`, member of the three). It also creates the `auth`
  schema's `uid()`, `role()`, `jwt()` and `email()` — reading the
  `request.jwt.claims` setting, like Supabase's — and a minimal `auth.users`
  table, and the `extensions` schema.

### Privileges

The role that runs the migrations owns the schema. It needs:

| Privilege | Why | If it is missing |
|---|---|---|
| Owner of the database (or `CREATE` on it) | creates schemas and the trusted extensions | migration fails |
| `CREATEROLE` | creates `anon`, `authenticated`, `service_role`, `authenticator` | pre-create the four roles (`NOLOGIN`) and `GRANT anon, authenticated, service_role TO <migration role>` |
| `BYPASSRLS` itself, or `SUPERUSER` | gives `service_role` `BYPASSRLS` | handled automatically, see below |
| Membership of `postgres` | the baseline (a Supabase dump) re-owns objects to `postgres` | `usertasks-admin db migrate` points those statements at the migrating role instead (`--owner <role>` to choose) |

Managed services usually allow the first two and not `BYPASSRLS`. The
migration then creates `service_role` without it (and says so), and the
postgres db provider runs service-role requests **as the connection's own
role** — the schema owner, which bypasses RLS on its tables — with the same
`service_role` JWT claims. End-user requests still switch to `anon` /
`authenticated`. So the app must connect as the schema owner in that case
(or as a role that is a member of it); with `BYPASSRLS` available, any role
that may `SET ROLE` to the three API roles works (for example
`authenticator`, given `LOGIN` and a password).

Tested: a superuser (Docker `postgres`), and a `CREATEDB CREATEROLE` owner
without `SUPERUSER` or `BYPASSRLS` (the managed-service case) — the full test
suite passes on both, and the RLS semantics snapshot matches Supabase's
exactly.

### Migrations: `usertasks-admin db migrate`

`supabase db push` still migrates Supabase projects. For any other
PostgreSQL, the admin CLI applies the same `supabase/migrations/` files:

```bash
# from a checkout
DATABASE_URL=postgresql://owner:…@db:5432/usertasks npm run admin -- db migrate
# in the Docker image (migrations are at /app/supabase/migrations)
docker run --rm -e DATABASE_URL=… <image> node admin.cjs db migrate
```

| Command | What it does |
|---|---|
| `db migrate [--dry-run] [--include-all] [--owner <role>]` | applies pending migrations in version order, each in its own transaction together with its history row |
| `db status` | lists every migration: `applied`, `pending`, `out_of_order` (older than the newest applied one), `changed` (file edited after it was applied) or `missing_file` |
| `db repair --status applied\|reverted <version>…` | marks versions applied without running them, or forgets them, like `supabase migration repair` |

- **History** is kept in `supabase_migrations.schema_migrations`, the table
  the Supabase CLI uses, so either tool can take over from the other.
  File checksums go in `supabase_migrations.usertasks_checksums`; a file
  edited after it was applied is reported, never re-run.
- **Concurrency:** a session advisory lock serialises runs (two replicas
  starting together): the second waits, then has nothing to do. Use a
  direct or session-mode connection — `MIGRATION_DATABASE_URL` if
  `DATABASE_URL` goes through PgBouncer in transaction mode.
- **Out of order:** like `supabase db push`, versions older than the newest
  applied one are refused unless `--include-all`, or marked applied with
  `db repair`.
- Connection: `MIGRATION_DATABASE_URL`, else `DATABASE_URL` (or `--db-url`);
  `DATABASE_AUTH` applies. Files: `--dir`, else `MIGRATIONS_DIR`, else
  `./supabase/migrations`.

### Connection pooling (PgBouncer and friends)

The postgres provider sets everything per transaction (`set_config(…,
true)`, i.e. `SET LOCAL`) and uses unnamed statements, so **transaction
pooling is safe** for the app: PgBouncer, Azure's built-in PgBouncer, RDS
Proxy, Supavisor, Neon's pooled endpoint, CloudNativePG's `Pooler`. Three
connections need a session (direct or session-mode) instead:

- migrations (advisory lock across transactions): `MIGRATION_DATABASE_URL`;
- the SSE realtime provider's `LISTEN`: `REALTIME_DATABASE_URL`;
- the scheduler worker's leader election: `SCHEDULER_DATABASE_URL`.

Pool size per app instance: `DATABASE_POOL_MAX` (default 10).

### Cloud and on-premises notes

**Plain PostgreSQL (VM, bare metal, Docker).** Run the migrations as the
`postgres` superuser, or as a database owner with `CREATEROLE`. Example:
`docker run -d -e POSTGRES_PASSWORD=… -p 5432:5432 postgres:17`, create a
database, `npm run admin -- db migrate`.

**Amazon RDS and Aurora PostgreSQL.** The master user (`rds_superuser`) has
`CREATEROLE` and owns the database; whether it can grant `BYPASSRLS` depends
on the engine version — either way works (see Privileges). `pg_trgm` and
`pgcrypto` are available; `pg_cron` is available on RDS if you want the
`pg_cron` scheduler (add it to `shared_preload_libraries`), otherwise use
the worker. RDS Proxy works in transaction mode for the app. For **IAM
database authentication** set `DATABASE_AUTH=aws`: the app (and
`usertasks-admin`) sign a 15-minute token with `@aws-sdk/rds-signer` and the
instance's credentials (ECS task role, instance profile, IRSA) for the URL's
host, port and user, and use it as the password (renewed 5 minutes before it
expires; open connections are unaffected). The user needs
`GRANT rds_iam TO <user>` and the role `rds-db:connect` on
`arn:aws:rds-db:<region>:<account>:dbuser:<DbiResourceId>/<user>`. TLS is
turned on and verified against `DATABASE_SSL_CA_FILE`, else the RDS CA bundle
shipped in the image (`certs/rds-global-bundle.pem`). The region comes from
`DATABASE_AWS_REGION`, the host name or `AWS_REGION`. With RDS Proxy, enable
IAM auth on the proxy and point `DATABASE_URL` at it. Or use a password from
Secrets Manager via `SECRETS_PROVIDER=aws_secrets_manager`. See
[AWS setup](setup-aws.md).

**Azure Database for PostgreSQL – Flexible Server.** Allow-list `pg_trgm`
and `pgcrypto` in the server parameter `azure.extensions` first. The admin
user is a member of `azure_pg_admin` (`CREATEROLE`, no superuser). For
**Microsoft Entra ID authentication** set `DATABASE_AUTH=azure`: the app
(and `usertasks-admin`) fetch a token for
`https://ossrdbms-aad.database.windows.net/.default` with
`DefaultAzureCredential` — managed identity on Container Apps / App Service
/ AKS (workload identity), `AZURE_CLIENT_ID` for a user-assigned identity —
and use it as the password; the user in `DATABASE_URL` is the Entra
principal's name, and the URL needs `sslmode=require`. Create that principal
with `pgaadauth_create_principal` and make it the schema owner (run the
migrations as it). The built-in PgBouncer (port 6432) works for the app;
keep the three session connections above on port 5432.

**Google Cloud SQL and AlloyDB.** The `postgres` user is a member of
`cloudsqlsuperuser` (`CREATEROLE`, no superuser). For **IAM database
authentication** set `DATABASE_AUTH=gcp`: an access token from Application
Default Credentials (the service's attached service account, GKE workload
identity) is the password; the user in `DATABASE_URL` is the IAM principal
(on Cloud SQL, the service account email without `.gserviceaccount.com`).
On Cloud Run, connect through the built-in Cloud SQL connection
(`?host=/cloudsql/PROJECT:REGION:INSTANCE`) or the Cloud SQL Auth Proxy
(which encrypts the connection; with `--auto-iam-authn` the proxy handles
the token and `DATABASE_AUTH` can stay `password`). Direct private-IP
connections need TLS with the instance's server CA. The Node.js Cloud SQL
Connector is not built in yet; the proxy covers the same cases.

**Neon.** Use the pooled endpoint (`-pooler` host) for `DATABASE_URL` and
the direct endpoint for `MIGRATION_DATABASE_URL`, `REALTIME_DATABASE_URL`
and `SCHEDULER_DATABASE_URL`. Neon roles are created with `CREATEROLE`;
whether `BYPASSRLS` is available or not, the app works (see Privileges).

**Kubernetes (CloudNativePG, Crunchy PGO, Zalando) and Patroni.** Point
`DATABASE_URL` at the read-write service (CloudNativePG `<cluster>-rw`, the
Patroni leader endpoint), never a replica. The operator's superuser secret
can run the migrations; a `Pooler` (PgBouncer, transaction mode) can front
the app. Run `node admin.cjs db migrate` as a Job or init container before
rolling out a new version.

**Supabase.** Unchanged: `supabase db push` (hosted) or `supabase db reset`
(local); `DB_PROVIDER=postgres` can also be used against a Supabase
database (`DATABASE_URL` = its direct or session-pooler connection string).

## Realtime

Live updates — the task list, the task queue, tasks you assigned, a task's
subtasks and timeline, the notification bell and the live log tail — arrive
through the realtime provider. Every change names the table, the operation
and the changed row ids; the page then re-reads what it shows through the
normal APIs, so what a user sees is always what they may read.

### `supabase` (default)

Supabase Realtime (`postgres_changes`) on the tables in the
`supabase_realtime` publication. Supabase applies each table's row-level
security to every subscriber.

### `sse` (built in, on-premises capable)

The browser holds one Server-Sent Events connection per tab to
`/api/internal/realtime` (session cookie auth), carrying all of that tab's
subscriptions. On the server:

- **Triggers.** Migration `20261105000000_realtime_notify.sql` adds
  statement-level triggers on `tasks`, `task_assignees`, `notifications`,
  `lifecycle_events`, `workflow_logs`, `object_audit_log`,
  `integration_call_logs` and `agent_runs`. Each statement sends one
  `pg_notify('usertasks_realtime', …)` with ids and routing columns only
  (tenant, assignee/assigner/parent, notification user), chunked below the
  8000-byte limit; statements touching more than 200 rows send one "bulk"
  notice naming the tenants. The triggers do nothing unless a listener has
  checked in during the last 90 seconds, so they cost one single-row lookup
  per statement on installs that use the Supabase provider.
- **One LISTEN connection per app instance.** It uses
  `REALTIME_DATABASE_URL`, else `DATABASE_URL`, else `SUPABASE_DB_URL`. It
  must be a session-mode connection (direct, or Supabase's session pooler on
  port 5432): transaction-mode poolers such as PgBouncer in transaction mode
  or Supabase's port 6543 do not deliver notifications. The connection opens
  with the first subscriber, reconnects with backoff, and closes after a
  minute without subscribers.
- **Per-subscriber filtering.** Each change goes only to subscribers who could
  read the row: the same tenant/user rules as the tables' SELECT policies
  (`rls_visible_tenant_ids()`, the current workspace for audit and integration
  logs, the user's own notifications), loaded through the user's own session
  and refreshed every 30 seconds. Subscribing to another user's queue or
  notifications is refused; task-specific subscriptions need a task the user
  can read; log streams need `settings.view`.
- **Reconnects.** Event ids are database timestamps. The browser reconnects
  with `Last-Event-ID` (on network errors, and when the stream ends itself
  before the platform's request time limit — 300 s on Vercel); the instance
  replays what it buffered (the last 2000 changes, with a 5-second overlap),
  or tells the page to refetch everything when it can't vouch for the gap
  (for example after reconnecting to a different instance).
- **Limits.** Up to 32 subscriptions per connection and 12 connections per
  user per instance; a heartbeat every 15 s keeps proxies from closing idle
  streams. A client that stops reading has its changes dropped and gets one
  "refetch everything" when it catches up.
- **Fallback: polling.** With no connection string — or before the migration
  is applied — each instance polls the tables for rows changed since its
  cursor every 2 seconds. Inserts and updates that move a timestamp are seen;
  deletes and in-place flag changes (marking a notification read) are not.

**Multiple instances.** Every instance listens on its own, so no broker is
needed and any number of replicas work. (A Redis fan-out to share one LISTEN
connection between replicas is not needed at this scale and is not
implemented.)

### Switching

1. Apply the migrations (`20261105000000_realtime_notify.sql` is safe on any
   install; it keeps the Supabase publication unchanged so both providers
   work).
2. Set `REALTIME_PROVIDER=sse` (or the `providers.realtime` instance setting)
   and, unless `DATABASE_URL` already points at the database, a session-mode
   `REALTIME_DATABASE_URL`.
3. Restart the app. Browsers pick the provider up from the runtime config on
   their next page load; no rebuild is needed.

`usertasks-admin switch realtime --to sse` checks the LISTEN/NOTIFY
connection and writes the setting. To switch back, unset the variable (or
the setting) and restart. With `sse`
in use, Supabase Realtime can be disabled for the project — nothing else in
the app uses it.

## Storage

Uploaded files live in three buckets:

| Bucket | Holds | Key layout |
|--------|-------|------------|
| `task-files` | data-table files, integration and reference icons, files workflows write (documents, CSV / Excel exports, downloads) | `data-tables/<table>/…`, `integration-icons/…`, `reference-icons/…`, `workflow-files/<workspace>/…` |
| `logos` | workspace logo, theme logos and favicon | `<workspace>/<variant>.<ext>` |
| `brand-fonts` | uploaded theme fonts (woff2) | `<workspace>/<family>-<hash>.woff2` |

All three are public-read, as with Supabase: anyone with a file's URL can
fetch it. The browser never talks to the store: uploads go through the app's
server actions and API (which enforce the size and type limits — icons
512 KB, logos 2 MB, favicons 512 KB, fonts 1 MB woff2, data-table files
45 MB), and downloads use either the store's own public URL or the app's
`/files` route.

### Providers

| Provider | Runs on-premises | Public files served by |
|----------|------------------|------------------------|
| `supabase` (default) | no | Supabase public URLs (`…/storage/v1/object/public/…`), exactly as before |
| `local` | yes | the app: `/files/<bucket>/<key>` |
| `s3` | yes (MinIO, Ceph RGW, SeaweedFS, Garage, StorageGRID, …) | the app, or the store / a CDN with `STORAGE_PUBLIC_BASE_URL` |
| `azure_blob` | no | the app, or the storage account / CDN with `STORAGE_PUBLIC_BASE_URL` |
| `gcs` | no | the app, or `https://storage.googleapis.com/{bucket}` / a CDN with `STORAGE_PUBLIC_BASE_URL` |

The S3, Azure and Google SDKs are optional dependencies, loaded only by
their provider. The Docker image includes them; build with
`--build-arg INCLUDE_STORAGE_SDKS=false` to leave them out (see
[Optional drivers](optional-drivers.md)).

**Settings.** Each option can be an environment variable or a
`storage.<option>` row in `instance_settings` (the environment wins). Store
credentials (`secret_access_key`, `azure_connection_string`,
`azure_account_key`, `azure_sas_token`, `gcs_credentials_json`) as secret
settings: they are encrypted with `ENCRYPTION_KEY`, and the app refuses to
store them unencrypted.

| Option (`storage.…`) | Variable | Used by |
|---|---|---|
| `local_root` | `STORAGE_LOCAL_ROOT` | local |
| `bucket_map` | `STORAGE_BUCKET_MAP` | s3, azure_blob, gcs — JSON, e.g. `{"logos": "acme-logos", "task-files": "acme-files/prod"}` (physical bucket or container, optional key prefix) |
| `bucket` | `STORAGE_BUCKET` | s3, azure_blob, gcs — one bucket for everything, objects under `<bucket>/<key>` |
| `bucket_prefix` | `STORAGE_BUCKET_PREFIX` | s3, azure_blob, gcs — physical name = prefix + bucket |
| `public_base_url` | `STORAGE_PUBLIC_BASE_URL` | s3, azure_blob, gcs — `{bucket}` is replaced by the physical bucket, else `/<bucket>` is appended |
| `endpoint`, `region`, `access_key_id`, `secret_access_key`, `force_path_style` | `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | s3 |
| `azure_connection_string`, `azure_account_name`, `azure_account_key`, `azure_sas_token`, `azure_endpoint` | `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_KEY`, `AZURE_STORAGE_SAS_TOKEN`, `AZURE_STORAGE_BLOB_ENDPOINT` | azure_blob |
| `gcs_project_id`, `gcs_credentials_json`, `gcs_endpoint` | `GCS_PROJECT_ID`, `GCS_CREDENTIALS_JSON`, `GCS_API_ENDPOINT` | gcs |

Create the buckets (or containers) before switching; the app does not
create them at runtime. If you use `STORAGE_PUBLIC_BASE_URL`, make them
publicly readable; otherwise keep them private — the app reads them with its
own credentials and serves the files itself.

#### Local disk, NFS or SMB

```bash
STORAGE_PROVIDER=local
STORAGE_LOCAL_ROOT=/var/lib/usertasks/storage   # a volume shared by every app instance
```

Objects are files under `<root>/<bucket>/<key>`; content types and cache
settings sit beside them under `<root>/.meta/`. Writes go to a temporary file
and are renamed into place. Keys are validated and every path is confined to
the bucket directory (symlinks out of it are refused). With more than one
app instance, the directory must be shared storage (NFS, SMB, a
ReadWriteMany volume).

#### MinIO / Ceph RGW / other S3-compatible stores

```bash
STORAGE_PROVIDER=s3
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=usertasks
S3_SECRET_ACCESS_KEY=…
S3_FORCE_PATH_STYLE=true          # MinIO, Ceph and most on-prem stores
STORAGE_BUCKET_PREFIX=usertasks-  # buckets usertasks-task-files, usertasks-logos, usertasks-brand-fonts
```

#### AWS S3

```bash
STORAGE_PROVIDER=s3
S3_REGION=eu-west-1
STORAGE_BUCKET_MAP={"task-files":"acme-ut-files","logos":"acme-ut-public/logos","brand-fonts":"acme-ut-public/fonts"}
# No keys: the SDK uses the instance / task role or IRSA.
# Optional: serve public files from S3 or CloudFront instead of the app.
# STORAGE_PUBLIC_BASE_URL=https://{bucket}.s3.eu-west-1.amazonaws.com
```

#### Azure Blob Storage

```bash
STORAGE_PROVIDER=azure_blob
AZURE_STORAGE_ACCOUNT=acmeusertasks
STORAGE_BUCKET_PREFIX=usertasks-   # containers usertasks-task-files, …
```

With only the account name, the app signs in with Microsoft Entra ID through
`DefaultAzureCredential`: a system- or user-assigned **managed identity** on
App Service / Container Apps / AKS, **workload identity** on AKS
(`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_FEDERATED_TOKEN_FILE`), or
service-principal environment variables. Grant the identity
**Storage Blob Data Contributor** on the account (and **Storage Blob
Delegator** for signed URLs, which are user-delegation SAS). Alternatives: a
connection string (`AZURE_STORAGE_CONNECTION_STRING`), the account key
(`AZURE_STORAGE_KEY`), or a SAS token (`AZURE_STORAGE_SAS_TOKEN`, no signed
URLs). `AZURE_STORAGE_BLOB_ENDPOINT` overrides the endpoint (Azurite,
sovereign clouds, private endpoints).

#### Google Cloud Storage

```bash
STORAGE_PROVIDER=gcs
GCS_PROJECT_ID=acme-prod
STORAGE_BUCKET_MAP={"task-files":"acme-ut-files","logos":"acme-ut-logos","brand-fonts":"acme-ut-fonts"}
```

Without `GCS_CREDENTIALS_JSON` the client uses Application Default
Credentials: **workload identity** on GKE, the attached service account on
Cloud Run / Compute Engine, or `GOOGLE_APPLICATION_CREDENTIALS`. Grant
**Storage Object Admin** on the buckets (and
`iam.serviceAccounts.signBlob` on the service account for V4 signed URLs).
`GCS_API_ENDPOINT` points at an emulator such as fake-gcs-server.

### File references and the `/files` route

With a provider other than `supabase`, the database stores **references**
rather than URLs for files the app renders itself — workspace and theme
logos, the favicon, uploaded fonts, integration / reference / node icons:

```
storage://logos/<workspace>/logo-light.png?t=1730000000
```

The app resolves them when it renders (`@font-face`, `<img>`, the favicon)
and in API / MCP output, where themes still show plain URLs. File values
(data-table file cells, files workflows produce) keep a usable `url` — they
are often passed on to other systems — and gain `ref`:

```json
{ "name": "report.xlsx", "url": "https://tasks.example.com/files/task-files/workflow-files/…/report.xlsx", "path": "workflow-files/…/report.xlsx", "ref": "storage://task-files/workflow-files/…/report.xlsx", "size": 5120 }
```

With the default `supabase` provider nothing changes: the database keeps
Supabase public URLs, and existing ones keep working.

`GET /files/<bucket>/<key>` streams an object through the configured
provider. Public buckets need no session and are cached publicly (the
object's own `Cache-Control`, else one hour, with `ETag` / `304`). Every
response carries `X-Content-Type-Options: nosniff` and a sandboxing
`Content-Security-Policy`, and anything other than images, fonts, PDF,
plain text, audio and video downloads as an attachment, so an uploaded HTML
or SVG file can't run script in the app's origin. Keys are validated
(`..`, empty segments, backslashes and control characters are refused).
Private buckets — none today — would need an app-signed URL or a member of
the workspace that owns the key, and answer `404` otherwise.

The app's Content-Security-Policy already allows same-origin (`/files`) and
`https:` images, fonts and media; a plain-http `STORAGE_PUBLIC_BASE_URL` is
added only for loopback hosts (a local MinIO).

Workflows that read one of the app's own files (document templates, CSV /
Excel reads, file downloads) read it through the provider instead of over
HTTP when the provider isn't `supabase`.

### Switching providers and migrating files

Switching moves the objects and rewrites the stored URLs.
`usertasks-admin switch storage --to <provider>` runs these steps with a
backup, verification and rollback ([Switching providers](switching-providers.md#storage));
the building blocks are in `lib/storage/migrate.ts`:

1. **Copy objects.** `copyStorageObjects(source, target)` copies every object
   of the three buckets between any two providers, reading each copy back
   and comparing SHA-256. It is idempotent (identical objects are skipped)
   and reports conflicts instead of overwriting unless asked.
2. **Rewrite stored URLs.** `rewriteStorageUrls(db, { sourceConfig,
   targetUrl })` walks the known JSON columns (`tenants.branding`,
   `workspace_themes.theme`, `integrations.config`,
   `integration_references.request_config`, `custom_table_rows.data`,
   workflow and version nodes, run results / pause variables / traces, queue
   results, task metadata, agent run outputs). It runs as a dry run by
   default and reports every change; logos, theme assets and icons become
   `storage://` references, file values and other file URLs point at the new
   provider. Audit and call logs are history and are left alone.
3. **Switch.** Set `STORAGE_PROVIDER` and its options and restart (or let
   `switch storage` write the `providers.storage` setting).

Until step 2 runs, Supabase public URLs of the configured project still
resolve: with another provider the app serves them from the new store via
`/files` (so the old project can be retired once objects are copied).


## Scheduler

Background work — the workflow and agent queues, scheduled workflows, SLA
checks, reminders and escalations, deletions, directory and GitHub sync,
OAuth token refresh, log shipping, retention and log clean-up — is one job
registry (`lib/jobs/registry.ts`). Once a minute something runs a **tick**:
the jobs due in that minute (UTC), in-process, a few at a time, within about
50 seconds. Overlapping ticks skip (a lease in `app_cron.tick_lock`), and
every job is claim- or lease-based, so a tick that runs twice never does the
same work twice. The scheduler provider decides what triggers the tick.

| Provider | Who ticks | Needs | On-prem |
|----------|-----------|-------|---------|
| `pg_cron` (default) | pg_cron + pg_net in the database `POST /api/cron/tick` | pg_cron, pg_net, Supabase Vault | yes |
| `worker` | the app itself (in the Next.js server, or a `usertasks worker` container) | nothing extra | yes |
| `external` | your scheduler `POST`s `/api/cron/tick` | an HTTP scheduler | yes |

Every job also keeps its own endpoint under `/api/cron/*` (and the queue
processors) for manual runs.

### `pg_cron` (default)

The database runs three jobs: `usertasks-tick` (`* * * * *`, calls the tick
through `app_cron.invoke_endpoint`), `usertasks-housekeeping`
(`*/15 * * * *`, the [housekeeping](#housekeeping) pass when its interval is
due) and `usertasks-cron-housekeeping` (`30 3 * * *`, the daily forced
pass). The base URL
and the bearer secret live in Supabase Vault (`app_base_url`,
`cron_secret`). The migrations schedule the jobs; to (re)install them and
store both secrets from the app's configuration:

```bash
DATABASE_URL=postgresql://postgres:…@db.example.com:5432/postgres \
CRON_SECRET=… APP_URL=https://tasks.example.com \
npm run scheduler -- install-pg-cron   # idempotent; --base-url overrides APP_URL
npm run scheduler -- status            # jobs and whether the Vault secrets exist
```

### `worker` (built in)

The app ticks itself: a loop wakes one second after every minute boundary
and calls the job registry directly — no HTTP round trip, no pg_cron, no
Vault. It starts in two ways:

- **Inside the app server.** With `SCHEDULER_PROVIDER=worker`, every Node.js
  server instance (`next start`, the Docker image's `node server.js`) starts
  the worker at boot (`instrumentation.ts`). Not on Vercel: serverless
  functions don't stay running — use `pg_cron` or Vercel Cron there.
- **As its own process.** `npm run worker` from a source checkout, or
  `node worker.cjs` in the Docker image (same image, different command).
  `--once` runs the current minute and exits. Set `SCHEDULER_IN_PROCESS=false`
  on the web replicas when a dedicated worker runs.

**Any number of replicas is safe.** One leader ticks per minute:

- With a direct database connection (`SCHEDULER_DATABASE_URL`, else
  `DATABASE_URL`), each worker holds a session open and the one that wins
  `pg_try_advisory_lock` leads until its connection closes; the others try
  again every minute and take over within a minute of the leader stopping or
  dying. The connection must be session-mode: not PgBouncer in transaction
  mode or Supabase's port 6543.
- Without one (Supabase only), every replica tries each minute and the tick
  lease picks one; the winner keeps the lease until just before the next
  minute so a late replica skips.

A tick that is still running when the next minute starts makes that minute
skip on this replica (its work runs on the next tick). The worker logs one
line per tick with jobs run and failures.

Docker Compose, a dedicated worker:

```yaml
services:
  app:
    image: usertasks
    environment:
      SCHEDULER_PROVIDER: worker
      SCHEDULER_IN_PROCESS: "false"
      # … the usual app environment
  worker:
    image: usertasks
    command: ["node", "worker.cjs"]
    environment:
      SCHEDULER_PROVIDER: worker
      DATABASE_URL: postgresql://usertasks:…@postgres:5432/usertasks
      # … the same app environment (Supabase / database, ENCRYPTION_KEY, …)
```

On Kubernetes, either let the app Deployment's pods run the worker (leader
election makes extra replicas idle) or run a one-replica `worker`
Deployment with `command: ["node", "worker.cjs"]`.

### `external`

Anything that can send an HTTP request every minute can drive the tick:
`POST https://<app>/api/cron/tick` (GET also works). Authenticate with the
cron secret (`Authorization: Bearer <CRON_SECRET>`), or with a cloud
identity token as below. Pass `{"minute": "<ISO time>"}` to run a specific
minute (ignored when more than 5 minutes off the server clock) — useful when
the scheduler retries late.

**OS cron / systemd timer (on-prem).**

```cron
* * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://tasks.example.com/api/cron/tick >/dev/null
```

```ini
# /etc/systemd/system/usertasks-tick.service
[Service]
Type=oneshot
EnvironmentFile=/etc/usertasks/cron.env
ExecStart=/usr/bin/curl -fsS -X POST -H "Authorization: Bearer ${CRON_SECRET}" https://tasks.example.com/api/cron/tick

# /etc/systemd/system/usertasks-tick.timer
[Timer]
OnCalendar=*-*-* *:*:00
AccuracySec=1s
[Install]
WantedBy=timers.target
```

**Kubernetes CronJob.**

```yaml
apiVersion: batch/v1
kind: CronJob
metadata: { name: usertasks-tick }
spec:
  schedule: "* * * * *"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      backoffLimit: 0
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: tick
              image: curlimages/curl:8.10.1
              envFrom: [{ secretRef: { name: usertasks-cron } }]
              args: ["-fsS", "-X", "POST", "-H", "Authorization: Bearer $(CRON_SECRET)", "http://usertasks/api/cron/tick"]
```

(Or run the app image with `command: ["node", "worker.cjs", "--once"]` to
tick without going through HTTP.)

**Vercel Cron.** `vercel.json` → `{"crons": [{"path": "/api/cron/tick",
"schedule": "* * * * *"}]}`; Vercel sends `Authorization: Bearer
<CRON_SECRET>` when `CRON_SECRET` is set in the project. Per-minute cron
needs a Pro plan.

**Google Cloud Scheduler (OIDC).** Create an HTTP job with an OIDC token
instead of a shared secret; the app verifies Google's signature, the
audience and the calling service account:

```bash
gcloud iam service-accounts create usertasks-scheduler
gcloud scheduler jobs create http usertasks-tick --schedule="* * * * *" \
  --uri=https://tasks.example.com/api/cron/tick --http-method=POST \
  --oidc-service-account-email=usertasks-scheduler@PROJECT.iam.gserviceaccount.com \
  --oidc-token-audience=https://tasks.example.com/api/cron/tick
```

```bash
SCHEDULER_PROVIDER=external
SCHEDULER_OIDC_SERVICE_ACCOUNTS=usertasks-scheduler@PROJECT.iam.gserviceaccount.com
# SCHEDULER_OIDC_AUDIENCE=https://tasks.example.com/api/cron/tick  (default: <APP_URL>/api/cron/tick)
```

The allow-list is required: any Google account can obtain an ID token for any
audience. On Cloud Run, the built-in `worker` with Cloud Run's minimum
instances ≥ 1 and CPU always allocated is the alternative.

**Azure Container Apps Jobs / Functions timer / Logic Apps (Entra ID).** A
scheduled job with a managed identity requests a token for the app's
audience and calls the tick; the app verifies the Entra signature, tenant,
audience and the caller's identity:

```bash
# Container Apps Job (cron trigger) running curl with the job's managed identity
az containerapp job create -n usertasks-tick -g RG --environment ENV \
  --trigger-type Schedule --cron-expression "* * * * *" --replica-timeout 120 \
  --image mcr.microsoft.com/azure-cli --mi-system-assigned \
  --command "/bin/sh" --args "-c" "az login --identity >/dev/null && \
    TOKEN=\$(az account get-access-token --resource api://usertasks-tick --query accessToken -o tsv) && \
    curl -fsS -X POST -H \"Authorization: Bearer \$TOKEN\" https://tasks.example.com/api/cron/tick"
```

```bash
SCHEDULER_PROVIDER=external
SCHEDULER_ENTRA_TENANT_ID=<tenant id>
SCHEDULER_ENTRA_AUDIENCE=api://usertasks-tick          # application ID URI and/or client id, comma-separated
SCHEDULER_ENTRA_ALLOWED_PRINCIPALS=<managed identity object id or client id>
```

Register an app (`api://usertasks-tick`) for the audience; v1 and v2 tokens
are accepted. A Functions timer trigger or a Logic App "Recurrence" + HTTP
action with "Managed identity" authentication works the same way. Container
Apps can also run the built-in `worker` (min replicas ≥ 1).

**AWS EventBridge.** Three ways, from most to least AWS-native:

1. *EventBridge Scheduler → ECS RunTask* (`rate(1 minute)`) running
   `node worker.cjs --once` from the app image: IAM-authenticated end to end
   (the schedule's role needs `ecs:RunTask` and `iam:PassRole`), no tick
   endpoint and no shared secret. The worker's leader lock keeps overlapping
   runs safe. `deploy/aws/terraform` sets this up (`tick_mode = "scheduler_ecs"`).
2. *EventBridge rule → API destination* with an **OAuth client credentials**
   connection against a Cognito user pool app client: EventBridge fetches a
   Cognito access token and sends it as the bearer; the app checks the pool's
   signature, `token_use`, the client allow-list and an optional scope. The
   client secret lives only in the connection (EventBridge keeps it in
   Secrets Manager).

   ```bash
   SCHEDULER_PROVIDER=external
   SCHEDULER_COGNITO_USER_POOL_ID=eu-west-1_AbCdEf
   SCHEDULER_COGNITO_ALLOWED_CLIENTS=<app client id of the connection>
   SCHEDULER_COGNITO_SCOPE=usertasks/tick        # optional: a resource-server scope the client must hold
   ```

3. *EventBridge rule → API destination* with an **API key** connection whose
   header is `Authorization` = `Bearer <CRON_SECRET>` (`tick_mode = "api_destination"`
   in the Terraform). Simplest, for App Runner.

GitHub Actions `schedule` and other cron services use the cron secret.

### Switching

`usertasks-admin switch scheduler --to worker|external|pg_cron` does the
steps below (and can roll them back); see
[Switching providers](switching-providers.md#scheduler). By hand, from
`pg_cron` to `worker` or `external`:

1. Set `SCHEDULER_PROVIDER` (and, for `worker`, `DATABASE_URL` or
   `SCHEDULER_DATABASE_URL` for leader election) and restart / start the
   worker or your external scheduler.
2. Remove the pg_cron jobs: `npm run scheduler -- uninstall-pg-cron`. Until
   then pg_cron keeps calling the tick too (the lease prevents double runs);
   the app logs a warning about it. The Vault secrets are no longer needed.

Back to `pg_cron`: unset `SCHEDULER_PROVIDER`, run
`npm run scheduler -- install-pg-cron`, stop the worker / external job.

### Housekeeping

Some system tables grow on their own: pg_cron's run history
(`cron.job_run_details`, a row per job run), pg_net's responses
(`net._http_response`), expired entries of the cache store
(`app_cache.entries`: rate-limit windows, idempotency claims) and of built-in
auth (`app_auth.sessions`, `tokens`, `flow_states`, `replay_cache`).
Housekeeping purges them. It is **on by default**, needs no setup, and runs
with every scheduler: pg_cron calls it in the database
(`usertasks-housekeeping`), the worker and external schedulers through the job
registry (`housekeeping`, `housekeeping-daily`). Either way the pass is one
SQL function, `app_cron.run_housekeeping()`, that reads its settings from
`instance_settings`.

| Setting | Default | Range | Purges |
|---------|---------|-------|--------|
| `housekeeping.enabled` | `true` | `true` / `false` | Off stops the scheduled passes (an operator can still run one) |
| `housekeeping.interval_minutes` | `60` | 15, 30, 60, 120, 180, 240, 360, 480, 720, 1440 | How often the scheduled pass runs |
| `housekeeping.cron_history_hours` | `24` (1 day) | 1 hour – 90 days | `cron.job_run_details` rows older than this |
| `housekeeping.http_response_minutes` | `60` (1 hour) | 5 minutes – 7 days | `net._http_response` rows older than this |

Expired cache and sign-in rows always go (sessions and tokens a day after
expiry). There are no environment overrides: the pass runs in the database
and reads only the settings table.

Change and inspect it with the admin CLI or on **Settings → Infrastructure**
(instance admins: the Housekeeping card shows the settings, each table's size
and row estimate, recent passes, and has **Run now** / **Dry run**; saves are
recorded with the admin's user id, passes with their email):

```bash
usertasks-admin housekeeping show            # settings, table sizes, recent passes
usertasks-admin housekeeping set cron_history_hours 12h
usertasks-admin housekeeping set interval_minutes 30
usertasks-admin housekeeping set enabled false
usertasks-admin housekeeping set cron_history_hours default   # back to 1 day
usertasks-admin housekeeping run --dry-run   # rows each table would lose
usertasks-admin housekeeping run             # a pass now; rows deleted per table
```

`usertasks-admin status` prints a housekeeping line; `status` and `doctor`
warn when the last pass is late, when housekeeping is off, and when a purged
table is large (50 MB or 100,000 rows) or bloated (16 MB or more at 4 kB or
more per live row).

How a pass behaves:

- **Small statements.** Each `DELETE` removes at most 5,000 rows, in its own
  subtransaction, under `lock_timeout = 2s`. Deletes take row locks only, so
  pg_cron and pg_net keep inserting while a pass runs. A pass stops starting
  batches after its time budget (20 s scheduled, 120 s for the daily pass,
  60 s from the CLI) and reports `more`; the next pass continues. The CLI
  runs consecutive passes (up to 10), each its own transaction, until nothing is left.
- **No overlap, no double runs.** An advisory lock makes a second concurrent
  pass skip (`busy`); a scheduled pass skips (`not_due`) until the interval
  has passed since the last one, so the pg_cron job and the tick can both call
  it.
- **Not applicable is not an error.** Without pg_cron, pg_net, the postgres
  cache store or built-in auth, their tables are reported `not_installed`;
  where the database role may not delete from pg_cron's or pg_net's table it
  is reported `no_privilege`.
- **Every pass is recorded** in `app_cron.housekeeping_runs` (trigger, actor,
  rows deleted per table, notes; kept 30 days). Dry runs are not.

Tenant data is not housekeeping's: finished queue jobs (`QUEUE_RETENTION_DAYS`,
default 7), the `event_stream` outbox (each workspace's
`event_stream_retention_hours`) and OAuth codes and tokens stay with the daily
`cleanup-logs` job, and workspace content with each workspace's retention
policies. The provider switch log (`instance_provider_switches`) is kept: it
holds the snapshots `rollback` restores.

**Bloated run history on Supabase.** Deleting rows frees space for reuse;
it doesn't shrink the file. A `cron.job_run_details` that grew large before
housekeeping (production had 138 MB for ~18k rows) stays that size on disk
until its owner runs `VACUUM FULL`. On Supabase the owner is `supabase_admin`,
so ask Supabase support; with housekeeping keeping the table small, autovacuum
reuses the space and inserts stay fast either way.

## Email

Every email the app sends — invitations, task notifications, the workflow
**Send email** node — goes through the email provider. The sender is the
node's own `from`, else `EMAIL_FROM`; Reply-To is the node's, else
`EMAIL_REPLY_TO`. `EMAIL_FROM` is required by every provider except `resend`
(which falls back to Resend's onboarding sender, as before) and `console`.
With the default Supabase Auth, sign-in emails (confirmations, password
resets) are Supabase's own and are configured there; with built-in auth
(`AUTH_PROVIDER=builtin`) the app sends them through this provider.

| Provider | Use for | On-prem |
|----------|---------|---------|
| `resend` (default) | Resend | no |
| `smtp` | Exchange / Microsoft 365, Postfix, Sendmail, hMailServer, Google Workspace SMTP relay, SES SMTP, Mailpit | yes |
| `ses` | Amazon SES (API) | no |
| `azure_communication` | Azure Communication Services Email | no |
| `microsoft_graph` | Microsoft 365 / Exchange Online via Graph `sendMail` | no |
| `gmail` | Google Workspace via the Gmail API | no |
| `console` | development and tests: log + `.eml` files | yes |

The SDKs for `smtp` (nodemailer), `ses` and `azure_communication` are
optional dependencies, included in the Docker image by default (see
[Optional drivers](optional-drivers.md)).

### SMTP (Exchange, Postfix, any relay)

```bash
EMAIL_PROVIDER=smtp
EMAIL_FROM="UserTasks <tasks@corp.example>"
SMTP_HOST=mail.corp.example
SMTP_PORT=587
SMTP_STARTTLS=required        # required | opportunistic (default) | off
SMTP_USER=svc-usertasks       # leave out for an IP-allow-listed relay
SMTP_PASSWORD=secret://smtp-password
```

- **TLS.** `SMTP_SECURE=true` is implicit TLS (port 465). Otherwise the
  connection upgrades with STARTTLS: `required` refuses to send without it,
  `opportunistic` upgrades when offered, `off` never does (only for a relay
  on a trusted network, typically port 25). Certificates are verified; trust
  a private CA with `NODE_EXTRA_CA_CERTS`, or set
  `SMTP_TLS_SERVERNAME` when connecting by IP. `SMTP_TLS_REJECT_UNAUTHORIZED=false`
  turns verification off (not recommended).
- **Exchange Server.** Use a receive connector that allows the app's
  address to relay anonymously (port 25, `SMTP_STARTTLS=opportunistic`), or
  an authenticated mailbox on port 587.
- **Microsoft 365 SMTP AUTH** (`smtp.office365.com:587`, STARTTLS required)
  works where SMTP AUTH is still enabled for the mailbox; Graph is the
  long-term option.
- **Google Workspace SMTP relay:** `smtp-relay.gmail.com:587`, STARTTLS
  required, IP or SMTP-AUTH allow-listing in the Admin console.
- **Development:** Mailpit / MailHog on port 1025 with
  `SMTP_STARTTLS=off`.

### Amazon SES

```bash
EMAIL_PROVIDER=ses
EMAIL_FROM=tasks@corp.example     # a verified identity
SES_REGION=eu-west-1
# SES_CONFIGURATION_SET=usertasks  # optional
```

Credentials come from the AWS default chain (task role, instance profile,
IRSA) unless `SES_ACCESS_KEY_ID` / `SES_SECRET_ACCESS_KEY` are set. The role
needs `ses:SendEmail`.

### Azure Communication Services Email

```bash
EMAIL_PROVIDER=azure_communication
EMAIL_FROM=DoNotReply@<guid>.azurecomm.net      # a MailFrom address of a connected domain
ACS_EMAIL_ENDPOINT=https://my-acs.communication.azure.com   # managed identity
# or: ACS_EMAIL_CONNECTION_STRING=endpoint=https://…;accesskey=…
```

With only the endpoint, the app authenticates with Microsoft Entra ID
(`DefaultAzureCredential`: managed identity on Container Apps / App Service,
workload identity on AKS); give the identity a role on the Communication
Services resource that allows sending email (Contributor, or a narrower
custom role). ACS uses the sender display name configured on
the domain, not the one in `EMAIL_FROM`.

### Microsoft 365 / Exchange Online (Graph)

```bash
EMAIL_PROVIDER=microsoft_graph
EMAIL_FROM="UserTasks <tasks@corp.example>"
GRAPH_TENANT_ID=<tenant id>
GRAPH_CLIENT_ID=<app id>
GRAPH_CLIENT_SECRET=secret://graph-client-secret   # leave out to use a managed identity
# GRAPH_SENDER=tasks@corp.example                  # default: the EMAIL_FROM address
```

Register an app with the **Mail.Send** application permission (admin
consent), and limit it to the sending mailbox with an Exchange
application access policy (`New-ApplicationAccessPolicy`) or RBAC for
Applications. Without a client secret the app uses a managed identity
(`GRAPH_CLIENT_ID` then selects a user-assigned one).

### Gmail API (Google Workspace)

```bash
EMAIL_PROVIDER=gmail
EMAIL_FROM="UserTasks <tasks@corp.example>"
GMAIL_SERVICE_ACCOUNT_JSON=secret://gmail-service-account   # the key JSON
# GMAIL_SENDER=tasks@corp.example                          # default: the EMAIL_FROM address
```

Create a service account, enable domain-wide delegation for the scope
`https://www.googleapis.com/auth/gmail.send` in the Admin console, and send
as a real Workspace user. Without a key, Application Default Credentials are
used (they must be able to sign JWTs for the subject). Alternatively use the
Workspace SMTP relay with `smtp`.

### Console

`EMAIL_PROVIDER=console` logs recipients and subject for every message
(never the body) and, with `EMAIL_CONSOLE_DIR`, writes each message as an
`.eml` file. For development, CI and air-gapped demos.

## Secrets

Credentials for the other providers — storage keys, SMTP passwords, API
keys — can live in a secret store instead of in the environment or the
database. Any provider option, set as an environment variable or as an
`instance_settings` row, may be a **reference**:

```bash
SMTP_PASSWORD=secret://smtp-password
S3_SECRET_ACCESS_KEY=secret://usertasks/minio#secret_key   # field of a structured secret
```

The app resolves references when it reads the provider's configuration and
caches each value for `SECRETS_CACHE_TTL_SECONDS` (default 300), so a
rotated secret is picked up within that time without a restart. A missing
secret or an unreachable store is an error that names the option, the
secret and the store — never the value — and the provider using it fails
(an email reports "not sent"; a storage request returns an error). A
reference can be stored in `instance_settings` without encryption; a
credential itself can't.

| Store | `SECRETS_PROVIDER` | On-prem |
|-------|--------------------|---------|
| Environment variables, `<VAR>_FILE`, a mounted secrets directory | `env` (default) | yes |
| Encrypted in Postgres (`secrets.<name>` instance settings, AES-256-GCM with `ENCRYPTION_KEY`) | `db` | yes |
| Supabase Vault (`vault.decrypted_secrets`, direct DB connection) | `supabase_vault` | yes |
| HashiCorp Vault / OpenBao (KV v2) | `hashicorp_vault` | yes |
| Azure Key Vault | `azure_key_vault` | no |
| Google Secret Manager | `gcp_secret_manager` | no |
| AWS Secrets Manager | `aws_secrets_manager` | no |

`SECRETS_NAME_PREFIX` is prepended to every name (e.g. `usertasks/`). A
`#field` picks a key of a structured secret: native KV keys in Vault, a JSON
object's key elsewhere.

### `env` (default)

`secret://smtp-password` reads `smtp-password` or `SMTP_PASSWORD`; the
`SMTP_PASSWORD_FILE` convention (a path) and `SECRETS_FILES_DIR` (e.g.
`/run/secrets` for Docker / Kubernetes secret mounts, file
`<dir>/smtp-password`) work too.

### `db`

Values are `secrets.<name>` instance settings, always stored encrypted, so
`ENCRYPTION_KEY` must be set (it can't come from this store).

### HashiCorp Vault / OpenBao

```bash
SECRETS_PROVIDER=hashicorp_vault
VAULT_ADDR=https://vault.internal:8200
# VAULT_NAMESPACE=team-a          # Vault Enterprise / HCP, OpenBao namespaces
# VAULT_KV_MOUNT=secret           # KV v2 mount (default secret)
# Auth, one of:
VAULT_TOKEN=…                                     # token
# VAULT_ROLE_ID=… VAULT_SECRET_ID=…               # AppRole (VAULT_APPROLE_MOUNT, default approle)
# VAULT_K8S_ROLE=usertasks                        # Kubernetes (VAULT_K8S_MOUNT, default kubernetes)
```

`secret://usertasks/smtp#password` reads field `password` of
`<mount>/data/usertasks/smtp`; without a field the secret's `value` key (or
its only key) is used. AppRole and Kubernetes logins are reused until just
before the lease ends and repeated after a 403. A policy for the app:

```hcl
path "secret/data/usertasks/*" { capabilities = ["read"] }
```

For a private CA set `NODE_EXTRA_CA_CERTS`.

### Azure Key Vault

```bash
SECRETS_PROVIDER=azure_key_vault
AZURE_KEY_VAULT_URL=https://my-vault.vault.azure.net
```

Uses `DefaultAzureCredential` (managed identity on Container Apps / App
Service, AKS workload identity, or `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` /
`AZURE_CLIENT_SECRET`); grant **Key Vault Secrets User**. Key Vault names
allow letters, digits and dashes, so `_`, `.` and `/` in a name become `-`
(`secret://smtp_password` reads `smtp-password`).

### Google Secret Manager

```bash
SECRETS_PROVIDER=gcp_secret_manager
GCP_SECRET_MANAGER_PROJECT=my-project     # default GOOGLE_CLOUD_PROJECT
```

Uses Application Default Credentials (Cloud Run / GKE workload identity,
`GOOGLE_APPLICATION_CREDENTIALS`, or `GCP_SECRET_MANAGER_CREDENTIALS_JSON`);
grant `roles/secretmanager.secretAccessor`. `secret://name` reads the latest
version, `secret://name@3` version 3.
`GCP_SECRET_MANAGER_ENDPOINT` points the client at a regional endpoint
(`https://secretmanager.europe-west1.rep.googleapis.com`, for data
residency) or Private Service Connect; an `http://` endpoint switches the
client to its HTTP/1.1 REST mode (the reference GCP profile's stand-in).

### AWS Secrets Manager

```bash
SECRETS_PROVIDER=aws_secrets_manager
AWS_SECRETS_MANAGER_REGION=eu-west-1      # default AWS_REGION
```

Default AWS credential chain; the role needs `secretsmanager:GetSecretValue`.
Key/value secrets take a field: `secret://usertasks/smtp#password`.

### `ENCRYPTION_KEY`

The key that encrypts stored secrets is read at startup, environment first:

1. `ENCRYPTION_KEY=<key>`: used as is.
2. `ENCRYPTION_KEY=secret://<name>`: read from the secret store; if it
   can't be read the app refuses to start rather than store secrets in
   plaintext.
3. Unset, with an external store: the store's `encryption_key` (or
   `SECRETS_ENCRYPTION_KEY_NAME`). If it isn't there the app runs without a
   key, as it does today, and logs a warning.

The store holds the 32-byte key itself. To keep the key that encrypts the
data in a KMS instead (envelope encryption), see [KMS](#kms).

### Switching

Email and secrets are configuration only: set the variables (or the
`providers.email` / `providers.secrets` and option rows) and restart, or
run `usertasks-admin switch email|secrets --to <provider>`, which validates
the target first (a test email, every `secret://` reference resolving). To
move credentials into a store, create the secrets there, replace each
value with its `secret://` reference, restart, then remove the old values.

## Directory sync

Directory sync is per workspace (Settings → SSO & Directory, `/api/v1/directory-sync`,
`usertasks directory-sync …`, MCP `directory_sync_*`), not an instance
provider, but two of its connectors are the on-premises options:

| Directory | Transport | On-prem |
|-----------|-----------|---------|
| Microsoft Entra ID | Microsoft Graph (client credentials) | no |
| Okta | Okta API (SSWS token) | no |
| LDAP / Active Directory | LDAPS or StartTLS (CA bundle per connection), paged searches, service-account bind | yes |
| Google Workspace | Admin SDK Directory API, service account with domain-wide delegation | no |
| SCIM 2.0 (pushed by the IdP) | inbound `https://<APP_URL>/scim/v2`, bearer token per workspace | yes (with an on-prem IdP that speaks SCIM) |

Pulled directories run in the `directory-sync` job (every 10 minutes; each
connector syncs hourly unless `sync_interval_minutes` says otherwise), under
any scheduler provider. LDAP syncs only changes between daily full syncs
(`uSNChanged` on Active Directory, `modifyTimestamp` elsewhere); nested groups
resolve with `LDAP_MATCHING_RULE_IN_CHAIN` on AD and by recursion elsewhere.

Network: LDAP and the other pull connectors go through the egress guard, so
an LDAP server on a private address needs `ALLOW_PRIVATE_EGRESS=true` (cloud
metadata addresses stay blocked). SCIM needs the reverse: the IdP must reach
`/scim/v2` on the app (no session cookie; the bearer token is the only
credential — keep it behind TLS).

Credentials (bind password, Google key, Entra secret, Okta token) are stored
encrypted with `ENCRYPTION_KEY`, or as `secret://tenants/<workspace id>/<name>`
references resolved from the instance secret store at sync time. References
outside the workspace's own `tenants/<id>/` prefix are refused, so a
workspace admin cannot point a connector at an instance secret.

**LDAP bind login** (built-in auth): with the LDAP connection's `bind_login`
on, the organisation's login page verifies passwords with a bind as the
user's DN; unknown names fall through to built-in passwords. Supabase Auth
installs can use directory sync but not bind login.

SCIM tokens live in `scim_tokens` (SHA-256 only), SCIM resources in
`scim_resources` / `scim_group_members` (migration
`20261109000000_directory_sync_providers.sql`, service role only).

## Auth

Who may sign in, and how, comes from the auth provider. Every sign-in,
sign-out, password reset and single sign-on round trip runs on the server
(server actions and routes); the browser never calls an auth service and
never sees a token — the session lives in httpOnly cookies (`SameSite=Lax`,
`Secure` on https). The database sees the signed-in user the same way under
every provider: row-level security reads `auth.uid()` from the session's
claims.

| Provider | Sign-in | Sessions | On-prem |
|----------|---------|----------|---------|
| `supabase` (default) | Supabase Auth: email + password, Google / Microsoft configured in Supabase | Supabase (sb-* cookies) | no |
| `builtin` | email + password in the app's Postgres, plus any OIDC / SAML IdPs in `AUTH_SSO_PROVIDERS` | app (`app_auth.sessions`) | yes |
| `oidc` | only the OIDC IdPs in `AUTH_SSO_PROVIDERS` | app | yes (with an on-prem IdP) |
| `saml` | only the SAML IdPs in `AUTH_SSO_PROVIDERS` | app | yes (with an on-prem IdP) |

Invitations, the OAuth server (`/api/oauth/*`, consent page), API keys and
directory sync work the same with every provider: they ask the provider who
the signed-in user is.

### `supabase` (default)

Unchanged apart from where the calls run: the login, forgot-password and
reset pages post to server actions, which call Supabase Auth through
`@supabase/ssr` and write its session cookies (now `HttpOnly`). Google and
Microsoft sign-in, email templates, rate limits and SMTP stay in the Supabase
dashboard; `SSO_MICROSOFT=1` still shows the Microsoft button. With
`REALTIME_PROVIDER=supabase` the browser's realtime socket gets a
short-lived access token from the server instead of reading the session.

### `builtin`

Accounts, bcrypt password hashes and sessions live in the app's own Postgres,
in the private schema `app_auth` (migration
`20261106100000_builtin_auth.sql`; never exposed through PostgREST or granted
to `anon` / `authenticated`).

```bash
AUTH_PROVIDER=builtin
DATABASE_URL=postgresql://postgres:…@db:5432/postgres   # or AUTH_DATABASE_URL
APP_URL=https://tasks.example.com                         # links in emails, SSO redirect URIs
EMAIL_PROVIDER=smtp                                       # confirmation and reset emails
# With DB_PROVIDER=supabase or REALTIME_PROVIDER=supabase:
SUPABASE_JWT_SECRET=…                                     # the project's JWT secret
```

- **Sign-up** is by invitation, as on Supabase: the login page creates the
  account when the email has an invitation to the organisation entered
  (`AUTH_ALLOW_SIGNUP=true` lets anyone sign up). The first password sign-in
  needs a confirmed address (`AUTH_REQUIRE_EMAIL_CONFIRMATION`, default on):
  the app emails a one-time confirmation link (24 h). Arriving through the
  invitation email's link counts as confirmed. The cloud beta signup and
  `npm run bootstrap` create confirmed accounts.
- **Password reset**: `/forgot-password` emails a one-time link (1 h) to
  `/reset-password`. Setting the new password signs the user in and ends
  every other session. The page never says whether an account exists.
- **Passwords**: bcrypt, cost 10 — the same format as Supabase Auth, so
  migrated users keep their passwords. Minimum length
  `AUTH_PASSWORD_MIN_LENGTH` (default 8), at most 72 bytes.
- **Brute force**: per-IP and per-email rate limits on sign-in and reset
  requests, and a lockout after `AUTH_LOCKOUT_THRESHOLD` (default 10) wrong
  passwords for `AUTH_LOCKOUT_MINUTES` (default 15). Unknown emails cost the
  same time as wrong passwords.
- **Sessions**: a random 256-bit token in the `__Host-ut_session` cookie
  (`ut_session` on plain http); only its SHA-256 is stored. Idle timeout
  `AUTH_SESSION_IDLE_HOURS` (default 168, rolling), absolute lifetime
  `AUTH_SESSION_MAX_DAYS` (default 30). Sign-out revokes the session; a
  password change or reset revokes all of the user's sessions.
- **Emails** (confirmation, reset) are the app's own templates, sent through
  the email provider. Links always use `APP_URL`, never the request's host.
- **New accounts** get the same personal workspace, profile and home
  membership the Supabase trigger creates (`public.provision_auth_user`, which
  the trigger now calls too, so both paths are idempotent).

How the database sees a built-in session:

| `DB_PROVIDER` | Identity |
|---------------|----------|
| `postgres` | pg-query runs each request as role `authenticated` with the session's claims (`sub` = user id) |
| `supabase` | the session client sends PostgREST a 10-minute HS256 token for the same claims, signed with `SUPABASE_JWT_SECRET` |

`SUPABASE_JWT_SECRET` is the project's (legacy) JWT secret — Dashboard →
Project Settings → API → JWT Settings; for a local stack, `JWT_SECRET` from
`supabase status`. Supabase Realtime accepts the same tokens, so
`REALTIME_PROVIDER=supabase` works with built-in sessions too.

### Single sign-on (OIDC and SAML)

`AUTH_SSO_PROVIDERS` (or the encrypted instance setting
`auth.sso_providers`) is a JSON array of identity providers. With
`AUTH_PROVIDER=builtin` they appear on the login page next to the password
form; with `oidc` / `saml` they are the only way in. The login page shows
names and buttons only. Client secrets may be `secret://` references.

| URL to register at the IdP | |
|---|---|
| OIDC redirect URI | `<APP_URL>/auth/sso/<id>/callback` |
| SAML ACS (HTTP-POST) | `<APP_URL>/auth/saml/<id>/acs` |
| SAML SP entity id and metadata | `<APP_URL>/auth/saml/<id>/metadata` |
| Bookmark / IdP app tile (SP-initiated) | `<APP_URL>/auth/sso/<id>/start` |

`npm run auth -- redirect-uris` prints them for the configured IdPs.

Fields for every IdP:

| Field | Default | |
|-------|---------|---|
| `id` | — | lowercase, used in the URLs above |
| `type` | — | `oidc` or `saml` |
| `name` | from the preset | button label |
| `jit` | `true` | create an account on first sign-in |
| `allowedDomains` | any | email domains allowed to sign in. For SAML, Entra ID and AD FS (which don't attest email ownership) it is also what makes the IdP's emails trusted for JIT accounts and linking — set it to the domains your directory owns |
| `trustEmail` | `false` | trust the IdP's email without `email_verified` / `allowedDomains` (only when the IdP serves a single organisation that owns every address it issues) |
| `linkByEmail` | `true` | sign in as the existing account with the same verified email (password users, directory-synced users, migrated users) |
| `defaultOrg` | none | organisation (slug) new accounts join; without it they only get a personal workspace |
| `defaultRole` | `viewer` | role for new accounts in `defaultOrg` |
| `groupsClaim` | `groups` / preset | claim or attribute listing groups or roles |
| `roleMapping` | none | `{ "<group>": "<role>" }`; the highest mapped role in `defaultOrg` is applied on every sign-in |

Directory sync (Settings → SSO & Directory: Entra ID, Okta, LDAP / Active
Directory, Google Workspace, SCIM) keeps working: synced users have accounts
without passwords and sign in through the matching IdP, linked by email — or,
with an LDAP connection's **bind login**, with their directory password (see
[Directory sync](#directory-sync)).

#### OIDC

Authorization code flow with PKCE (S256), `state` (single use, bound to the
browser that started it) and `nonce`; the ID token's signature (IdP JWKS),
issuer, audience, expiry and nonce are checked, and userinfo is merged when
available. Fields: `issuer` (or a preset's fields), `clientId`,
`clientSecret` (optional for public clients), `scopes` (default `openid email
profile`), `emailClaim`, `nameClaim`, `userinfo`. Emails count as verified
with `email_verified: true` (Google, Okta, Auth0, Keycloak, …); Entra ID and
AD FS send no such claim, so set `allowedDomains` (or `trustEmail`).

| Preset | Fields | Notes |
|--------|--------|-------|
| `entra` | `tenantId` | Microsoft Entra ID, single tenant. App registration → Authentication → Web redirect URI; add the optional `email` claim and a `groups` claim for role mapping. |
| `entra_multitenant` | `allowedTenants` (optional) | Any work or school account (`organizations`). The issuer is checked per tenant; emails count as verified only with the `xms_edov` claim (or `trustEmail`). |
| `entra_external_id` | `tenantSubdomain`, `tenantId` | Entra External ID (`<subdomain>.ciamlogin.com`). |
| `google` | `hostedDomain` (optional) | Google / Google Workspace. With `hostedDomain` only that Workspace domain's accounts (`hd` claim) get in. |
| `okta` | `domain`, `authorizationServerId` (optional) | Okta org or custom authorization server. Add a `groups` claim for role mapping. |
| `auth0` | `domain` | |
| `keycloak` | `baseUrl`, `realm` | Client: confidential, standard flow, redirect URI above. |
| `authentik` | `baseUrl`, `slug` | OAuth2/OpenID provider + application. |
| `zitadel` | `domain` | ZITADEL Cloud or self-hosted. |
| `dex` | `baseUrl` (the issuer) | Requests the `groups` scope when `groupsClaim` is set. |
| `adfs` | `baseUrl` | AD FS 2016+ application group (server application + web API). |
| `cognito` | `userPoolId`, `domain` (hosted UI / managed login domain, optional), `region` (optional) | Amazon Cognito user pool. The issuer is `https://cognito-idp.<region>.amazonaws.com/<userPoolId>`; with `domain` (`acme.auth.eu-west-1.amazoncognito.com` or a custom domain) sign-in, token and userinfo go there. Groups come from `cognito:groups` (map them with `roleMapping`). App client: confidential, authorization code grant, scopes `openid email profile`, callback URL above. |
| `generic` | `issuer` | any other OpenID Connect provider (Authelia, Gluu, Ping, OneLogin, JumpCloud …). |

```json
[{ "id": "entra", "type": "oidc", "preset": "entra", "tenantId": "contoso.onmicrosoft.com",
   "clientId": "…", "clientSecret": "secret://entra-client-secret",
   "allowedDomains": ["contoso.com"], "defaultOrg": "contoso", "defaultRole": "member",
   "roleMapping": { "<admin group object id>": "admin" } },
 { "id": "keycloak", "type": "oidc", "preset": "keycloak", "baseUrl": "https://sso.corp.local",
   "realm": "corp", "clientId": "usertasks", "clientSecret": "secret://keycloak-client" },
 { "id": "cognito", "type": "oidc", "preset": "cognito", "userPoolId": "eu-west-1_AbCdEf",
   "domain": "acme.auth.eu-west-1.amazoncognito.com", "clientId": "…",
   "clientSecret": "secret://cognito-client-secret", "defaultOrg": "acme",
   "roleMapping": { "admins": "admin", "staff": "member" } }]
```

#### SAML 2.0

SP-initiated (signed `AuthnRequest` ids are remembered and the response's
`InResponseTo` must match one, once) and IdP-initiated sign-in
(`allowIdpInitiated`, default true). Assertions must be signed
(`wantAssertionsSigned`, default true); audience, `NotBefore` /
`NotOnOrAfter` and the subject confirmation are checked with
`acceptedClockSkewMs` (default 60000); each assertion id is accepted once.
A RelayState only ever redirects to a local path. Needs the optional
package `@node-saml/node-saml` (included by default; see
[Optional drivers](optional-drivers.md)).

Fields: `metadataUrl` or `metadataXml` (fills in the IdP's SSO URL,
signing certificates and entity id), or `entryPoint` + `idpCert` (+
`idpIssuer`); `spEntityId`, `identifierFormat`, `emailAttribute`,
`nameAttribute`. The email comes from the email attribute, else from a NameID
in email format; set `allowedDomains` (or `trustEmail`) so it is trusted for
new accounts and linking.

| Preset | Attributes | Setup |
|--------|-----------|-------|
| `adfs` | `…/claims/emailaddress`, `…/claims/name`, `…/claims/Group` | Relying party trust from our metadata URL; claim rules for E-Mail Address, Name, Group; NameID = email. `metadataUrl`: `https://<adfs>/FederationMetadata/2007-06/FederationMetadata.xml`. |
| `entra` | `…/claims/emailaddress`, `…/identity/claims/displayname`, `…/claims/groups` | Enterprise application → SAML; Identifier = entity id, Reply URL = ACS; `metadataUrl` = App Federation Metadata Url. |
| `okta` | `email`, `name`, `groups` | SAML 2.0 app: Single sign-on URL = ACS, Audience URI = entity id; attribute statements `email`, `name`; group attribute `groups`. |
| `google` | `email`, `name`, `groups` | Workspace custom SAML app: ACS URL, Entity ID, Name ID = primary email; download the IdP metadata into `metadataXml`. |
| `keycloak` | `email`, `name`, `groups` | SAML client with client ID = entity id, valid redirect = ACS; mappers for email, name, group list. `metadataUrl`: `<base>/realms/<realm>/protocol/saml/descriptor`. |
| `shibboleth` | `mail`, `displayName`, `isMemberOf` (urn:oid names) | Load our SP metadata; release the attributes above. |
| `onelogin` | `User.email`, `User.FirstName`, `memberOf` | SAML Custom Connector (Advanced). |
| `pingfederate` | `mail`, `cn`, `memberOf` | SP connection from our metadata. |

```json
[{ "id": "adfs", "type": "saml", "preset": "adfs",
   "metadataUrl": "https://adfs.corp.local/FederationMetadata/2007-06/FederationMetadata.xml",
   "allowedDomains": ["corp.local"], "defaultOrg": "corp",
   "roleMapping": { "UserTasks Admins": "admin" } }]
```

### Switching to built-in auth (and back)

Sessions can't move between providers: **everyone signs in again** after a
switch. Passwords can: Supabase stores bcrypt hashes, and the migration copies
them with the user ids, so every foreign key and membership stays valid.

`usertasks-admin switch auth --to builtin|oidc|saml` runs steps 3–5 (copy,
session revocation, provider setting, redirect URIs) with a backup of
`app_auth` and a rollback — see [Switching providers](switching-providers.md#auth).
The manual route:

1. Apply the migrations (`20261106000000_auth_portability.sql` repoints the
   foreign keys that referenced `auth.users` to `public.users` and adds the
   shared provisioning function; `20261106100000_builtin_auth.sql` adds
   `app_auth`).
2. Configure email (`EMAIL_PROVIDER`, `EMAIL_FROM`), `APP_URL`,
   `DATABASE_URL` and, while the data API or realtime stay on Supabase,
   `SUPABASE_JWT_SECRET`.
3. Copy the users: `npm run auth -- migrate-users --dry-run`, then without
   `--dry-run`. Accounts keep their ids, emails, passwords and confirmation;
   Google / Azure identities are copied too — map them to your IdP ids so
   SSO users link by subject (`--map google=oidc:google,azure=oidc:entra`;
   otherwise they link by verified email). Re-running is safe; run it again
   right before the switch.
4. For SSO, register the redirect / ACS URLs (`npm run auth -- redirect-uris`)
   and set `AUTH_SSO_PROVIDERS`.
5. Set `AUTH_PROVIDER=builtin` (or `oidc` / `saml`) and restart. Users sign in
   with their existing password or through SSO.

To go back, unset `AUTH_PROVIDER` and restart: Supabase Auth's data was only
read. Accounts created while on built-in auth don't exist in Supabase Auth;
invite them again (or create them with the Supabase admin API using the same
ids).

The admin CLI's `usertasks-admin switch auth` will wrap these steps.

## Cache

Small, short-lived state that has to agree across every app instance lives
in the cache store:

- **rate limits** — API key creation, failed API-key audit sampling, the
  OAuth token endpoint, built-in sign-in / sign-up / password reset, agent
  runs (per user and per workspace), public signups, the contact form,
  LDAP bind sign-in (per IP and per name) and SCIM requests (per token, and
  failed SCIM authentication per IP);
- **invalidations** — an API key or OAuth token revoked (or a role or
  membership changed) on one instance is dropped from every instance's
  credential cache; an instance setting changed by the app or
  `usertasks-admin` reaches every instance at once instead of after the
  30-second settings cache;
- **idempotency claims** — two concurrent `POST /api/v1/tasks/ingest` calls
  with the same `idempotency_key` create one task (the second waits for it).

None of it is the source of truth: losing the store resets rate-limit
windows and makes caches reload, nothing more.

| Store | `CACHE_PROVIDER` | Shared by replicas | On-prem |
|-------|------------------|--------------------|---------|
| In-process memory | `memory` (default) | no | yes |
| PostgreSQL (UNLOGGED table in the app database) | `postgres` | yes | yes |
| Redis, Valkey, KeyDB, Dragonfly; Azure Cache for Redis / Azure Managed Redis; Memorystore; ElastiCache; Upstash | `redis` | yes | yes |

With `memory` every instance counts on its own, so with N replicas a
"20 per minute" limit allows up to 20 × N, and other replicas see a revoked
credential only when their 60-second credential cache expires — exactly
the behaviour before this provider existed, and fine for a single instance.
Run `postgres` or `redis` as soon as there is more than one app instance
(or a separate worker that shares limits).

Other instances look for invalidations at most every
`CACHE_INVALIDATION_CHECK_MS` (default 1000 ms: one small read per
authenticated API request at most once a second). Several installs can
share one Redis with different `CACHE_KEY_PREFIX` values (default
`usertasks:`). If a shared store is unreachable, rate limits fall back to
per-instance counting, credentials are re-validated against the database,
and a warning is logged at most once a minute.

### `postgres`

No extra service: migration `20261108000000_cache_store` adds the UNLOGGED
table `app_cache.entries` and `public.app_cache_*` functions that only the
service role may execute. Each operation is a single statement, so
concurrent hits from many instances never lose a count. UNLOGGED tables are
not WAL-logged or replicated and are emptied after a crash — fine for this
data, and much cheaper to write. The scheduler's `cache-sweep` job (every
10 minutes) deletes expired rows.

```bash
CACHE_PROVIDER=postgres
```

### `redis`

```bash
CACHE_PROVIDER=redis
CACHE_REDIS_URL=redis://valkey:6379            # rediss://… for TLS; default REDIS_URL
# CACHE_REDIS_USERNAME=usertasks               # Redis 6+ ACL user
# CACHE_REDIS_PASSWORD=secret://redis-password
# CACHE_REDIS_DB=0
# CACHE_REDIS_TLS_CA_FILE=/certs/redis-ca.pem  # or NODE_EXTRA_CA_CERTS
```

The client is built in (no extra package) and speaks RESP2 over one
pipelined connection per process, reconnecting on failure. Redis Cluster
mode is not supported — use a non-clustered (primary/replica) instance;
Azure Managed Redis with the *Enterprise* cluster policy and Memorystore
for Valkey with cluster mode disabled present a single endpoint and work.
Commands time out after `CACHE_REDIS_COMMAND_TIMEOUT_MS` (default 2000).

**Azure Cache for Redis / Azure Managed Redis with Microsoft Entra ID**
(no access keys): enable Entra authentication, add the app's managed
identity as a Redis user, and set

```bash
CACHE_REDIS_URL=rediss://my-cache.redis.cache.windows.net:6380
CACHE_REDIS_AUTH=entra
CACHE_REDIS_USERNAME=<object id of the managed identity>
```

Tokens come from `DefaultAzureCredential` (managed identity, workload
identity, or `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`)
for `CACHE_REDIS_ENTRA_SCOPE` (default `https://redis.azure.com/.default`)
and are re-sent on the open connection before they expire.

**Memorystore** (Google Cloud): `rediss://<ip>:6378` with in-transit
encryption and `CACHE_REDIS_TLS_CA_FILE` pointing at the instance's server
CA; either an AUTH string (`CACHE_REDIS_PASSWORD`) or, for Memorystore for
Valkey, IAM authentication with `CACHE_REDIS_AUTH=gcp_iam` (an access token
from Application Default Credentials; grant `roles/memorystore.dbConnectionUser`).

**Amazon ElastiCache (Valkey 7.2+ / Redis OSS 7+) and MemoryDB with IAM
authentication:** enable in-transit encryption, create a user with
authentication mode IAM (its user id must equal its user name), add it to
the cache's user group, give the app's role `elasticache:Connect` (or
`memorydb:Connect`) on the cache and the user, and set

```bash
CACHE_REDIS_URL=rediss://master.my-cache.abc123.euw1.cache.amazonaws.com:6379
CACHE_REDIS_AUTH=aws_iam
CACHE_REDIS_USERNAME=usertasks-app
CACHE_REDIS_AWS_CACHE_NAME=my-cache        # replication group id / serverless cache / MemoryDB cluster
# CACHE_REDIS_AWS_REGION=eu-west-1          # default AWS_REGION
# CACHE_REDIS_AWS_SERVERLESS=true           # ElastiCache Serverless
# CACHE_REDIS_AWS_SERVICE=memorydb          # MemoryDB
```

The password is a SigV4-presigned `connect` request signed with the
instance's credentials, valid 15 minutes and re-sent on the open connection
before it lapses. TLS is on unless `CACHE_REDIS_TLS=false`.

### Switching

Configuration only: `usertasks-admin switch cache --to postgres` (or
`--to redis --set redis_url=redis://…`) checks the store first — a probe
key written, read back and deleted, and a rate-limit window counted across
two calls — then writes `providers.cache`. Rate-limit windows start empty on
the new store. `usertasks-admin doctor --area cache` runs the same checks.

## KMS

Secrets stored in the database — connector and integration credentials,
log-destination tokens, the package signing key, encrypted instance
settings — are encrypted with AES-256-GCM. By default the key is
`ENCRYPTION_KEY` (ciphertext `enc:v1:…`). With **envelope encryption** they
are encrypted with a random 256-bit *data key* instead (`enc:v2:<key id>:…`),
and only the data key wrapped by a key-encryption key in a KMS is stored
(`app_kms.data_keys`). The app unwraps the data keys once at startup and
keeps them in memory; the KMS never sees the data and the key-encryption key
never leaves it.

| Key-encryption key | `KMS_PROVIDER` | On-prem |
|--------------------|----------------|---------|
| `ENCRYPTION_KEY` (environment or secret store) | `env` (default) | yes |
| HashiCorp Vault / OpenBao Transit | `vault_transit` | yes |
| AWS KMS | `aws_kms` | no |
| Azure Key Vault key or Managed HSM key | `azure_key_vault` | no |
| Google Cloud KMS (incl. Cloud HSM, Cloud EKM) | `gcp_kms` | no |

Nothing changes until a data key exists: with `KMS_PROVIDER=env` and no
data keys, secrets are `enc:v1` exactly as before. Existing `enc:v1` values
keep decrypting with `ENCRYPTION_KEY` for as long as it is set, so turning
envelope encryption on needs no downtime and no up-front re-encryption:

```bash
usertasks-admin kms rotate --yes        # data key #1, wrapped by the configured KMS
usertasks-admin kms rewrap --yes        # re-encrypt every stored secret under it (resumable)
usertasks-admin kms status              # data keys, values per key, recent rewraps
```

**Startup.** The app, the worker and the admin CLI load the data keys at
startup (after `ENCRYPTION_KEY`). With `env` and no data keys this is one
lookup. With any other provider startup fails closed: if the data keys
can't be read or the active one can't be unwrapped, the app refuses to start
rather than write secrets it couldn't read back. An older data key that
fails to unwrap is only a warning (values still encrypted with it fail with
a clear error). Running processes pick up keys created elsewhere within
`KMS_REFRESH_SECONDS` (default 60).

**Rotation.** `kms rotate` creates a new data key; it encrypts new values
from `KMS_ACTIVATION_SECONDS` (default 120) later, so every running process
has loaded it first (`--activate-in 0` for a single instance). `kms rewrap`
then re-encrypts every stored value under the newest active key, in batches
of `--batch` rows (default 200): each batch locks its rows, re-encrypts and
commits together with the run's progress, so a run that stops — KMS
unreachable, Ctrl+C, a crash, a value that can't be decrypted — has
re-encrypted exactly the batches it reported, and running the command again
resumes from there (`--restart` rescans from the start; `--dry-run` checks
without writing). Values already under the target key are left alone, so
re-running is always safe. Only one rewrap runs at a time. `kms prune`
deletes data keys no stored value uses (never the active one).

Rotating the *key-encryption key* in the KMS (a new Vault Transit version,
a new Key Vault key version, KMS automatic rotation) needs nothing: existing
data keys keep unwrapping. `kms rewrap-keys` re-wraps every data key with
the newest version (`--force` for keys already wrapped by this provider).

**What stays on `ENCRYPTION_KEY`.** The settings needed to reach the KMS —
`kms.*` options and the secret store's own options in `instance_settings` —
are always `enc:v1`: a KMS can't protect its own credentials. Keep them in
the environment, as mounted files or in an external secret store
(`secret://…`) and `ENCRYPTION_KEY` is no longer needed once
`kms status` shows no `enc:v1` values. (A `secret://` reference in a KMS
option can't point at the `db` secret store, whose values are themselves
encrypted.)

### `vault_transit`

```bash
KMS_PROVIDER=vault_transit
VAULT_ADDR=https://vault.internal:8200
VAULT_TRANSIT_KEY=usertasks          # vault write -f transit/keys/usertasks
# VAULT_TRANSIT_MOUNT=transit
# Auth as for the Vault secret store: VAULT_TOKEN, AppRole or Kubernetes.
```

Policy: `path "transit/encrypt/usertasks" { capabilities = ["update"] }` and
the same for `transit/decrypt/usertasks`.

### `aws_kms`

```bash
KMS_PROVIDER=aws_kms
AWS_KMS_KEY_ID=arn:aws:kms:eu-west-1:123456789012:key/…   # or alias/usertasks
# AWS_KMS_REGION=eu-west-1         # default AWS_REGION
# AWS_KMS_ENDPOINT=https://vpce-….kms.eu-west-1.vpce.amazonaws.com
```

The default credential chain (task role, instance profile, IRSA) needs
`kms:Encrypt` and `kms:Decrypt` on the key. The data-key id is sent as
encryption context (`usertasks: usertasks:data-key:<id>`), so every unwrap
is attributable in CloudTrail and a wrapped key can't be replayed under
another id. Needs the optional package `@aws-sdk/client-kms` (in the Docker
image by default).

### `azure_key_vault`

```bash
KMS_PROVIDER=azure_key_vault
AZURE_KMS_KEY_ID=https://my-vault.vault.azure.net/keys/usertasks   # or a Managed HSM key URL
# AZURE_KMS_KEY_ALGORITHM=RSA-OAEP-256   # RSA-OAEP, or A256KW for Managed HSM AES keys
```

`DefaultAzureCredential` (managed identity, workload identity, or a client
secret) with the **Key Vault Crypto Service Encryption User** role. The key
version that wrapped each data key is stored with it, so rotating the key
keeps old data keys unwrappable. Needs the optional package
`@azure/keyvault-keys`.

### `gcp_kms`

```bash
KMS_PROVIDER=gcp_kms
GCP_KMS_KEY_NAME=projects/my-project/locations/europe-west1/keyRings/usertasks/cryptoKeys/data
# GCP_KMS_CREDENTIALS_JSON=…            # default: Application Default Credentials
# GCP_KMS_ENDPOINT=https://cloudkms.europe-west1.rep.googleapis.com
```

Grant `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the key. The data-key
id is additional authenticated data. Cloud HSM and Cloud EKM keys work the
same way.

### Switching

`usertasks-admin switch kms --to aws_kms --set aws_kms_key_id=…` (or
`vault_transit`, `azure_key_vault`, `gcp_kms`, `env`) checks the target with
a probe key, then re-wraps every data key with it — each one unwrapped with
the KMS that wrapped it, wrapped again and verified before its row is
updated — and creates the first data key if there is none. Stored values
are not touched. Restart the app, then run `kms rewrap` to move `enc:v1`
values and older data keys onto the newest key. `rollback` re-wraps the
data keys with the previous KMS, including one the switch created, so
nothing written in between becomes unreadable.

