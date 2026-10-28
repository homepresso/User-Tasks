# Google Cloud setup

This is the reference deployment on Google Cloud. The template is in
`deploy/gcp/terraform/`, and `deploy/gcp/README.md` has the full commands.
The [GCP reference profile](deployment-profiles.md#google-cloud-gcp) runs
the same provider combination locally against emulators.

| Area | Google Cloud service | Settings |
|---|---|---|
| Hosting | Cloud Run service and a Cloud Run migrate job | |
| Database | Cloud SQL for PostgreSQL 16 with IAM database auth, over the Cloud Run Cloud SQL socket | `DB_PROVIDER=postgres`, `DATABASE_AUTH=gcp`, `DATABASE_URL=postgresql://<sa>%40<project>.iam@/usertasks?host=/cloudsql/<connection>` |
| Auth | Built-in, plus Google over OIDC | `AUTH_SSO_PROVIDERS` with `"preset":"google"` and `hostedDomain` |
| Storage | Cloud Storage (public access blocked) | `STORAGE_PROVIDER=gcs`, `GCS_PROJECT_ID`, `STORAGE_BUCKET_MAP` |
| Realtime | Built-in SSE | `REALTIME_PROVIDER=sse` |
| Scheduler | Cloud Scheduler every minute, with an OIDC token | `SCHEDULER_PROVIDER=external`, `SCHEDULER_OIDC_SERVICE_ACCOUNTS`, `SCHEDULER_OIDC_AUDIENCE` |
| Email | Workspace SMTP relay, or any SMTP relay | `EMAIL_PROVIDER=smtp`, `SMTP_*`, `SMTP_PASSWORD=secret://smtp-password` |
| Secrets | Secret Manager (`roles/secretmanager.secretAccessor`) | `SECRETS_PROVIDER=gcp_secret_manager`, `GCP_SECRET_MANAGER_PROJECT`, `ENCRYPTION_KEY=secret://encryption-key`; optionally `GCP_SECRET_MANAGER_ENDPOINT` for a regional endpoint |
| Log export (per workspace) | Cloud Logging or Pub/Sub destinations, with a service-account key | Settings → Log Export; `LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true` to let destinations use the service's workload identity (single-tenant only) |
| KMS (optional) | A Cloud KMS key wrapping the data keys (`roles/cloudkms.cryptoKeyEncrypterDecrypter`) | `KMS_PROVIDER=gcp_kms`, `GCP_KMS_KEY_NAME`; then `usertasks-admin kms rotate` and `kms rewrap` |
| Cache | Memorystore for Redis with in-transit encryption and an AUTH string, reached through Direct VPC egress, created by the template (needed with more than one instance; Memorystore for Valkey with IAM auth works too) | `CACHE_PROVIDER=redis`, `CACHE_REDIS_URL=rediss://<ip>:6378`, `CACHE_REDIS_TLS_CA_FILE` (the server CA, mounted from Secret Manager), `CACHE_REDIS_PASSWORD=secret://redis-auth` — or `CACHE_REDIS_AUTH=gcp_iam` on Valkey; `cache_enabled = false` for `CACHE_PROVIDER=postgres` |

## Steps

1. **Create the infrastructure:** `terraform apply` with
   `deploy_apps=false`. That enables the APIs and creates Artifact Registry,
   Cloud SQL, the buckets and the secrets.
2. **Push the image** to Artifact Registry. Build it with
   `--build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true` if workflows use the
   Snowflake, Oracle or MongoDB connectors ([Optional drivers](optional-drivers.md)).
3. **Grant the IAM database user its privileges.** Run the `db_grant_sql`
   output once as `postgres`, for example in Cloud SQL Studio. A new IAM
   database user has no privileges, so the migrations can't create the API
   roles without this step.
4. **Create the services:** `terraform apply` with `deploy_apps=true`. Then
   run the migrate job: `gcloud run jobs execute <prefix>-migrate`.
5. **Create the first workspace.** Run the migrate job once with overridden
   arguments (`node admin.cjs bootstrap --email … --org …`), with the
   password in `BOOTSTRAP_PASSWORD`.
6. **Check the install:** run `node admin.cjs doctor` the same way.

## Not wired up yet

- **The Cloud SQL Node.js Connector.** The app uses Cloud Run's built-in
  socket instead.

## Moving an existing Supabase install

See [Switching providers](switching-providers.md#moving-a-whole-install-off-supabase).
For the database step, the target role needs `cloudsqlsuperuser`.
