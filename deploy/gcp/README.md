# UserTasks on Google Cloud (reference deployment)

Terraform (google provider 6.x) in `terraform/`. Nothing here depends on
Supabase. Read [docs/infrastructure.md](../../docs/infrastructure.md) for what
each setting does.

## What gets created

| Resource | Purpose |
|---|---|
| Project APIs | Run, Cloud SQL Admin, Secret Manager, Cloud Scheduler, Artifact Registry, IAM, IAM Credentials, Storage, Resource Manager, Compute, Memorystore for Redis |
| Service account `<name>-app` | Runs the web service and the migration job: `cloudsql.client`, `cloudsql.instanceUser`, `storage.objectAdmin` on the buckets, `secretAccessor` on the app's secrets, token creator on itself (V4 signed URLs) |
| Service account `<name>-scheduler` | Identity of the Cloud Scheduler OIDC token (no roles) |
| Artifact Registry repository `<name>` | Image |
| Cloud Run service `<name>-web` | `node server.js` on port 3000, 1–5 instances, Cloud SQL connection mounted at `/cloudsql` |
| Cloud Run job `<name>-migrate` | `node admin.cjs db migrate` |
| Cloud Scheduler job `<name>-tick` (`* * * * *`, UTC) | `POST <APP_URL>/api/cron/tick` with an OIDC token for `<name>-scheduler` |
| Cloud SQL for PostgreSQL 16 `<name>-pg` + database `usertasks` | `cloudsql.iam_authentication=on`, IAM service-account user for `<name>-app`, public IP with **no** authorized networks and client certificates required (only the connector / Auth Proxy can connect), backups + PITR |
| GCS buckets `<prefix>-task-files`, `-logos`, `-brand-fonts` | Uniform access, public access prevention enforced |
| Secret Manager `encryption-key`, `cron-secret`, `smtp-password` (if set), `redis-auth` and `redis-ca` (with the cache), `db-postgres-password` | App secrets; the last one is only for the operator |
| VPC `<name>-vpc` + subnet `<name>-run`, Memorystore for Redis 7.2 `<name>-cache` (BASIC 1 GB by default) | The shared cache (rate limits, invalidations): AUTH string + in-transit encryption (server authentication), direct peering to the VPC; the web service reaches it with Direct VPC egress (private ranges only). `cache_enabled = false` leaves all of it out and uses `CACHE_PROVIDER=postgres` |

## Environment → resource

| Variable | Value |
|---|---|
| `DB_PROVIDER` | `postgres` |
| `DATABASE_URL` | `postgresql://<name>-app%40<project>.iam@/usertasks?host=/cloudsql/<project>:<region>:<name>-pg` (Cloud Run's built-in Cloud SQL connection; user = SA email without `.gserviceaccount.com`) |
| `DATABASE_AUTH` | `gcp` (ADC access token of the attached SA as the password) |
| `AUTH_PROVIDER` / `AUTH_SSO_PROVIDERS` | `builtin` by default; JSON for Google / other OIDC IdPs, secrets as `secret://…` |
| `REALTIME_PROVIDER` | `sse` |
| `SCHEDULER_PROVIDER` | `external` |
| `SCHEDULER_OIDC_SERVICE_ACCOUNTS` / `SCHEDULER_OIDC_AUDIENCE` | the scheduler SA / `<APP_URL>/api/cron/tick` |
| `CRON_SECRET` | Cloud Run secret reference to `cron-secret` (for manual `/api/cron/*` calls; the scheduled tick uses OIDC) |
| `STORAGE_PROVIDER` / `GCS_PROJECT_ID` / `STORAGE_BUCKET_MAP` | `gcs` / the project / JSON mapping the three logical buckets |
| `EMAIL_PROVIDER` / `EMAIL_FROM` / `SMTP_*` | `smtp` / variables; `SMTP_PASSWORD=secret://smtp-password` |
| `SECRETS_PROVIDER` / `GCP_SECRET_MANAGER_PROJECT` | `gcp_secret_manager` / the project |
| `ENCRYPTION_KEY` | `secret://encryption-key` (read from Secret Manager at startup; the app refuses to start if it can't) |
| `CACHE_PROVIDER` / `CACHE_REDIS_URL` / `CACHE_REDIS_PASSWORD` / `CACHE_REDIS_TLS_CA_FILE` | `redis` / `rediss://<ip>:6378` / `secret://redis-auth` / `/etc/usertasks/redis-ca/ca.pem` (the server CA, mounted from Secret Manager) — or `postgres` with the cache off |
| `APP_URL` | `https://<name>-web-<project number>.<region>.run.app` unless `app_url` is set |

## Prerequisites

- Terraform 1.6+, `gcloud` logged in (`gcloud auth application-default login`)
  as a project Owner (or equivalent: the config enables APIs and sets IAM).
- Docker, to build the image.
- An SMTP relay reachable on 587 or 465 (Google Cloud blocks outbound 25):
  Google Workspace SMTP relay, SendGrid, Mailgun, SES SMTP, your own.

## Deploy

```bash
cd deploy/gcp/terraform
cp terraform.tfvars.example terraform.tfvars      # edit
terraform init
terraform apply -var deploy_apps=false            # APIs, registry, Cloud SQL, buckets, secrets
IMAGE=$(terraform output -raw image)
```

Build and push from the repository root (`NEXT_PUBLIC_APP_URL` only feeds
statically rendered pages; the runtime `APP_URL` is what links and SSO use):

```bash
gcloud auth configure-docker europe-west1-docker.pkg.dev
docker build --platform linux/amd64 --build-arg NEXT_PUBLIC_APP_URL=https://tasks.example.com -t $IMAGE .
docker push $IMAGE
```

Before the first migration, run the one-time grant (next section), then:

```bash
terraform apply                                   # Cloud Run service, migrate job, scheduler
```

## After the first deploy

1. **One-time database grant.** IAM users start without privileges, and the
   app's user must own the schema (Cloud SQL has no `BYPASSRLS`). Sign in to
   Cloud SQL Studio (console → the instance → Cloud SQL Studio) as `postgres`,
   database `usertasks`, with the password from
   `gcloud secrets versions access latest --secret db-postgres-password`, and
   run the SQL printed by `terraform output -raw db_grant_sql`. It makes the
   app user a member of `cloudsqlsuperuser` (which owns the database) and
   pre-creates the `anon` / `authenticated` / `service_role` / `authenticator`
   roles the migrations expect, because `CREATEROLE` is not inherited through
   role membership.
2. **Migrate:** `gcloud run jobs execute usertasks-migrate --region europe-west1 --wait`.
   Run it again before every rollout of a new image.
3. **First tenant and owner:** `node admin.cjs bootstrap --email … --password … --org …`
   (being added to the admin CLI alongside this deployment; until it ships,
   `npm run bootstrap -- …` from a checkout through the Cloud SQL Auth Proxy).
   Run it as a one-off job execution with overridden arguments:
   `gcloud run jobs execute usertasks-migrate --region europe-west1 --wait --args=admin.cjs,bootstrap,--email,…,--password,…,--org,…`.
4. Check the install the same way with `--args=admin.cjs,doctor`.

## Notes

- **Tick authentication.** Cloud Scheduler sends a Google-signed OIDC ID
  token; the app verifies the signature, the audience
  (`SCHEDULER_OIDC_AUDIENCE`) and that the email is in
  `SCHEDULER_OIDC_SERVICE_ACCOUNTS`. No shared secret travels with the tick.
  The service allows unauthenticated invocations (it is a public web app with
  its own sign-in), so Cloud Run does not check the token itself; the app does.
- **Cloud SQL connection.** The Node.js Cloud SQL Connector is not built into
  the app; Cloud Run's built-in Cloud SQL connection (a managed Auth Proxy,
  unix socket under `/cloudsql`) covers it, with `DATABASE_AUTH=gcp` supplying
  the IAM token. The grant SQL in step 1 is based on Cloud SQL's documented
  roles and was not run against a live instance; if
  `GRANT cloudsqlsuperuser` is refused, grant the app user ownership of
  database `usertasks` and schema `public` by another route (e.g. Cloud SQL
  support for IAM-user database roles).
- **Org policies.** `allUsers` invoker is blocked by domain-restricted sharing
  in some organisations; set `allow_unauthenticated = false` and front the
  service with a load balancer + IAP, then set `app_url`.
- **Background work.** `cpu_idle = true` (request-based CPU). Background work
  after a response is throttled; the per-minute tick picks up anything left.
  Set `cpu_idle = false` in `main.tf` for always-allocated CPU.
- **Secrets in state.** Terraform generates `ENCRYPTION_KEY`, `CRON_SECRET` and
  the `postgres` password, so they are in the state file: use a remote backend
  with restricted access. Never change `encryption-key` once data has been stored.
- **Cost (rough, list prices, one region).** Cloud SQL `db-custom-1-3840`
  zonal + 20 GB ≈ US$50/month (HA doubles it); one always-warm Cloud Run
  instance (1 vCPU / 1 GiB, request-based CPU) ≈ US$10–30/month plus requests;
  Cloud Scheduler ≈ US$0.10/job/month; Artifact Registry, GCS and Secret
  Manager are usage-based and small at low volume.
