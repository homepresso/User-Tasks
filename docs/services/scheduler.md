# Choosing a scheduler

All background work runs from one job registry: queued workflow and agent
runs, schedules, SLAs, reminders and escalations, deletions, sync jobs,
token refresh, log shipping and retention. Once a minute something runs a
**tick**, and the scheduler provider decides what that is. Every job is
claim- or lease-based, so a tick that runs twice never does the same work
twice.

| Option | `SCHEDULER_PROVIDER` | On-prem | AWS | Azure | Google Cloud | Switch |
|---|---|---|---|---|---|---|
| pg_cron + pg_net in the database (secrets in Supabase Vault) | `pg_cron` (default) | with pg_cron, pg_net and Vault | — | — | — | data |
| Built-in worker: in the app server, or a `node worker.cjs` container | `worker` | yes | yes: ECS, EKS, EC2; or EventBridge Scheduler → ECS RunTask of `node worker.cjs --once` (IAM only, no endpoint) | yes: Container Apps (min replicas ≥ 1), AKS | yes: Cloud Run with CPU always allocated, GKE | data |
| External cron calling `POST /api/cron/tick` | `external` | yes: OS cron, systemd timer, Kubernetes CronJob | native: EventBridge API destination with Cognito OAuth client credentials (verified tokens), or `CRON_SECRET` | native: Container Apps Job, Functions or Logic Apps with Entra-verified tokens | native: Cloud Scheduler with OIDC tokens | data |

## When to pick which

- **pg_cron** when the database is on Supabase. Nothing extra to run.
- **The worker** wherever the app runs as a long-lived process. Any
  number of replicas is safe: one leader ticks, chosen through an advisory
  lock, and another takes over within a minute.
- **External** on serverless or scale-to-zero hosts (Vercel Cron, App
  Runner, Cloud Run without always-on CPU), or when your platform team
  wants scheduling in its own tool. Cloud Scheduler and Azure can
  authenticate with their own identity tokens instead of a shared secret.

## Rules

- **On a database other than Supabase, don't use `pg_cron`.** It needs pg_cron,
  pg_net and Supabase Vault. The database switch requires `worker` or
  `external` first.
- The worker's leader election needs a session-mode connection
  (`SCHEDULER_DATABASE_URL`). With a dedicated worker container, set
  `SCHEDULER_IN_PROCESS=false` on the web replicas.
- **Create the external job before switching.** `switch scheduler` removes
  the pg_cron jobs. A missed minute isn't lost: every job catches up on the
  next tick.
- The Google OIDC allow-list (`SCHEDULER_OIDC_SERVICE_ACCOUNTS`) is
  required, because any Google account can mint a token for any audience.
  The same goes for Cognito (`SCHEDULER_COGNITO_ALLOWED_CLIENTS`): its
  access tokens carry no audience.

```bash
usertasks-admin switch scheduler --to worker --yes
usertasks-admin switch scheduler --to external --set oidc_service_accounts=usertasks-scheduler@PROJECT.iam.gserviceaccount.com --yes
```

Reference: [Scheduler](../infrastructure.md#scheduler) and
[Switching the scheduler](../switching-providers.md#scheduler).
