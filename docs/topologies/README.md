# Choose your topology

UserTasks splits its infrastructure into areas: database, auth, file
storage, realtime, scheduler, email, secrets, KMS and cache, plus log export
and directory sync, which are set per workspace. Each area has its own
provider. A topology is the set of choices you make, and where each chosen
service runs.

Every install starts in the same place: **on Supabase, with nothing else to
configure**. Supabase is an excellent platform and our recommended way to
run UserTasks. If you'd like to use other services, you can move one area at
a time with `usertasks-admin switch` whenever you're ready. Each switch checks the target first, takes a
backup, logs every step and can be rolled back. You never have to choose
your final topology on day one.

| Topology | What runs where | Pick it when | Guide |
|---|---|---|---|
| **Supabase only** | One Supabase project, plus Resend for email | You want to be live today with the least to operate | [Supabase only](supabase.md) |
| **Hybrid** | Supabase for the database (and usually auth), with some areas on AWS, Google Cloud or Azure | You want files, email, secrets or sign-in in your own cloud account, and Supabase is fine for the rest | [Hybrid](hybrid.md) |
| **Single cloud** | Every area on AWS, Azure or Google Cloud | One cloud is mandated: a landing zone, one IAM model, committed spend | [AWS](aws.md) · [Azure](azure.md) · [Google Cloud](google-cloud.md) |
| **Multi-cloud** | Areas spread over two or more clouds and SaaS vendors | Services you must use already live in different places | [Multi-cloud](multi-cloud.md) |
| **On-premises / air-gapped** | Everything inside your network, no outbound internet | Regulation, a disconnected network, or full ownership | [On-premises](on-premises.md) |

The engine is the same in every topology: the same fast execution, the same
API, MCP server and CLI, and the same row-level security. Only the services
around it change.

## Start on Supabase, move areas when you're ready

1. **Deploy on Supabase.** Create a project, apply the migrations, set the
   Supabase keys, `CRON_SECRET` and `ENCRYPTION_KEY`, and run the app (see
   the [self-host quickstart](/docs/quickstart/self-host)). No provider
   variable is needed: every area uses its default.
2. **Look at what you have.** `usertasks-admin status` shows the provider
   for each area and where that choice comes from. `usertasks-admin doctor`
   checks every area.
3. **Move one area at a time, if you'd like to.** Run
   `usertasks-admin switch <area> --to <provider> --dry-run`, read the plan,
   then run it again with `--yes`. The app keeps running between switches, so you can check each one on its
   own before you move on.
4. **Stop wherever you like.** Supabase only and hybrid are finished
   topologies, not stages on the way to something else.

```bash
usertasks-admin status
usertasks-admin switch storage --to s3 --set region=eu-west-1 \
  --set bucket_map='{"task-files":"acme-ut-files","logos":"acme-ut-public/logos","brand-fonts":"acme-ut-public/fonts"}' --dry-run
usertasks-admin switch storage --to s3 --set region=eu-west-1 --set bucket_map='…' --yes
usertasks-admin history
```

The full reference is [Switching providers](../switching-providers.md).

## Decision guide

Answer these in order. The first "yes" is your starting recommendation.

1. **Must it run without internet access, or entirely in your own data
   centre?** → [On-premises / air-gapped](on-premises.md).
2. **Does policy require one cloud for everything** (a landing zone, one
   identity and audit model, committed spend)? →
   [AWS](aws.md), [Azure](azure.md) or [Google Cloud](google-cloud.md).
3. **Do services you must use already live in different places** (Okta for
   identity, storage in another cloud's data lake, a SaaS email or log
   platform), and you also need the database in your own cloud? →
   [Multi-cloud](multi-cloud.md).
4. **Is Supabase fine for the database, but you need one or more areas
   under your own account** (files in your bucket, email from your domain
   through SES or Azure, secrets in your vault, corporate SSO)? →
   [Hybrid](hybrid.md).
5. **None of the above?** → [Supabase only](supabase.md). It is the least
   to run, and you can still move any area later.

| If you need… | Do this | Topology |
|---|---|---|
| Files in your own bucket, region or retention policy | `switch storage --to s3\|azure_blob\|gcs` | Hybrid |
| Email from your domain through your provider | `switch email --to ses\|azure_communication\|microsoft_graph\|gmail\|smtp` | Hybrid |
| Corporate sign-in (Entra ID, Okta, Google, Keycloak, AD FS) | `switch auth --to builtin\|oidc\|saml` and `AUTH_SSO_PROVIDERS` | Hybrid |
| Credentials in your secret store | `switch secrets --to aws_secrets_manager\|azure_key_vault\|gcp_secret_manager\|hashicorp_vault` | Hybrid |
| Credentials encrypted with a key held in your KMS | `switch kms --to aws_kms\|azure_key_vault\|gcp_kms\|vault_transit` | Hybrid |
| More than one app replica | `switch cache --to postgres\|redis` | Any |
| The database in your own account or network | Move auth, realtime and scheduler first, then `switch database --to postgres` | Single cloud, multi-cloud, on-premises |
| No outbound internet at all | Every area on a self-hosted service | On-premises |

## Comparing the topologies

| | Supabase only | Hybrid | Single cloud | Multi-cloud | On-premises |
|---|---|---|---|---|---|
| **Setup** | Minutes | One switch per area | Infrastructure as code, then the switches | The most planning | Images, network, certificates |
| **What you operate** | The app | The app and the services you moved | The app, plus managed services in one cloud | Services in several places | Everything |
| **Vendors in the data path** | Supabase, Resend | Supabase plus one cloud | One cloud | Several | None |
| **Identity for service access** | Keys in the environment | Keys or the cloud's IAM, per area | One IAM model (managed identity, task role, service account) | Mixed: IAM at home, keys elsewhere | Your own (Vault, mounted files) |
| **Latency** | App ↔ Supabase region | As Supabase only, plus each moved area | Everything in one region | Each cross-cloud hop is internet latency | Your LAN |
| **Cost drivers** | Supabase plan, email volume | Plus storage, email and secret API calls | Database, container hosting, egress | Plus cross-cloud egress | Hardware and people |
| **Compliance story** | Supabase's certifications and region | Sensitive data in your account | One provider's controls and audit logs | Per area, harder to audit | Entirely yours |

None of these is faster at running workflows than another. The engine does
the same work in each, and what you will notice is the network distance
between the app and its database. Keep those two together.

## What can and can't mix

Most areas are independent: any storage works with any database, and any
email provider works with any auth provider. The rules below are the
exceptions. `usertasks-admin switch` checks them in its pre-flight step and
refuses a switch that would break one.

- **The database moves last.** Moving the database to your own PostgreSQL
  requires auth (`builtin`, `oidc` or `saml`), realtime (`sse`) and the
  scheduler (`worker` or `external`) to be switched first. Storage may stay on
  Supabase Storage for as long as the project exists.
- **Built-in auth with the Supabase database** needs `SUPABASE_JWT_SECRET`
  (the project's JWT secret), so that PostgREST and Supabase Realtime accept
  the app's sessions, and `DATABASE_URL` for the `app_auth` store.
- **SSE realtime works with any database**, Supabase included. It needs a
  session-mode connection for `LISTEN`: a direct connection or Supabase's
  session pooler on port 5432. Transaction-mode poolers (PgBouncer in
  transaction mode, Supabase's port 6543) don't deliver notifications.
- **pg_cron needs pg_cron, pg_net and Supabase Vault**, which in practice
  means a Supabase database. On any other PostgreSQL, use the `worker` or
  an `external` tick.
- **The built-in worker needs a long-running process.** It doesn't work on
  Vercel or other serverless hosts, or on hosts that pause CPU between
  requests (App Runner, Cloud Run without "CPU always allocated"). Use an
  external tick there.
- **Storage on any other provider stores `storage://` references** for logos, theme
  assets and icons, and file values gain a `ref`. The app resolves them at
  render time and serves files from `/files`. Moving back to Supabase
  Storage is a `switch storage` too, which rewrites them again; old Supabase
  public URLs keep resolving through `/files` after a switch.
- **`supabase_vault` secrets need the Supabase database.** Move secrets to
  another store before moving the database.
- **A KMS can't protect its own credentials.** The options needed to reach
  the KMS stay encrypted with `ENCRYPTION_KEY`, so keep them in the
  environment, in mounted files or in an external secret store. A KMS
  option can't be a `secret://` reference to the `db` secret store.
- **More than one replica needs a shared cache.** With `memory`, every
  instance counts rate limits on its own and sees revoked credentials only
  after its cache expires. Use `postgres` (no extra service) or `redis`.
- **Sign-in emails follow auth.** With Supabase Auth, confirmation and
  password-reset emails come from Supabase's own mailer. With built-in auth
  they go through your email provider.
- **Sessions don't survive an auth switch.** Everyone signs in again.
  Passwords and user ids carry over.

## Data residency

- **Keep every area in the same jurisdiction.** The database holds tasks,
  data tables and run history, the event stream (72 hours by default) and
  the audit log. Storage holds uploaded and generated files. Email
  providers and log destinations receive copies of some data, so pick their
  regions too (SES and ACS regions, Datadog sites, Azure Monitor and Cloud
  Logging locations).
- **Secrets and keys:** Secret Manager has regional endpoints
  (`GCP_SECRET_MANAGER_ENDPOINT`); AWS Secrets Manager, AWS KMS, Key Vault
  and Cloud KMS are regional resources. Create them in the database's
  region.
- **Sovereign and private clouds:** Azure Blob, Graph and Key Vault accept
  endpoint overrides for national clouds and private endpoints. S3
  endpoints can point at a VPC endpoint or an on-premises store.
- **Backups:** `usertasks-admin switch` writes backups to `BACKUP_DIR`
  (default `./backups/switches`) on the machine where it runs. Keep that
  directory in the same jurisdiction too.
- **Supabase only and hybrid:** your data's location is the Supabase
  project's region. Choose it when you create the project, because moving a
  Supabase project to another region means a database switch.

## Failure domains

Each service your topology depends on is a separate thing that can fail.

| Area down | What stops | What keeps working |
|---|---|---|
| Database | Everything | Nothing. Put it close to the app and make it highly available |
| Auth | New sign-ins | Existing sessions and API keys (built-in auth keeps sessions in the database) |
| Storage | File uploads and downloads, logos | Workflows that don't touch files |
| Realtime | Live updates | Pages still load and refresh; SSE falls back to polling without its connection |
| Scheduler | Schedules, queued runs, SLAs and log shipping wait | Synchronous runs, tasks, the API. Each job catches up on the next tick |
| Email | Notifications and invitations (reported as not sent) | Everything else |
| Secrets store | Providers whose credentials can't be resolved once their cached value expires (5 minutes by default) | Areas that don't use `secret://` references |
| KMS | Start-up with a non-`env` KMS (it refuses to start) | Running instances, which keep their unwrapped data keys in memory |
| Cache (`redis`) | Nothing: rate limits fall back to counting per instance | Everything |

The fewer vendors you have, the fewer of these can fail independently. A
single-cloud or on-premises topology has one failure domain to design for.
A multi-cloud topology has one per cloud, plus the network between them.

## Next

- [Choosing each service](../services/README.md): the options in each area,
  with on-premises, AWS, Azure and Google Cloud support.
- [Infrastructure and providers](../infrastructure.md): every setting.
- [Deployment profiles](../deployment-profiles.md): tested combinations you
  can run locally, and the Bicep and Terraform templates.
- [Optional drivers](../optional-drivers.md): which cloud SDKs and database
  drivers your image includes, and how to add the ones it doesn't.
