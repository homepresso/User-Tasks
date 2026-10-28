# Release notes: scheduler provider

Background jobs no longer need pg_cron. The app can tick itself, with any
number of replicas, or be driven by any outside scheduler — including Google
Cloud Scheduler (OIDC) and Azure Container Apps Jobs / Functions (Entra ID
managed identity) without a shared secret. Nothing changes unless you opt
in: pg_cron stays the default and calls the same endpoint as before.

## Added

- **`SCHEDULER_PROVIDER=worker`**: an in-process scheduler that runs the job
  registry every minute without HTTP, pg_cron or Vault. It starts inside the
  app server (Node.js / Docker; not Vercel) or as its own process:
  `npm run worker`, or `node worker.cjs` in the Docker image (`--once` for a
  single tick). Replicas elect one leader with a Postgres advisory lock
  (`SCHEDULER_DATABASE_URL` / `DATABASE_URL`), or through the tick lease when
  only Supabase is reachable. `SCHEDULER_IN_PROCESS=false` keeps web
  replicas out of it.
- **`SCHEDULER_PROVIDER=external`**, documented for OS cron, systemd timers,
  Kubernetes CronJobs, Vercel Cron, Google Cloud Scheduler and Azure
  Container Apps Jobs / Functions timers / Logic Apps.
- **Token auth for `/api/cron/tick`**: Google-signed OIDC ID tokens
  (`SCHEDULER_OIDC_SERVICE_ACCOUNTS`, `SCHEDULER_OIDC_AUDIENCE`) and Entra ID
  tokens (`SCHEDULER_ENTRA_TENANT_ID`, `SCHEDULER_ENTRA_AUDIENCE`,
  `SCHEDULER_ENTRA_ALLOWED_PRINCIPALS`) are accepted in addition to the cron
  secret when configured.
- **`npm run scheduler -- status | install-pg-cron | uninstall-pg-cron`**:
  (re)installs the pg_cron jobs exactly as the migrations do and stores the
  base URL and cron secret in Vault from the app's configuration, or removes
  them after switching.

## Changed

- The app warns in its log when pg_cron still calls the tick while another
  scheduler provider is active.
- The Docker image also contains `worker.cjs`.

## Upgrade

No migration. To switch, see
[Infrastructure and providers](infrastructure.md#scheduler).
