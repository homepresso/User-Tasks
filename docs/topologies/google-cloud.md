# Topology: single cloud on Google Cloud

The Google Cloud reference profile. Every area runs in one project and
region, and the app reaches every service as its service account, through
Application Default Credentials. It is tested locally against emulators
([Deployment profiles](../deployment-profiles.md#google-cloud-gcp)), and
the Terraform template in `deploy/gcp/` creates it.

<!-- ::topology gcp -->

## What runs where

| Area | Google Cloud service | Provider id | Native or compatible |
|---|---|---|---|
| Hosting | Cloud Run: a service and a migrate job | — | The Docker image |
| Database | Cloud SQL for PostgreSQL 16 (or AlloyDB) with IAM database auth, over the Cloud Run socket | `postgres`, `DATABASE_AUTH=gcp` | Native: an access token as the password |
| Auth | Built-in, with Google (or Google Workspace) over OIDC | `builtin` | Native preset `google` with `hostedDomain` |
| Storage | Cloud Storage, public access blocked | `gcs` | Native: Storage Object Admin on the buckets |
| Realtime | Built-in Server-Sent Events | `sse` | Built in |
| Scheduler | Cloud Scheduler every minute, with an OIDC token | `external` | Native: the app verifies the token and the calling service account |
| Email | The Workspace SMTP relay (or any relay), or the Gmail API | `smtp` / `gmail` | SMTP: compatible. Gmail: native (domain-wide delegation) |
| Secrets | Secret Manager | `gcp_secret_manager` | Native: `roles/secretmanager.secretAccessor`; regional endpoints for residency |
| KMS | Cloud KMS (including Cloud HSM and Cloud EKM) | `gcp_kms` | Native: `roles/cloudkms.cryptoKeyEncrypterDecrypter` |
| Cache | Memorystore for Redis or Valkey, in-transit encryption | `redis` | Native: an AUTH string, or IAM (`CACHE_REDIS_AUTH=gcp_iam`, Memorystore for Valkey) |
| Log export | Cloud Logging or Pub/Sub | `gcp_logging`, `gcp_pubsub` destinations | Native: a service-account key, or the service's identity when `LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true` (single-tenant installs only) |
| Directory sync | Google Workspace through the Directory API, or SCIM | per workspace | Native |

The image includes the Cloud Storage and Secret Manager SDKs by default. The Snowflake, Oracle and
MongoDB drivers need `--build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true`; see
[Optional drivers](../optional-drivers.md).

## Configuration

```bash
DB_PROVIDER=postgres
DATABASE_AUTH=gcp
DATABASE_URL=postgresql://usertasks-run%40acme-prod.iam@/usertasks?host=/cloudsql/acme-prod:europe-west1:acme-ut
AUTH_PROVIDER=builtin
AUTH_SSO_PROVIDERS=[{"id":"google","type":"oidc","preset":"google","hostedDomain":"corp.example","clientId":"…","clientSecret":"secret://google-client-secret"}]
REALTIME_PROVIDER=sse
SCHEDULER_PROVIDER=external
SCHEDULER_OIDC_SERVICE_ACCOUNTS=usertasks-scheduler@acme-prod.iam.gserviceaccount.com
STORAGE_PROVIDER=gcs
GCS_PROJECT_ID=acme-prod
STORAGE_BUCKET_MAP={"task-files":"acme-ut-files","logos":"acme-ut-logos","brand-fonts":"acme-ut-fonts"}
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp-relay.gmail.com
SMTP_PORT=587
SMTP_STARTTLS=required
SMTP_PASSWORD=secret://smtp-password
EMAIL_FROM="UserTasks <tasks@corp.example>"
SECRETS_PROVIDER=gcp_secret_manager
GCP_SECRET_MANAGER_PROJECT=acme-prod
# GCP_SECRET_MANAGER_ENDPOINT=https://secretmanager.europe-west1.rep.googleapis.com
ENCRYPTION_KEY=secret://encryption-key
KMS_PROVIDER=gcp_kms
GCP_KMS_KEY_NAME=projects/acme-prod/locations/europe-west1/keyRings/usertasks/cryptoKeys/kek
CACHE_PROVIDER=redis
CACHE_REDIS_URL=rediss://10.0.0.5:6378
CACHE_REDIS_TLS_CA_FILE=/secrets/memorystore-ca.pem
CACHE_REDIS_PASSWORD=secret://redis-auth
```

The step-by-step deployment is in [Google Cloud setup](../setup-gcp.md).

## Getting here from Supabase

Run the app on Cloud Run against the existing Supabase project, then switch
each area.

```bash
# 1. Areas that don't depend on the database
usertasks-admin switch storage --to gcs --set gcs_project_id=acme-prod --set bucket_map='{"task-files":"acme-ut-files","logos":"acme-ut-logos","brand-fonts":"acme-ut-fonts"}' --yes
usertasks-admin switch email   --to smtp --set smtp_host=smtp-relay.gmail.com --set smtp_port=587 \
  --secret smtp_password=… --set from='UserTasks <tasks@corp.example>' --test-to you@corp.example --yes
usertasks-admin switch secrets --to gcp_secret_manager --set gcp_project_id=acme-prod --yes
usertasks-admin switch kms     --to gcp_kms --set gcp_kms_key_name=projects/acme-prod/locations/europe-west1/keyRings/usertasks/cryptoKeys/kek --yes
usertasks-admin kms rewrap --yes

# 2. The Supabase-only areas (create the Cloud Scheduler job before switching the scheduler)
usertasks-admin switch auth      --to builtin --map google=oidc:google --yes  # everyone signs in again
usertasks-admin switch realtime  --to sse --yes
usertasks-admin switch scheduler --to external --set oidc_service_accounts=usertasks-scheduler@acme-prod.iam.gserviceaccount.com --yes

# 3. Stop writes, then copy the database (the target role needs cloudsqlsuperuser)
usertasks-admin switch database --to postgres --target-url 'postgresql://postgres:…@127.0.0.1:5432/usertasks' --yes   # through the Cloud SQL Auth Proxy
```

Then restart with `DB_PROVIDER=postgres`, `DATABASE_AUTH=gcp` and the IAM
`DATABASE_URL`, and remove the `SUPABASE_*` variables.

## Trade-offs

- **Cost:** Cloud SQL is the main item. Cloud Run charges for request time,
  or for always-on CPU if you run the built-in worker instead of Cloud
  Scheduler. Memorystore is optional with a single instance
  (`CACHE_PROVIDER=postgres` instead).
- **Operations:** one service account, no keys. You own Cloud SQL sizing,
  maintenance and HA.
- **Latency:** the app and Cloud SQL share a region. The Cloud Run socket
  (or the Auth Proxy) encrypts the connection.
- **Compliance:** IAM for people and services, Cloud KMS (with HSM or EKM
  for keys held outside Google), regional Secret Manager endpoints, Cloud
  Audit Logs.

## Data residency

Choose one region for Cloud SQL, the buckets, the key ring and the Secret
Manager replication policy (user-managed, in that region). Bucket location
types (region, dual-region, multi-region) decide where files are stored.

## Failure domains

One cloud. Use Cloud SQL HA (regional) and more than one Cloud Run
instance with the shared cache. If Cloud Scheduler misses a minute, jobs
catch up on the next tick.

## Not wired yet

- The Cloud SQL Node.js Connector (use the Cloud Run socket or the Auth
  Proxy).
