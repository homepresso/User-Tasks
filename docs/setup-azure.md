# Azure setup

This is the reference deployment on Azure. The templates are in
`deploy/azure/`: Bicep in `bicep/` and Terraform in `terraform/`, and both
create the same resources. `deploy/azure/README.md` has the full commands.
The [Azure reference profile](deployment-profiles.md#azure-azure) runs the
same provider combination locally against emulators.

| Area | Azure service | Settings |
|---|---|---|
| Hosting | Container Apps: web app on port 3000, a migrate job, a tick job | |
| Database | Azure Database for PostgreSQL Flexible Server 16 with Microsoft Entra auth | `DB_PROVIDER=postgres`, `DATABASE_AUTH=azure`, `AZURE_CLIENT_ID` (the managed identity) |
| Auth | Built-in, plus Microsoft Entra ID over OIDC | `AUTH_SSO_PROVIDERS` with `"preset":"entra"` and the `tenantId` |
| Storage | Blob Storage, managed identity (shared keys disabled) | `STORAGE_PROVIDER=azure_blob`, `AZURE_STORAGE_ACCOUNT`, `STORAGE_BUCKET_PREFIX` |
| Realtime | Built-in SSE | `REALTIME_PROVIDER=sse` |
| Scheduler | Container Apps Job, every minute, calling `POST /api/cron/tick` | `SCHEDULER_PROVIDER=external`, `CRON_SECRET` (a Key Vault reference) |
| Email | Azure Communication Services Email | `EMAIL_PROVIDER=azure_communication`, `ACS_EMAIL_ENDPOINT`, `EMAIL_FROM` |
| Secrets | Key Vault (RBAC; the identity has Key Vault Secrets User) | `SECRETS_PROVIDER=azure_key_vault`, `AZURE_KEY_VAULT_URL`, `ENCRYPTION_KEY=secret://encryption-key` |
| Log export (per workspace) | Azure Monitor Logs Ingestion (Log Analytics / Sentinel) or Event Hubs destinations, with an app registration | Settings → Log Export; `LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true` to let destinations use the app's managed identity (single-tenant only) |
| KMS (optional) | A Key Vault key (or Managed HSM key) wrapping the data keys; the identity has Key Vault Crypto Service Encryption User | `KMS_PROVIDER=azure_key_vault`, `AZURE_KMS_KEY_ID`; then `usertasks-admin kms rotate` and `kms rewrap` |
| Cache | Azure Cache for Redis with Microsoft Entra auth over a private endpoint, created by the templates (needed with more than one replica; Azure Managed Redis works too) | `CACHE_PROVIDER=redis`, `CACHE_REDIS_URL=rediss://<name>.redis.cache.windows.net:6380`, `CACHE_REDIS_AUTH=entra`, `CACHE_REDIS_USERNAME` (the identity's object id); or `cacheEnabled=false` for `CACHE_PROVIDER=postgres` |

## Steps

1. **Deploy the infrastructure** with `deployApps=false` (`deploy_apps` in
   Terraform): a registry, the database, storage, Key Vault and email.
2. **Build and push the image** to the registry the deployment created:
   `az acr build` or `docker push`. Add
   `--build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true` if workflows use the
   Snowflake, Oracle or MongoDB connectors ([Optional drivers](optional-drivers.md)).
3. **Deploy again** with `deployApps=true`.
4. **Grant the database.** If the migration fails with "must be owner of",
   run the one-time database ownership grant described in the README.
5. **Run the migrate job:** `az containerapp job start --name <prefix>-migrate`.
6. **Create the first workspace.** Use
   `az containerapp exec … -- node admin.cjs bootstrap --email … --org …`,
   with the password in `BOOTSTRAP_PASSWORD`.
7. **Configure Entra ID sign-in.** Register an app in Entra ID and add it to
   `AUTH_SSO_PROVIDERS`. Use `usertasks-admin doctor` to print the redirect
   URI.
8. **Check the install:** `node admin.cjs doctor`.

## Not wired up yet

- **Entra token auth for the tick job.** `SCHEDULER_ENTRA_*` needs an app
  registration for the audience, which the templates can't create, so the
  job uses `CRON_SECRET`.

## Moving an existing Supabase install

See [Switching providers](switching-providers.md#moving-a-whole-install-off-supabase).
For the database step, use `--target-url` of the Flexible Server and connect
as an Entra admin or `azure_pg_admin`.
