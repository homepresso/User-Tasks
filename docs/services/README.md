# Choosing each service

Each infrastructure area has its own provider, chosen with an environment
variable (`<AREA>_PROVIDER`) or with `usertasks-admin switch <area>`. These
pages list the options in each area, where each one runs, and when to pick
it. Supabase is an excellent platform and our recommended way to run
UserTasks: the database, auth, storage, realtime and scheduler defaults
all run on it. If you'd like to use other services, you can move each area
whenever you're ready. For the combinations that work well together, see
[Choose your topology](../topologies/README.md). For every setting, see
[Infrastructure and providers](../infrastructure.md).

How to read the tables:

- **On-prem**: runs with no SaaS and no outbound internet.
- **AWS / Azure / Google Cloud**: **native** means the provider uses that
  cloud's own service and identity (task role, managed identity, service
  account). **compatible** means it works there through a generic protocol
  (PostgreSQL, SMTP, OIDC, Redis) with a password or key. **—** means not
  applicable.
- **Switch**: what `usertasks-admin switch` does. **data** means it copies
  or converts data (objects, accounts, rows, data keys). **config** means a
  validated configuration change.

| Area | Variable | Default | Options | Page |
|---|---|---|---|---|
| Database | `DB_PROVIDER` | `supabase` | `postgres` | [Database](database.md) |
| Auth | `AUTH_PROVIDER` | `supabase` | `builtin`, `oidc`, `saml` | [Auth](auth.md) |
| File storage | `STORAGE_PROVIDER` | `supabase` | `local`, `s3`, `azure_blob`, `gcs` | [Storage](storage.md) |
| Realtime | `REALTIME_PROVIDER` | `supabase` | `sse` | [Realtime](realtime.md) |
| Scheduler | `SCHEDULER_PROVIDER` | `pg_cron` | `worker`, `external` | [Scheduler](scheduler.md) |
| Email | `EMAIL_PROVIDER` | `resend` | `smtp`, `ses`, `azure_communication`, `microsoft_graph`, `gmail`, `console` | [Email](email.md) |
| Secrets | `SECRETS_PROVIDER` | `env` | `db`, `supabase_vault`, `hashicorp_vault`, `azure_key_vault`, `gcp_secret_manager`, `aws_secrets_manager` | [Secrets](secrets.md) |
| KMS | `KMS_PROVIDER` | `env` | `vault_transit`, `aws_kms`, `azure_key_vault`, `gcp_kms` | [KMS](kms.md) |
| Cache | `CACHE_PROVIDER` | `memory` | `postgres`, `redis` | [Cache](cache.md) |
| Log export | per workspace | none | `splunk_hec`, `datadog`, `otlp_http`, `webhook`, `syslog`, `azure_monitor`, `azure_event_hubs`, `gcp_logging`, `gcp_pubsub`, `aws_cloudwatch_logs` | [Log export](logs.md) |
| Directory sync | per workspace | none | `entra`, `okta`, `ldap`, `google`, `scim` | [Directory sync](directory-sync.md) |

`usertasks-admin providers list [--on-prem] [--aws] [--azure] [--gcp]` prints the
same catalogue from the installed version, with each provider's
capabilities.
