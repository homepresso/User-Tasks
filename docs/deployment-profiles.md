# Deployment profiles

Ready-made ways to run UserTasks, from the default Supabase setup (our
recommended way to run UserTasks) to a stack built entirely on other
services, plus four **reference profiles** (on-premises,
Azure, Google Cloud, AWS). On Kubernetes, use the [Helm chart](setup-kubernetes.md);
without internet access, the [air-gapped bundle](setup-air-gapped.md). Each reference profile has a smoke test, and all of
them are release gates. The provider choices are described in
[Infrastructure and providers](infrastructure.md). To move an existing
install, see [Switching providers](switching-providers.md).

| Profile | Database | Auth | Storage | Realtime | Scheduler | Email | Secrets | Cache | KMS |
|---|---|---|---|---|---|---|---|---|---|
| `supabase` (default) | Supabase | Supabase Auth | Supabase Storage | Supabase Realtime | pg_cron | Resend | env | memory | env |
| `standalone` | PostgreSQL 16 (+ PgBouncer) | built-in | MinIO (S3) | SSE | worker container | SMTP → Mailpit | env | Valkey | env (`--kms aws_kms`: local-kms) |
| `onprem` | as standalone, network-isolated | built-in (+ Keycloak OIDC) | MinIO | SSE | worker | SMTP | env | Valkey | OpenBao Transit |
| `azure` | PostgreSQL (Flexible Server) | built-in + Entra ID OIDC | Blob Storage | SSE | Container Apps Job tick | Communication Services | Key Vault | Azure Cache for Redis (Valkey locally) | Key Vault key (stand-in) |
| `gcp` | PostgreSQL (Cloud SQL) | built-in + Google OIDC | Cloud Storage | SSE | Cloud Scheduler tick | SMTP relay | Secret Manager | Memorystore (Valkey locally) | Cloud KMS (stand-in) |
| `aws` | PostgreSQL (RDS) | built-in + Cognito OIDC | S3 | SSE | EventBridge tick | SES | Secrets Manager | ElastiCache (Valkey locally) | KMS (LocalStack) |

## Docker Compose

`docker-compose.yml` has two profiles. The profile decides which containers
start; `.env` decides which providers the app uses.

### `supabase` (default)

The app only, against a Supabase project (hosted or `supabase start`):

```bash
cp .env.example .env      # Supabase URL and keys, ENCRYPTION_KEY, CRON_SECRET, …
docker compose up -d --build
docker compose exec -e BOOTSTRAP_PASSWORD='a-strong-password' app \
  node admin.cjs bootstrap --email admin@example.com --org "Acme Inc"
```

This works exactly as before; see [Self-hosting](self-hosting.md).

### `standalone`

No Supabase. These containers start:

| Container | What it does |
|---|---|
| `postgres` | PostgreSQL 16 (volume `pgdata`). |
| `migrate` | Runs once on every `up`: `usertasks-admin db migrate`, then `storage init`, which creates the buckets. |
| `minio` | S3 storage (volume `miniodata`). The console is at `127.0.0.1:9001`. Files are served by the app at `/files/…`. |
| `worker` | The scheduler (`node worker.cjs`). The app runs with `SCHEDULER_IN_PROCESS=false`. |
| `mailpit` | Catches all email. The UI is at `http://localhost:8025`. Point `SMTP_HOST` at your relay for real delivery. |
| `valkey` | The shared cache store (`CACHE_PROVIDER=redis`): rate limits and cache invalidations for every app replica and the worker. No persistence — nothing in it is the source of truth. Use `CACHE_PROVIDER=postgres` to run without it. |
| `app` | The web server, with a healthcheck on `/api/config/public`. |

One command writes `.env` from `deploy/compose/standalone.env.example` with
fresh secrets, builds and starts the stack, waits until it is healthy, and
creates the first workspace:

```bash
npm run stack -- up --email admin@example.com --org "Acme Inc"   # prints a generated password
```

By hand, the same steps are:

```bash
cp deploy/compose/standalone.env.example .env   # replace every <generate>
docker compose --profile standalone up -d --build --wait
docker compose exec -e BOOTSTRAP_PASSWORD=… app node admin.cjs bootstrap --email admin@example.com --org "Acme Inc"
```

The standalone profile has some options:

- **PgBouncer:** pass `npm run stack -- init --pgbouncer`, or add
  `--profile pgbouncer` and point `DATABASE_URL` at `pgbouncer:5432`. That
  runs transaction pooling for the app's queries. Migrations, `LISTEN` and
  the worker's leader lock need a real session, so `MIGRATION_DATABASE_URL`,
  `REALTIME_DATABASE_URL` and `SCHEDULER_DATABASE_URL` keep pointing at
  `postgres:5432`.
- **Host ports:** use `APP_PORT`, `MAILPIT_PORT` and `MINIO_CONSOLE_PORT`.
- **Prebuilt image:** set `USERTASKS_IMAGE=registry.example.com/usertasks:1.2.3`
  and pass `--no-build`.

Other `npm run stack` commands:

| Command | What it does |
|---|---|
| `init` | Writes the env file. It never overwrites one unless you pass `--force`. |
| `smoke` | Runs the [smoke test](#smoke-test). |
| `down [--volumes]` | Stops the stack. `--volumes` also deletes the data. |
| `compose -- <args>` | Runs any `docker compose` command with the profile's files. |

## Reference profiles

Each reference profile combines the providers for one environment and
proves they work together. Run one with:

```bash
npm run stack -- up --profile onprem|azure|gcp|aws [--no-build]
npm run stack -- smoke --profile onprem|azure|gcp|aws
npm run stack -- down --profile onprem|azure|gcp|aws --volumes
```

Reference profiles keep their env files in `deploy/compose/.state/`, which
is git-ignored and gets fresh secrets. Each uses its own Compose project
name and host port, so they don't collide with each other or with a dev
server on port 3000.

### On-premises (`onprem`)

This is the standalone stack on a Docker network with `internal: true`, so
there is no route to the internet and nothing is published on the host. A
passing run shows that no part of the app needs SaaS, a CDN or outbound
calls: the smoke test also checks that the app container cannot reach
`registry.npmjs.org`.

`--keycloak` adds Keycloak 26 (start-dev, realm
`deploy/compose/keycloak/usertasks-realm.json`) as an OIDC identity provider
(`AUTH_SSO_PROVIDERS`, preset `keycloak`). The doctor checks its discovery
document from inside the isolated network.

Envelope encryption runs against **OpenBao** (dev server, Transit engine,
key `usertasks`; `deploy/compose/kms.yml`): see [KMS stand-ins](#kms-stand-ins).

For a real install, see [On-premises setup](setup-on-prem.md); on
Kubernetes, the [Helm chart](setup-kubernetes.md); with no internet at all,
the [air-gapped bundle](setup-air-gapped.md).

### Azure (`azure`)

The cloud services are replaced by emulators or by local stand-ins. In
every case the app still uses its real SDKs.

| Azure service | Local replacement |
|---|---|
| Blob Storage | **Azurite** |
| Key Vault | **Stand-in at `https://usertasks.vault.azure.net`.** A Docker network alias, with TLS from a test CA in `.state/certs` and `NODE_EXTRA_CA_CERTS`. The app's managed identity gets tokens from `IDENTITY_ENDPOINT`, as on Container Apps. `ENCRYPTION_KEY=secret://encryption-key` is read from it at startup. Its keys API (`wrapKey` / `unwrapKey`, no `get` permission, as with the Crypto Service Encryption User role) is the KMS: `KMS_PROVIDER=azure_key_vault`. |
| Communication Services Email | **Stand-in** that accepts the send call and the status poll |
| Entra ID | **OIDC discovery stand-in** |
| Container Apps Job | The **`tick` container** calls `POST /api/cron/tick` with `CRON_SECRET` every minute (`SCHEDULER_PROVIDER=external`). |
| Azure Monitor Logs Ingestion | **Stand-in** for the DCR stream endpoint. The smoke test adds an `azure_monitor` destination with `auth: managed_identity` and checks its test event arrives. |

The stand-ins are in `deploy/compose/mocks/cloud-mocks.mjs`.

**Not emulated:** Entra token auth for PostgreSQL (`DATABASE_AUTH=azure`;
plain PostgreSQL with a password is used instead; the token path is tested
against PostgreSQL with a fake token provider), Entra token auth for Azure
Cache for Redis (`CACHE_REDIS_AUTH=entra`) and real sign-in through Entra ID.

To deploy for real, use `deploy/azure/` (Bicep and Terraform) and
[Azure setup](setup-azure.md).

### Google Cloud (`gcp`)

| Google Cloud service | Local replacement |
|---|---|
| Cloud Storage | **fake-gcs-server** (`GCS_API_ENDPOINT`) |
| Workload identity | **Metadata-server stand-in** (`GCE_METADATA_HOST`). It supplies Application Default Credentials, as on Cloud Run. |
| Secret Manager | **Stand-in** (`GCP_SECRET_MANAGER_ENDPOINT`). The client runs in its REST mode. `ENCRYPTION_KEY` and `SMTP_PASSWORD` are `secret://` references resolved through it. |
| Cloud KMS | **Stand-in** (`GCP_KMS_ENDPOINT`): `cryptoKeys.encrypt` / `decrypt` with the additional authenticated data checked, ADC tokens from the metadata stand-in. `KMS_PROVIDER=gcp_kms`. |
| SMTP relay | **Mailpit**, configured to require a login |
| Google OIDC | **Discovery stand-in** |
| Cloud Scheduler | The **`tick` container** calls the tick endpoint with `CRON_SECRET`. In the cloud, Cloud Scheduler sends an OIDC token instead. |
| Cloud Logging | **Stand-in** for `entries:write` (`LOG_EXPORT_GCP_LOGGING_URL`). The smoke test adds a `gcp_logging` destination with `auth: workload_identity` and checks its test event arrives. |

**Not emulated:** Cloud SQL IAM database auth (`DATABASE_AUTH=gcp`; tested
against PostgreSQL with a fake token provider) and Memorystore IAM auth
(`CACHE_REDIS_AUTH=gcp_iam`).

To deploy for real, use `deploy/gcp/` (Terraform) and
[Google Cloud setup](setup-gcp.md).

### AWS (`aws`)

| AWS service | Local replacement |
|---|---|
| ECS task role | **Container-credentials stand-in** over HTTPS (`AWS_CONTAINER_CREDENTIALS_FULL_URI`, test CA in `.state/certs`). Every AWS SDK call and SigV4 signature goes through the real credential chain. |
| S3, Secrets Manager, KMS, CloudWatch Logs | **LocalStack** (community), seeded by `deploy/compose/localstack/init-aws.sh`: `ENCRYPTION_KEY=secret://usertasks/encryption-key`, KMS key `alias/usertasks` |
| SES v2 | **Stand-in** for `SendEmail` (`AWS_ENDPOINT_URL_SESV2`; LocalStack's community edition has SES v1 only) |
| Cognito | **OIDC discovery stand-in** (preset `cognito`) |
| EventBridge | The **`tick` container** calls the tick endpoint with `CRON_SECRET`, like an API destination |
| CloudWatch Logs export | The smoke test adds an `aws_cloudwatch_logs` destination with `auth: instance_role` and `auto_create`, and reads its test event back from LocalStack |

**Not emulated:** RDS IAM database auth (`DATABASE_AUTH=aws`) and
ElastiCache IAM auth (`CACHE_REDIS_AUTH=aws_iam`): nothing local verifies
those tokens. Both are tested with a fake signer against PostgreSQL and
Valkey (`__tests__/pg-auth-aws.test.ts`, `__tests__/cache-aws-iam.test.ts`).

To deploy for real, use `deploy/aws/` (Terraform) and [AWS setup](setup-aws.md).

### KMS stand-ins

Each reference profile runs with envelope encryption (`KMS_PROVIDER`)
against a stand-in for its key service, and `npm run stack -- up` creates
the first data key (`usertasks-admin kms rotate --activate-in 0`), restarts
the app so it starts on it (the fail-closed startup path), and re-encrypts
the stored secrets (`kms rewrap`):

| Profile | `KMS_PROVIDER` | Stand-in |
|---|---|---|
| `onprem` | `vault_transit` | OpenBao 2 dev server with the Transit engine (`deploy/compose/kms.yml`, compose profile `kms-vault`) |
| `aws` | `aws_kms` | LocalStack KMS (key `alias/usertasks`, seeded by `deploy/compose/localstack/init-aws.sh`) |
| `standalone --kms aws_kms` (or another profile) | `aws_kms` | local-kms with a seeded key `alias/usertasks` (`AWS_KMS_ENDPOINT`; compose profile `kms-aws`) |
| `azure` | `azure_key_vault` | The Key Vault stand-in's keys API, over TLS with a managed-identity token |
| `gcp` | `gcp_kms` | The Cloud KMS stand-in, with ADC from the metadata stand-in |

`--kms env` turns it off; `--kms` only applies when the env file is first
written. The stand-ins' keys live in memory or in the mocks' seed: a
restart of OpenBao loses its key, so start over with `down --volumes`.

## Smoke test

`npm run stack -- smoke` does four things:

1. It creates a throwaway workspace, owner and API key
   (`usertasks-admin bootstrap --api-key`).
2. It runs `deploy/compose/smoke/smoke.mjs` in a container on the
   deployment's network. That script needs no dependencies and only uses
   HTTP. It checks:
   - the app answers;
   - the API key works;
   - a task round trip;
   - **password sign-in** through the login page's server action, and the
     session it sets;
   - a file upload that is **served back by `/files`**;
   - the **SSE realtime** stream opens;
   - an **invitation email** reaches the mail sink (Mailpit or the ACS /
     SES stand-in);
   - for the cloud profiles, a **log destination's test event** reaches the
     cloud log stand-in (Azure Monitor, Cloud Logging, CloudWatch Logs).
3. It runs `usertasks-admin doctor --json` and requires every check to pass,
   including the scheduler's **last tick**. It waits for that for up to three
   minutes.
4. With a KMS stand-in, it checks that the active data key is wrapped by
   the configured provider and unwrapped (`usertasks-admin kms status`);
   the doctor's KMS checks wrap and unwrap a probe key.
5. For `onprem`, it confirms there is no outbound internet.

The script also works against any running install:

```bash
SMOKE_URL=https://tasks.example.com SMOKE_API_KEY=ut_… SMOKE_EMAIL=… SMOKE_PASSWORD=… \
SMOKE_ORG=<slug> SMOKE_SIGNIN_ACTION=<id> SMOKE_MAIL=skip node deploy/compose/smoke/smoke.mjs
```

To find the sign-in action id, look up the `signInAction` entry in
`.next/server/server-reference-manifest.json` of the build.

## Full instance migration test

`scripts/e2e-instance-migration.ts` takes a Supabase-backed install with the
Northwind demo workspace (`scripts/screenshots/seed-demo.ts`) and moves every
area to other services:

1. It runs `usertasks-admin switch` for **auth → builtin, realtime → sse,
   scheduler → worker, storage → s3 (MinIO), email → smtp, secrets → db**,
   and then the **database → plain PostgreSQL**. Each switch has a dry run
   first.
2. It restarts the app with **no Supabase variables at all**.
3. It checks the result:
   - the surface E2E (`scripts/e2e-surfaces.ts`: REST, MCP, CLI) passes,
     before and after;
   - the demo owner **signs in with their old password**;
   - files copied from Supabase Storage **load through `/files`**;
   - **scheduled jobs run through the worker** (`app_cron.tick_runs`);
   - **log export** ships new events to the demo's Splunk HEC destination;
   - row counts match;
   - `usertasks-admin doctor` passes;
   - the **RLS semantics snapshot** is identical before and after.

It is destructive for its source: use CI's stack or a second local Supabase
stack (a copy of `supabase/` with another `project_id` and ports). It
refuses the default local ports unless `E2E_ALLOW_DEFAULT_PORTS=1`. The
header of the script lists its environment variables.

## Release gates

`.github/workflows/release-gates.yml` runs when started by hand
(`workflow_dispatch`), on `v*` release tags, or from another workflow
(`workflow_call`):

- **Reference profiles:** standalone, standalone with PgBouncer, standalone
  with local-kms (`--kms aws_kms`), onprem (with Keycloak and OpenBao),
  azure, gcp and aws. Each one is `stack up` + `smoke` + `down --volumes`.
- **Instance migration:** a local Supabase stack, plus PostgreSQL 16, MinIO
  and Mailpit as services, then `scripts/e2e-instance-migration.ts`.
- **Helm chart:** `helm lint`, `ct lint`, `helm template` of every example
  validated with kubeconform, then `npm run helm:gate` on kind (see
  [Kubernetes: release gate](setup-kubernetes.md#release-gate)).
- **Air-gapped bundle:** `npm run bundle -- create`, then
  `npm run bundle:e2e` on a host with no internet (see
  [Air-gapped installs: release gate](setup-air-gapped.md#release-gate)).

A release ships only when all of them pass.

## Infrastructure as code

| Directory | What it creates |
|---|---|
| `deploy/azure/bicep`, `deploy/azure/terraform` | Container Apps (web, a scheduled tick job, a manual migrate job), PostgreSQL Flexible Server with Entra-only auth, Blob Storage, Key Vault, Communication Services Email, Azure Cache for Redis (Entra-only auth, private endpoint), Log Analytics, a container registry and one user-assigned managed identity |
| `deploy/gcp/terraform` | Cloud Run (service and migrate job), Cloud SQL for PostgreSQL 16 with IAM database auth, Cloud Storage, Secret Manager, Memorystore for Redis (AUTH + TLS, Direct VPC egress), a Cloud Scheduler OIDC tick and Artifact Registry |
| `deploy/aws/terraform` | ECS on Fargate behind an ALB (web service, admin and tick task definitions), RDS for PostgreSQL 16 with IAM database auth, ElastiCache for Valkey with an IAM user, S3, SES, Secrets Manager, a KMS key, CloudWatch log groups, an EventBridge Scheduler tick (or API destination, or worker service) and ECR |
| `deploy/helm/usertasks` | The Helm chart for any Kubernetes (EKS, AKS, GKE, on-premises): [Kubernetes setup](setup-kubernetes.md) |

Each directory has a README with the deploy order and the one-time database
grants. The templates are checked with `terraform validate` and
`az bicep build`; they have not been applied to a live subscription or
project yet.
