# Topology: single cloud on Azure

The Azure reference profile. Every area runs in one Azure subscription and
region, and the app reaches every service with one user-assigned managed
identity, with no keys. It is tested locally against emulators
([Deployment profiles](../deployment-profiles.md#azure-azure)), and the
Bicep and Terraform templates in `deploy/azure/` create it.

<!-- ::topology azure -->

## What runs where

| Area | Azure service | Provider id | Native or compatible |
|---|---|---|---|
| Hosting | Container Apps: the web app, a migrate job, a tick job | — | The Docker image |
| Database | Azure Database for PostgreSQL – Flexible Server 16, Entra-only auth | `postgres`, `DATABASE_AUTH=azure` | Native: managed-identity token as the password |
| Auth | Built-in, with Microsoft Entra ID over OIDC (or SAML) | `builtin` | Native presets `entra`, `entra_multitenant`, `entra_external_id` |
| Storage | Blob Storage, shared keys disabled | `azure_blob` | Native: Storage Blob Data Contributor (and Storage Blob Delegator for signed URLs) |
| Realtime | Built-in Server-Sent Events | `sse` | Built in |
| Scheduler | A Container Apps Job every minute calling `POST /api/cron/tick` | `external` | The templates use `CRON_SECRET`; Entra-verified tokens (`SCHEDULER_ENTRA_*`) need an app registration |
| Email | Azure Communication Services Email (or Microsoft 365 through Graph) | `azure_communication` / `microsoft_graph` | Native: managed identity |
| Secrets | Key Vault (RBAC) | `azure_key_vault` | Native: Key Vault Secrets User |
| KMS | A Key Vault key or Managed HSM key wrapping the data keys | `azure_key_vault` | Native: Key Vault Crypto Service Encryption User |
| Cache | Azure Cache for Redis / Azure Managed Redis with Entra auth | `redis`, `CACHE_REDIS_AUTH=entra` | Native: managed-identity tokens, re-sent before they expire |
| Log export | Azure Monitor Logs Ingestion (Log Analytics, Sentinel) or Event Hubs | `azure_monitor`, `azure_event_hubs` destinations | Native: an app registration, or the app's identity when `LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true` (single-tenant installs only) |
| Directory sync | Entra ID through Microsoft Graph, or SCIM pushed by Entra | per workspace | Native |

The image includes the Blob Storage, Communication Services Email, Key Vault secrets and keys SDKs by default. The Snowflake, Oracle and
MongoDB drivers need `--build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true`; see
[Optional drivers](../optional-drivers.md).

## Configuration

```bash
DB_PROVIDER=postgres
DATABASE_AUTH=azure
AZURE_CLIENT_ID=<managed identity client id>
DATABASE_URL=postgresql://<identity name>@acme-ut.postgres.database.azure.com:5432/usertasks?sslmode=require
AUTH_PROVIDER=builtin
AUTH_SSO_PROVIDERS=[{"id":"entra","type":"oidc","preset":"entra","tenantId":"contoso.onmicrosoft.com","clientId":"…","clientSecret":"secret://entra-client-secret","allowedDomains":["contoso.com"]}]
REALTIME_PROVIDER=sse
SCHEDULER_PROVIDER=external
STORAGE_PROVIDER=azure_blob
AZURE_STORAGE_ACCOUNT=acmeusertasks
STORAGE_BUCKET_PREFIX=usertasks-
EMAIL_PROVIDER=azure_communication
ACS_EMAIL_ENDPOINT=https://acme-ut.communication.azure.com
EMAIL_FROM=DoNotReply@<guid>.azurecomm.net
SECRETS_PROVIDER=azure_key_vault
AZURE_KEY_VAULT_URL=https://acme-ut.vault.azure.net
ENCRYPTION_KEY=secret://encryption-key
KMS_PROVIDER=azure_key_vault
AZURE_KMS_KEY_ID=https://acme-ut.vault.azure.net/keys/usertasks-kek
CACHE_PROVIDER=redis
CACHE_REDIS_URL=rediss://acme-ut.redis.cache.windows.net:6380
CACHE_REDIS_AUTH=entra
CACHE_REDIS_USERNAME=<managed identity object id>
```

The step-by-step deployment (infrastructure, image, grants, migrate job,
first workspace, Entra sign-in) is in [Azure setup](../setup-azure.md).

## Getting here from Supabase

Deploy the infrastructure with the templates, and run the app on Container
Apps against the existing Supabase project. Then switch each area.

```bash
# 1. Areas that don't depend on the database
usertasks-admin switch storage --to azure_blob --set azure_account_name=acmeusertasks --set bucket_prefix=usertasks- --yes
usertasks-admin switch email   --to azure_communication --set acs_endpoint=https://acme-ut.communication.azure.com \
  --set from=DoNotReply@<guid>.azurecomm.net --test-to you@contoso.com --yes
usertasks-admin switch secrets --to azure_key_vault --set azure_key_vault_url=https://acme-ut.vault.azure.net --yes
usertasks-admin switch kms     --to azure_key_vault --set azure_key_id=https://acme-ut.vault.azure.net/keys/usertasks-kek --yes
usertasks-admin kms rewrap --yes
usertasks-admin switch cache   --to redis --set redis_url=rediss://acme-ut.redis.cache.windows.net:6380 \
  --set redis_auth=entra --set redis_username=<object id> --yes

# 2. The Supabase-only areas
usertasks-admin switch auth      --to builtin --map azure=oidc:entra --yes   # everyone signs in again
usertasks-admin switch realtime  --to sse --yes
usertasks-admin switch scheduler --to external --yes                         # the tick job takes over

# 3. Stop writes, then copy the database (connect as an Entra admin or azure_pg_admin)
usertasks-admin switch database --to postgres --target-url 'postgresql://…@acme-ut.postgres.database.azure.com:5432/usertasks?sslmode=require' --yes
```

Then restart with the printed database settings plus `DATABASE_AUTH=azure`,
and remove the `SUPABASE_*` variables.

## Trade-offs

- **Cost:** Flexible Server and Container Apps are the main items. Azure
  Cache for Redis is optional with one replica (use `CACHE_PROVIDER=postgres`
  instead). Log Analytics ingestion grows with the event stream.
- **Operations:** one managed identity, no keys to rotate. Everything is
  visible in one subscription. You own database sizing, maintenance windows
  and high availability (zone-redundant HA).
- **Latency:** the app and the database share a region. The Flexible
  Server's built-in PgBouncer (port 6432) suits the app's queries. Keep
  migrations, `LISTEN` and the worker's leader lock on port 5432.
- **Compliance:** Entra ID for people and services, Key Vault or Managed
  HSM for keys, Azure Monitor for the audit trail. Sovereign clouds work
  through endpoint overrides (`AZURE_STORAGE_BLOB_ENDPOINT`,
  `GRAPH_ENDPOINT`, the log destinations' `cloud`).

## Data residency

Choose one region for the resource group. Blob Storage redundancy (LRS,
ZRS, GRS) decides whether files leave the region. Pick the paired-region
options on purpose. Communication Services has a data location of its own,
set when you create the resource.

## Failure domains

One cloud. Use zone-redundant HA for the database, and more than one
Container Apps replica with the shared cache. If the tick job fails, jobs
wait and catch up on the next successful tick. As an alternative, the
built-in worker can run in the app (minimum replicas ≥ 1).

## Not wired yet

- Entra-verified tick tokens in the templates (the job uses `CRON_SECRET`).
  The app supports them with `SCHEDULER_ENTRA_*`.
