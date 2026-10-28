# UserTasks on Azure (reference deployment)

The same deployment in two formats: `bicep/` (`az deployment group create`)
and `terraform/` (azurerm 4.x). Both create the resources below and set the
same environment. Nothing here depends on Supabase. Read
[docs/infrastructure.md](../../docs/infrastructure.md) for what each setting does.

## What gets created

| Resource | Purpose |
|---|---|
| User-assigned managed identity `id-<name>` | Used by the web app and both jobs for the database, Blob, Key Vault, ACS and ACR. No keys or passwords. |
| Container Apps environment `cae-<name>` (VNet-integrated, Consumption workload profile) + Log Analytics `log-<name>` | Runtime and logs |
| Container App `<name>-web` | `node server.js`, external HTTPS ingress → port 3000, 1–3 replicas |
| Container Apps Job `<name>-tick` (schedule `* * * * *`) | `curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/tick` |
| Container Apps Job `<name>-migrate` (manual) | `node admin.cjs db migrate` |
| PostgreSQL Flexible Server 16 `psql-<name>-*` + database `usertasks` | Private access only (delegated subnet, private DNS zone), Microsoft Entra auth only (password auth off), `azure.extensions=PG_TRGM,PGCRYPTO`. The managed identity is an Entra admin. |
| Storage account `st<name>*` + containers `usertasks-task-files`, `usertasks-logos`, `usertasks-brand-fonts` | Shared-key access and public blobs disabled; identity has Storage Blob Data Contributor + Storage Blob Delegator |
| Key Vault `kv-<name>-*` (RBAC, purge protection) | Secrets `encryption-key`, `cron-secret`; identity has Key Vault Secrets User |
| Email Communication Service + Azure-managed domain, Communication Services `acs-<name>-*` | Email; identity has Contributor on the ACS resource |
| Container Registry `acr<name>*` (Basic, admin user off) | Image; identity has AcrPull |
| Azure Cache for Redis `redis-<name>-*` (Basic C0 by default) + private endpoint `pe-redis-<name>` in `snet-endpoints`, private DNS zone `privatelink.redis.cache.windows.net` | The shared cache (rate limits, invalidations): TLS only, Microsoft Entra auth only (access keys off), no public network access; the identity has the **Data Contributor** access policy. `cacheEnabled=false` / `cache_enabled = false` leaves it out and uses `CACHE_PROVIDER=postgres` |

## Environment → resource

| Variable | Value |
|---|---|
| `DB_PROVIDER` | `postgres` |
| `DATABASE_URL` | `postgresql://id-<name>@<server>.postgres.database.azure.com:5432/usertasks?sslmode=require` (user = the identity's name) |
| `DATABASE_AUTH` | `azure` (Entra token from `DefaultAzureCredential` as the password) |
| `AZURE_CLIENT_ID` | the identity's client id (selects the user-assigned identity for every Azure SDK) |
| `AUTH_PROVIDER` / `AUTH_SSO_PROVIDERS` | `builtin` by default; set the JSON for Entra ID OIDC (`preset: "entra"`), secrets as `secret://…` |
| `REALTIME_PROVIDER` | `sse` |
| `SCHEDULER_PROVIDER` | `external` (the tick job) |
| `CRON_SECRET` | Container Apps secret referencing Key Vault `cron-secret` |
| `STORAGE_PROVIDER` / `AZURE_STORAGE_ACCOUNT` / `STORAGE_BUCKET_PREFIX` | `azure_blob` / the account / `usertasks-` |
| `EMAIL_PROVIDER` / `ACS_EMAIL_ENDPOINT` / `EMAIL_FROM` | `azure_communication` / `https://<acs host>` / `DoNotReply@<managed domain>` |
| `SECRETS_PROVIDER` / `AZURE_KEY_VAULT_URL` | `azure_key_vault` / the vault URI |
| `ENCRYPTION_KEY` | `secret://encryption-key` (read from Key Vault at startup; the app refuses to start if it can't) |
| `CACHE_PROVIDER` / `CACHE_REDIS_URL` / `CACHE_REDIS_AUTH` / `CACHE_REDIS_USERNAME` | `redis` / `rediss://<cache>.redis.cache.windows.net:6380` / `entra` / the identity's object (principal) id — or `postgres` with the cache off |
| `APP_URL` | `https://<name>-web.<environment default domain>` unless `app_url` / `appUrl` is set |

## Prerequisites

- Azure CLI 2.60+ (`az bicep` for Bicep) or Terraform 1.6+, logged in with
  Owner (or Contributor + User Access Administrator) on the subscription /
  resource group — the templates create role assignments.
- Providers registered: `Microsoft.App`, `Microsoft.DBforPostgreSQL`,
  `Microsoft.Communication`, `Microsoft.ContainerRegistry`, `Microsoft.KeyVault`.
- Docker, to build the image.

## Deploy

Container Apps need the image to exist, so deploy in two passes: first
without the apps, push the image, then with them.

**Terraform**

```bash
cd deploy/azure/terraform
cp terraform.tfvars.example terraform.tfvars      # edit
terraform init
terraform apply -var deploy_apps=false
ACR=$(terraform output -raw registry_login_server)
```

**Bicep**

```bash
cd deploy/azure/bicep
az group create -n rg-usertasks -l westeurope
export USERTASKS_ENCRYPTION_KEY=$(openssl rand -hex 32)   # keep these; reuse on every deployment
export USERTASKS_CRON_SECRET=$(openssl rand -hex 32)
az deployment group create -g rg-usertasks -f main.bicep -p main.bicepparam -p deployApps=false
ACR=$(az deployment group show -g rg-usertasks -n main --query properties.outputs.registryLoginServer.value -o tsv)
```

**Build and push** (from the repository root; `NEXT_PUBLIC_APP_URL` is only
used for statically rendered pages — the runtime `APP_URL` is what links and
SSO use):

```bash
az acr login -n ${ACR%%.*}
docker build --platform linux/amd64 --build-arg NEXT_PUBLIC_APP_URL=https://tasks.example.com -t $ACR/usertasks:latest .
docker push $ACR/usertasks:latest
```

Then run the first command again without `deploy_apps=false` / `deployApps=false`.

## After the first deploy

1. **Migrate:** `az containerapp job start -n usertasks-migrate -g rg-usertasks`,
   then check the execution logs (`az containerapp job execution list …`, or
   Log Analytics). Run it again before every rollout of a new image.
2. **First tenant and owner:** `node admin.cjs bootstrap --email … --password … --org …`
   (being added to the admin CLI alongside this deployment; until it ships,
   `npm run bootstrap -- …` from a checkout with the same `DATABASE_URL`).
   Run it as a one-off: `az containerapp exec -n usertasks-web -g rg-usertasks --command "node admin.cjs bootstrap --email … --password … --org …"`.
3. Check the install: `az containerapp exec … --command "node admin.cjs doctor"`.
4. Optional: custom domain on the Container App (then set `app_url` and
   redeploy), an ACS custom email domain (then change `EMAIL_FROM`).

## Notes

- **Tick authentication.** The job sends the cron secret. The app also
  accepts Entra ID tokens (`SCHEDULER_ENTRA_TENANT_ID`,
  `SCHEDULER_ENTRA_AUDIENCE`, `SCHEDULER_ENTRA_ALLOWED_PRINCIPALS`); that
  needs an app registration for the audience, which neither azurerm nor Bicep
  creates, so it is not wired here. To switch, register `api://usertasks-tick`,
  set the three variables and make the job fetch a token
  (docs/infrastructure.md → Scheduler → external).
- **Database ownership.** The identity is an Entra admin (`azure_pg_admin`,
  `CREATEROLE`), runs the migrations and so owns the schema, which the
  postgres provider needs on a server without `BYPASSRLS`. The template
  assumes a database created through ARM is owned by `azure_pg_admin` (not
  checked against a live server). If the migration fails with `must be owner of …`,
  have an Entra admin run `ALTER DATABASE usertasks OWNER TO "id-<name>";`.
- **Network.** PostgreSQL has no public endpoint. Key Vault, Storage and ACS
  use public endpoints with Entra RBAC; add private endpoints for stricter
  setups. To reach the database yourself, use a jump host in the VNet or
  `az containerapp exec`.
- **Secrets in state.** Terraform generates `ENCRYPTION_KEY` and `CRON_SECRET`,
  so they are in the state file: use a remote backend with restricted access.
  Never change `encryption-key` once data has been stored.
- **Email role.** Contributor on the ACS resource is what the docs require;
  replace it with a custom role allowing
  `Microsoft.Communication/CommunicationServices/Write` (send) if you want
  least privilege.
- **Cost (rough, pay-as-you-go, one region).** PostgreSQL B1ms + 32 GB
  ≈ US$15–20/month; one always-on 1 vCPU / 2 GiB Container App replica
  ≈ US$40–70/month; the tick job's per-minute runs a few dollars; ACR Basic
  ≈ US$5; Log Analytics, Key Vault, Storage and ACS email are usage-based and
  small at low volume. Scale `app_min_replicas` and the SKU to taste.
