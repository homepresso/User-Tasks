# Topology: multi-cloud

Areas spread over two or more clouds and SaaS vendors. Usually this isn't a
design goal. It happens because services you must use already live in
different places: identity in Okta, a data lake in another cloud, a SaaS log
platform, a database team on Azure. UserTasks supports any combination,
because each area is configured on its own. The rules below keep the result
fast and auditable.

## Worked example

The app and its database run on Azure. Files live in Google Cloud Storage
next to the analytics team's data. People sign in with Okta, email goes
through Resend and logs ship to Datadog.

<!-- ::topology multi-cloud -->

| Area | Service | Provider id | How it authenticates |
|---|---|---|---|
| Hosting | Azure Container Apps, in the database's region | — | User-assigned managed identity |
| Database | Azure Database for PostgreSQL – Flexible Server | `postgres`, `DATABASE_AUTH=azure` | Managed identity |
| Secrets | Azure Key Vault | `azure_key_vault` | Managed identity |
| KMS | A Key Vault key | `azure_key_vault` | Managed identity |
| Cache | Azure Cache for Redis | `redis`, `CACHE_REDIS_AUTH=entra` | Managed identity |
| Realtime, scheduler | Built-in SSE and worker | `sse`, `worker` | — |
| Storage | Google Cloud Storage | `gcs` | A service-account key in `GCS_CREDENTIALS_JSON`, resolved from Key Vault |
| Auth | Built-in, with Okta over OIDC | `builtin` (or `oidc`) | Client secret from Key Vault |
| Email | Resend | `resend` | API key from Key Vault |
| Log export | Datadog | `datadog` destination | API key, stored encrypted per workspace |

```bash
DB_PROVIDER=postgres
DATABASE_AUTH=azure
DATABASE_URL=postgresql://<identity name>@acme-ut.postgres.database.azure.com:5432/usertasks?sslmode=require
SECRETS_PROVIDER=azure_key_vault
AZURE_KEY_VAULT_URL=https://acme-ut.vault.azure.net
ENCRYPTION_KEY=secret://encryption-key
KMS_PROVIDER=azure_key_vault
AZURE_KMS_KEY_ID=https://acme-ut.vault.azure.net/keys/usertasks-kek
CACHE_PROVIDER=redis
CACHE_REDIS_URL=rediss://acme-ut.redis.cache.windows.net:6380
CACHE_REDIS_AUTH=entra
REALTIME_PROVIDER=sse
SCHEDULER_PROVIDER=worker
STORAGE_PROVIDER=gcs
GCS_PROJECT_ID=acme-data
GCS_CREDENTIALS_JSON=secret://gcs-service-account
STORAGE_BUCKET_MAP={"task-files":"acme-ut-files","logos":"acme-ut-public","brand-fonts":"acme-ut-public/fonts"}
STORAGE_PUBLIC_BASE_URL=https://cdn.corp.example/{bucket}
AUTH_PROVIDER=builtin
AUTH_SSO_PROVIDERS=[{"id":"okta","type":"oidc","preset":"okta","domain":"corp.okta.com","clientId":"…","clientSecret":"secret://okta-client-secret","defaultOrg":"corp"}]
EMAIL_PROVIDER=resend
RESEND_API_KEY=secret://resend-api-key
```

From a Supabase start, the order is the same as for a single cloud: areas
that don't depend on the database first, then auth, realtime and the
scheduler, then the database last. See [Azure](azure.md#getting-here-from-supabase).

## Rules for multi-cloud

1. **Keep the app next to its database.** Every API request, task action
   and workflow step makes several database round trips. The app and the
   database must share a region and network. Everything else can be
   further away.
2. **Keep secrets next to the app.** Use the secret store of the cloud the
   app runs in, so the app reaches it with its own identity (managed
   identity, task role, service account) and no key. Credentials for the
   other clouds and SaaS vendors are then `secret://` references in that
   store. They are the only static keys in the install, so rotate them
   there.
3. **Mind egress on files.** Downloads served through `/files` leave the
   storage cloud and then leave the app's cloud: you pay egress twice, and
   latency adds up. For public files (logos, fonts, icons), set
   `STORAGE_PUBLIC_BASE_URL` to the bucket or a CDN so browsers fetch them
   directly. Keep large data-table files and workflow documents in the
   app's cloud if they're downloaded often.
4. **Keep the hot path inside one cloud.** The cache, the KMS and secret
   lookups run on many requests (secrets and data keys are cached in
   memory). Keep them in the app's cloud. Email, log export and directory
   sync run in the background and tolerate distance.
5. **Private networking doesn't cross clouds by default.** A private
   endpoint in one cloud isn't reachable from another without a VPN or
   interconnect. Cross-cloud calls go over the internet with TLS, unless you
   build that link.
6. **One audit trail per cloud.** Each cloud logs access to its own
   resources. Ship UserTasks' own audit and security events to one place
   (a log destination) so the whole story is in one system.

## Trade-offs

- **Cost:** each cloud bills its own minimums, and cross-cloud egress is
  the cost that grows with use. Model it per area before you commit.
- **Operations:** several consoles, IAM models and on-call paths.
  `usertasks-admin doctor` checks every area from the app's side, which
  is the one place that sees all of them.
- **Latency:** fine for background areas. Anything on the request path
  should be in the app's cloud (rule 4).
- **Compliance:** harder to audit, because evidence is spread across
  providers. Document each area's region and data flow.

## Data residency

Every vendor in the list holds some data. Check each one's region: the
database's, the buckets', the IdP tenant's, the email provider's and the
log platform's. A single region for all of them is ideal. One jurisdiction
is the minimum.

## Failure domains

One per cloud and vendor, plus the internet between them. The database's
cloud is the critical one. A storage outage in the second cloud stops file
access only. An Okta outage stops new sign-ins only, since existing
built-in sessions keep working, and so on per area (see
[Failure domains](README.md#failure-domains)).
