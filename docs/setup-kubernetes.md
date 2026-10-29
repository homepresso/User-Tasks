# Kubernetes setup

UserTasks runs on any Kubernetes 1.27+ (EKS, AKS, GKE, OpenShift, RKE2,
k3s, kind) from the Helm chart in `deploy/helm/usertasks`. It deploys the
web app, the scheduler (a worker Deployment or a tick CronJob), database
migrations on every install and upgrade, and, for evaluation, a bundled
PostgreSQL, MinIO, Valkey and Mailpit. The chart's
[README](../deploy/helm/usertasks/README.md) lists every value. Without
internet access, install from the [air-gapped bundle](setup-air-gapped.md).

| Area | In the cluster | Settings (values) |
|---|---|---|
| Web app | Deployment `node server.js`, probes on `GET /api/config/public`, HPA, PDB, non-root with a read-only root filesystem | `app.*` |
| Scheduler | `worker`: Deployment `node worker.cjs` (one leader ticks, extra replicas wait); `external`: CronJob calling `POST /api/cron/tick` with `CRON_SECRET` (or `node worker.cjs --once`) | `providers.scheduler.provider`, `worker.*`, `tick.*` |
| Migrations | `usertasks-admin db migrate` + `storage init`: a pre-install / pre-upgrade hook, or a Job per release revision that the app pods wait for | `migrate.*` |
| First workspace | Optional post-install Job (`usertasks-admin bootstrap`) | `bootstrap.*` |
| Every provider | Values mapped to the environment: `providers.<area>.provider` and `.options` for db, auth, storage, realtime, scheduler, email, secrets, cache and kms; `logExport.*`; `security.allowPrivateEgress` for LDAP / AD directory sync and log destinations on the LAN | `providers.*` |
| Secrets | One Secret (`envFrom`): yours, an ExternalSecret, or created by the chart; the Secrets Store CSI driver as files | `secrets.*` |
| Cloud identity | ServiceAccount annotations for EKS IRSA, AKS workload identity, GKE workload identity | `serviceAccount.workloadIdentity.*` |
| Traffic | Service, Ingress (cert-manager annotations) or Gateway API HTTPRoute | `ingress.*`, `gateway.*` |
| Network | NetworkPolicies: who reaches the app; an egress allowlist (DNS, the release, your CIDRs — no internet) | `networkPolicy.*` |

## 1. Image

Build the image from the repository and push it to your registry
(`docker build -t registry.example.com/usertasks:0.1.0 . && docker push …`),
or load it from the air-gapped bundle. The image decides which
[optional drivers](optional-drivers.md) exist: the storage, email, secrets
and KMS SDKs are in by default (`INCLUDE_STORAGE_SDKS`, `INCLUDE_PROVIDER_SDKS`),
the Snowflake, Oracle and MongoDB drivers only with
`--build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true`, OCR (tesseract.js) only with
`--build-arg INCLUDE_OCR=true`. Values can't add a missing
one; rebuild the image. Set `image.repository` and
`image.tag` (or `image.digest`), or `global.imageRegistry` to prefix every
image, the bundled dependencies' included.

## 2. Values

Start from an example in `deploy/helm/usertasks/examples/`:

| File | Platform |
|---|---|
| `eval.yaml` | Any cluster, evaluation: bundled PostgreSQL, MinIO, Valkey and Mailpit |
| `onprem.yaml` | On-premises: your PostgreSQL / PgBouncer, S3 store, Valkey, SMTP relay, Keycloak, Vault (secrets and Transit KMS with Kubernetes auth), private CA, egress allowlist |
| `eks.yaml` | Amazon EKS: RDS, S3, ElastiCache, SES, Secrets Manager, KMS through IRSA; External Secrets; ALB |
| `aks.yaml` | Azure AKS: Flexible Server with Entra auth, Blob, Azure Cache for Redis with Entra auth, ACS email, Key Vault secrets and keys through workload identity; Secrets Store CSI driver |
| `gke.yaml` | Google GKE: Cloud SQL with IAM auth, GCS, Memorystore with IAM auth, Secret Manager, Cloud KMS through workload identity; External Secrets; Gateway API |

Provider options use their instance-setting names, the same as
`usertasks-admin switch --set`:

```yaml
appUrl: https://tasks.corp.example
providers:
  db: { provider: postgres }
  auth: { provider: builtin }
  storage:
    provider: s3
    options: { endpoint: https://minio.corp.example:9000, force_path_style: true, access_key_id: usertasks }
  realtime: { provider: sse }
  scheduler: { provider: worker }
  email:
    provider: smtp
    options: { smtp_host: mail.corp.example, smtp_starttls: required, from: "UserTasks <tasks@corp.example>" }
  cache:
    provider: redis
    options: { redis_url: "rediss://valkey.corp.example:6379" }
secrets:
  existingSecret: usertasks-env
```

The chart refuses secret options (`smtp_password`, `secret_access_key`,
`redis_password`, `vault_token`, …) in values: put them in the Secret, or
make the option a `secret://<name>` reference that the secrets provider
resolves. SSO client secrets in `providers.auth.options.sso_providers` must
be `secret://` references.

## 3. Secrets

The Secret holds `ENCRYPTION_KEY`, `CRON_SECRET` and anything with a
password in it (`DATABASE_URL`, `MIGRATION_DATABASE_URL`,
`REALTIME_DATABASE_URL`, `SCHEDULER_DATABASE_URL`, `S3_SECRET_ACCESS_KEY`,
`SMTP_PASSWORD`, `CACHE_REDIS_PASSWORD`, …):

```bash
kubectl create namespace usertasks
kubectl -n usertasks create secret generic usertasks-env \
  --from-literal=ENCRYPTION_KEY=$(openssl rand -hex 32) \
  --from-literal=CRON_SECRET=$(openssl rand -hex 32) \
  --from-literal=DATABASE_URL='postgresql://usertasks:…@pgbouncer.corp.example:6432/usertasks' \
  --from-literal=MIGRATION_DATABASE_URL='postgresql://usertasks:…@postgres.corp.example:5432/usertasks' \
  --from-literal=REALTIME_DATABASE_URL='postgresql://usertasks:…@postgres.corp.example:5432/usertasks' \
  --from-literal=SCHEDULER_DATABASE_URL='postgresql://usertasks:…@postgres.corp.example:5432/usertasks' \
  --from-literal=S3_SECRET_ACCESS_KEY=… --from-literal=SMTP_PASSWORD=… --from-literal=CACHE_REDIS_PASSWORD=…
```

With PgBouncer in transaction mode, only `DATABASE_URL` goes through it:
migrations, `LISTEN` (SSE) and the worker's leader lock need a session.

Alternatives: `secrets.externalSecret` (External Secrets Operator, any
store it supports), `secrets.csi` (Secrets Store CSI driver; with
`secretObjects` it also syncs a Secret you name in `secrets.existingSecret`),
or let the chart create the Secret (`secrets.values`, with `ENCRYPTION_KEY`
and `CRON_SECRET` generated and kept across upgrades — back them up).

## 4. Install

```bash
helm install usertasks deploy/helm/usertasks -n usertasks -f my-values.yaml --wait --wait-for-jobs --timeout 15m
kubectl -n usertasks exec -it deploy/usertasks -- \
  sh -c 'BOOTSTRAP_PASSWORD=… node admin.cjs bootstrap --email admin@corp.example --org "Corp"'
kubectl -n usertasks exec deploy/usertasks -- node admin.cjs doctor
```

Or set `bootstrap.enabled` with `bootstrap.email`, `bootstrap.org` and the
password in the Secret (`BOOTSTRAP_PASSWORD`).

**Migrations.** With `secrets.existingSecret` and nothing bundled they run
as a pre-install / pre-upgrade hook, before any pod changes. Otherwise
(`migrate.mode: job`, or the chart creates the Secret, or bundled
PostgreSQL) each revision gets a Job `…-migrate-<revision>` and the app and
worker pods start once `usertasks-admin db status` reports nothing pending;
the old pods keep serving until then. Pass `--wait-for-jobs` to make
`helm install` / `upgrade` wait for it.

**Realtime.** SSE responses are long-lived: turn proxy buffering off and
raise the read timeout on the ingress (`nginx.ingress.kubernetes.io/proxy-buffering: "off"`,
`proxy-read-timeout: "3600"`; ALB `idle_timeout.timeout_seconds`).

**More than one replica** needs a shared cache: `providers.cache.provider`
`postgres` (no extra service) or `redis`. The chart's NOTES warn otherwise.

## 5. Cloud identity

| Platform | Values | What else |
|---|---|---|
| EKS (IRSA) | `serviceAccount.workloadIdentity.awsRoleArn` | An IAM role trusting the cluster's OIDC provider for `system:serviceaccount:<ns>:<release>-usertasks` (and `…-migrate` for the migrate hook) |
| AKS | `serviceAccount.workloadIdentity.azureClientId` (+ `azureTenantId`) | A user-assigned identity with federated credentials for the service accounts; pods get the `azure.workload.identity/use` label |
| GKE | `serviceAccount.workloadIdentity.gcpServiceAccount` | `roles/iam.workloadIdentityUser` for `<project>.svc.id.goog[<ns>/<release>-usertasks]` on the Google service account |

The token is mounted only when workload identity or Vault Kubernetes auth
(`vault_auth: kubernetes`) needs it.

## 6. On-premises and network isolation

`networkPolicy.egress.mode: allowlist` lets the pods reach DNS, the
release's own pods and the CIDR / port pairs in `networkPolicy.egress.allow`
— nothing else, so nothing reaches the internet. Add your database,
PgBouncer, S3 store, Valkey, SMTP relay, Vault, IdP, LDAP (636) and log
destinations (syslog 6514, Splunk HEC 8088, OTLP 4318), and
`kubeApiCidr` for Vault Kubernetes auth. `security.allowPrivateEgress: true`
lets integrations, LDAP and log destinations use private addresses. A
private CA goes in `caBundle` (`NODE_EXTRA_CA_CERTS`). Your CNI must
enforce NetworkPolicy (Calico, Cilium and the kindnet CNI of current kind releases do; flannel alone
does not).

## Upgrades

`helm upgrade usertasks deploy/helm/usertasks -n usertasks -f my-values.yaml --wait --wait-for-jobs`
runs the migrations again (a hook, or a new Job for the revision), then
rolls the pods (`maxUnavailable: 0`). A configuration change rolls them too
(a checksum annotation). Apply release notes' instance-level steps
(`docs/changes/`) as they say.

## Release gate

`npm run helm:gate -- --image usertasks:local` runs the chart on a
throwaway [kind](https://kind.sigs.k8s.io) cluster:

1. **eval**: `examples/eval.yaml` with the egress allowlist, installed with
   `--wait`: the migrate Job ran, the app and worker are ready; the HTTP
   smoke test (`deploy/compose/smoke/smoke.mjs`: API key, task round trip,
   password sign-in, a file served by `/files`, SSE, an invitation email in
   Mailpit) in a pod in the cluster; `usertasks-admin doctor` with a
   scheduler tick; **no egress**: the app pod can't reach the internet while
   a pod outside the release can.
2. **upgrade**: `helm upgrade` runs migrate Job revision 2, then `helm test`.
3. **hook**: a second release with an existing Secret (migrations as the
   pre-install hook), scheduler `external` (the tick CronJob), local
   storage, the postgres cache, console email; smoke, a tick, and an upgrade
   that re-runs the hook.

The release-gates workflow also runs `helm lint`, `ct lint --config ct.yaml --all`
(chart-testing) and kubeconform on `helm template` of every example.
`ct install --config ct.yaml --all` (with `deploy/helm/usertasks/ci/eval-values.yaml`)
works against any cluster as well.
