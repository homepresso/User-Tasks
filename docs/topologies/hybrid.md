# Topology: Hybrid

Supabase keeps the database, and usually auth and realtime too. Some areas
move to your own cloud account: files to your bucket, email to your
domain's provider, credentials to your secret store, sign-in to your
identity provider. This is the most common end state. It keeps the low
operating cost of Supabase and puts the areas your security team cares
about under your own account.

You get here from a [Supabase-only](supabase.md) install by switching one
area at a time. The app keeps running throughout. Below are three worked
examples, one per cloud. Mix them as you need: each area is independent of
the others, within the [rules](README.md#what-can-and-cant-mix).

## Example 1: Supabase + AWS

Supabase keeps the database, auth, realtime and pg_cron. Files go to S3,
email to SES, credentials to Secrets Manager, and optionally the encryption
key to AWS KMS.

<!-- ::topology hybrid-aws -->

| Area | Service | Provider id | Native or generic |
|---|---|---|---|
| Database, auth, realtime, scheduler | Supabase | `supabase`, `pg_cron` | — |
| Storage | Amazon S3 | `s3` | Native: the AWS default credential chain (task role, instance profile, IRSA) |
| Email | Amazon SES (API) | `ses` | Native: IAM role with `ses:SendEmail` |
| Secrets | AWS Secrets Manager | `aws_secrets_manager` | Native: `secretsmanager:GetSecretValue` |
| KMS (optional) | AWS KMS | `aws_kms` | Native: `kms:Encrypt` and `kms:Decrypt` on the key |

Create the buckets first, because the app doesn't create them at runtime.
If the app runs outside AWS (Vercel, for example), give it an IAM user's
access keys (`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`,
`SES_ACCESS_KEY_ID` / `SES_SECRET_ACCESS_KEY`), stored as `--secret`
values or as `secret://` references.

```bash
usertasks-admin switch storage --to s3 --set region=eu-west-1 \
  --set bucket_map='{"task-files":"acme-ut-files","logos":"acme-ut-public/logos","brand-fonts":"acme-ut-public/fonts"}' --dry-run
usertasks-admin switch storage --to s3 --set region=eu-west-1 --set bucket_map='…' --yes
usertasks-admin switch email --to ses --set ses_region=eu-west-1 \
  --set from='UserTasks <tasks@corp.example>' --test-to you@corp.example --yes
# Create each credential in Secrets Manager, replace the value with secret://<name>, then:
usertasks-admin switch secrets --to aws_secrets_manager --set aws_region=eu-west-1 --yes
# Optional: envelope encryption under a KMS key
usertasks-admin switch kms --to aws_kms --set aws_kms_key_id=alias/usertasks --yes
usertasks-admin kms rewrap --yes
```

The same settings as environment variables (the environment wins over the
switch's instance settings):

```bash
STORAGE_PROVIDER=s3
S3_REGION=eu-west-1
STORAGE_BUCKET_MAP={"task-files":"acme-ut-files","logos":"acme-ut-public/logos","brand-fonts":"acme-ut-public/fonts"}
EMAIL_PROVIDER=ses
SES_REGION=eu-west-1
EMAIL_FROM="UserTasks <tasks@corp.example>"
SECRETS_PROVIDER=aws_secrets_manager
AWS_SECRETS_MANAGER_REGION=eu-west-1
KMS_PROVIDER=aws_kms
AWS_KMS_KEY_ID=alias/usertasks
```

## Example 2: Supabase + Google Cloud

Supabase keeps the database, auth and realtime. Files go to Cloud Storage,
Cloud Scheduler drives the minute tick with an OIDC token instead of
pg_cron, and credentials live in Secret Manager. Email stays on Resend.

<!-- ::topology hybrid-gcp -->

| Area | Service | Provider id | Native or generic |
|---|---|---|---|
| Database, auth, realtime | Supabase | `supabase` | — |
| Storage | Google Cloud Storage | `gcs` | Native: Application Default Credentials (Cloud Run, GKE workload identity) or a key in `GCS_CREDENTIALS_JSON` |
| Scheduler | Cloud Scheduler HTTP job with an OIDC token | `external` | Native: the app verifies Google's signature, the audience and the calling service account |
| Secrets | Google Secret Manager | `gcp_secret_manager` | Native: `roles/secretmanager.secretAccessor` |
| Email | Resend | `resend` | — |

```bash
usertasks-admin switch storage --to gcs --set gcs_project_id=acme-prod \
  --set bucket_map='{"task-files":"acme-ut-files","logos":"acme-ut-logos","brand-fonts":"acme-ut-fonts"}' --yes
# Create the Cloud Scheduler job (see the Scheduler service page), then:
usertasks-admin switch scheduler --to external \
  --set oidc_service_accounts=usertasks-scheduler@acme-prod.iam.gserviceaccount.com --yes
usertasks-admin switch secrets --to gcp_secret_manager --set gcp_project_id=acme-prod --yes
```

`switch scheduler` removes the pg_cron jobs. Until the Cloud Scheduler job
runs, nothing ticks, so create the job first. Every job catches up on the
next tick.

## Example 3: Supabase + Azure

Supabase keeps the database, realtime and pg_cron. People sign in with
Microsoft Entra ID through built-in auth. Files go to Blob Storage, email to
Azure Communication Services, credentials to Key Vault.

<!-- ::topology hybrid-azure -->

| Area | Service | Provider id | Native or generic |
|---|---|---|---|
| Database, realtime, scheduler | Supabase | `supabase`, `pg_cron` | — |
| Auth | Built-in, with Entra ID over OIDC | `builtin` (or `oidc` for SSO only) | Native preset `entra` |
| Storage | Azure Blob Storage | `azure_blob` | Native: managed identity (Storage Blob Data Contributor) or a connection string |
| Email | Azure Communication Services Email | `azure_communication` | Native: managed identity or a connection string |
| Secrets | Azure Key Vault | `azure_key_vault` | Native: Key Vault Secrets User |

Another auth provider with the database on Supabase needs two settings:
`SUPABASE_JWT_SECRET` (the project's JWT secret, so PostgREST and Supabase
Realtime accept built-in sessions) and `DATABASE_URL` (a direct or
session-pooler connection, for the `app_auth` store).

```bash
# 1. Environment for built-in auth with Entra ID, then restart the app
SUPABASE_JWT_SECRET=…
DATABASE_URL=postgresql://postgres.<ref>:…@aws-0-<region>.pooler.supabase.com:5432/postgres
AUTH_SSO_PROVIDERS=[{"id":"entra","type":"oidc","preset":"entra","tenantId":"contoso.onmicrosoft.com","clientId":"…","clientSecret":"secret://entra-client-secret","allowedDomains":["contoso.com"]}]

# 2. The switches
usertasks-admin switch email --to azure_communication --set acs_endpoint=https://my-acs.communication.azure.com \
  --set from=DoNotReply@<guid>.azurecomm.net --test-to you@contoso.com --yes
usertasks-admin switch auth --to builtin --map azure=oidc:entra --dry-run
usertasks-admin switch auth --to builtin --map azure=oidc:entra --yes     # everyone signs in again
usertasks-admin switch storage --to azure_blob --set azure_account_name=acmeusertasks --set bucket_prefix=usertasks- --yes
usertasks-admin switch secrets --to azure_key_vault --set azure_key_vault_url=https://acme-ut.vault.azure.net --yes
```

Switch email before auth: with built-in auth, confirmation and reset emails
go through your email provider. Register the redirect URI that `switch
auth` prints (`<APP_URL>/auth/sso/entra/callback`) in the Entra app
registration.

## Trade-offs

- **Cost:** the Supabase plan stays. You add the moved services' own
  pricing: storage and requests, email volume, secret and key API calls.
  Downloads served through `/files` count as egress from both the store and
  the app; `STORAGE_PUBLIC_BASE_URL` serves public files straight from the
  bucket or a CDN instead.
- **Operations:** each moved area is a managed service with its own IAM,
  alerts and quotas. The database is still Supabase's to run.
- **Latency:** most requests touch only the database, so they don't
  change. File uploads and downloads, email and secret lookups (cached for
  5 minutes) follow the moved service's region. Keep it in the Supabase
  region.
- **Compliance:** files, credentials and keys sit in your account, under
  your audit logs (CloudTrail, Azure Monitor, Cloud Audit Logs), while the
  database stays under Supabase's controls.

## Data residency

Create the buckets, the email resource, the secret store and the key in
the Supabase project's region. Tasks, data tables and run history stay in
Supabase. Files, email copies and credentials follow the region you chose
for each moved area.

## Failure domains

Supabase plus one cloud. If the cloud side fails, only the moved areas stop:
file access, email, or resolving secrets once their cache expires. If
Supabase fails, everything stops. Put the app in the cloud you depend on
most, or next to Supabase.

## Going further

- More areas in the same cloud, up to the database: see
  [AWS](aws.md), [Azure](azure.md) or [Google Cloud](google-cloud.md).
- Rolling back any step: `usertasks-admin history`, then
  `usertasks-admin rollback <switch id> --yes`.
