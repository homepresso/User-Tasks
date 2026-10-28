# UserTasks Helm chart

UserTasks on Kubernetes: the web app, the scheduler worker or a tick
CronJob, database migrations on every install and upgrade, and optional
bundled PostgreSQL, MinIO, Valkey and Mailpit for evaluation. Every provider
area (database, auth, storage, realtime, scheduler, email, secrets, KMS,
cache) is configured from values. The step-by-step guide is
[docs/setup-kubernetes.md](../../../docs/setup-kubernetes.md); air-gapped
installs: [docs/setup-air-gapped.md](../../../docs/setup-air-gapped.md).

```bash
# Evaluation: everything in the cluster, no cloud account.
helm install usertasks deploy/helm/usertasks -f deploy/helm/usertasks/examples/eval.yaml \
  --set image.repository=registry.example.com/usertasks --set image.tag=0.1.0
kubectl port-forward svc/usertasks 3000:80     # http://localhost:3000
```

| Example | What it sets up |
|---|---|
| [`examples/eval.yaml`](examples/eval.yaml) | Bundled PostgreSQL, MinIO, Valkey and Mailpit; built-in auth, SSE, the worker |
| [`examples/onprem.yaml`](examples/onprem.yaml) | Your PostgreSQL, S3 store, Valkey, SMTP relay; Keycloak OIDC; Vault for secrets and KMS (Kubernetes auth); private CA; internal registry; egress allowlist |
| [`examples/eks.yaml`](examples/eks.yaml) | RDS, S3, ElastiCache, SES, Secrets Manager, KMS over IRSA; External Secrets; ALB ingress |
| [`examples/aks.yaml`](examples/aks.yaml) | Flexible Server (Entra auth), Blob, Azure Cache for Redis (Entra), ACS email, Key Vault secrets + KMS over workload identity; Secrets Store CSI driver |
| [`examples/gke.yaml`](examples/gke.yaml) | Cloud SQL (IAM auth), GCS, Memorystore (IAM), Secret Manager, Cloud KMS over workload identity; External Secrets; Gateway API |

The image decides which [optional drivers](../../../docs/optional-drivers.md)
exist (Dockerfile build args `INCLUDE_OPTIONAL_DB_DRIVERS`,
`INCLUDE_STORAGE_SDKS`, `INCLUDE_PROVIDER_SDKS`); build it with what your
providers need.

## What it deploys

| Resource | When |
|---|---|
| Deployment `<release>-usertasks` (`node server.js`), Service, probes on `GET /api/config/public` | Always |
| Deployment `<release>-usertasks-worker` (`node worker.cjs`) | `providers.scheduler.provider: worker` and `worker.enabled` (web pods then run with `SCHEDULER_IN_PROCESS=false`) |
| CronJob `<release>-usertasks-tick` (`POST /api/cron/tick` with `CRON_SECRET`, or `node worker.cjs --once`) | `providers.scheduler.provider: external` |
| Job `…-migrate` (`usertasks-admin db migrate` + `storage init`) | `migrate.enabled`; a pre-install / pre-upgrade hook, or a Job per revision (`migrate.mode`) |
| Job `…-bootstrap` (first workspace and owner) | `bootstrap.enabled`, post-install |
| ConfigMap `…-config` (every plain setting), Secret `…-env` (generated `ENCRYPTION_KEY`, `CRON_SECRET`, `secrets.values`) | Always / when the chart creates the Secret |
| ExternalSecret, SecretProviderClass | `secrets.externalSecret.enabled`, `secrets.csi.enabled` |
| ServiceAccount (with IRSA / AKS / GKE workload identity annotations) | `serviceAccount.create` |
| Ingress (cert-manager annotations), HTTPRoute | `ingress.enabled`, `gateway.enabled` |
| HorizontalPodAutoscaler, PodDisruptionBudget | `app.autoscaling.enabled`; more than one replica |
| NetworkPolicies (app ingress, bundled dependencies, egress allowlist) | `networkPolicy.enabled` |
| PostgreSQL / MinIO StatefulSets, Valkey / Mailpit Deployments | `postgresql.enabled`, `minio.enabled`, `valkey.enabled`, `mailpit.enabled` |

Every pod runs as non-root (uid 1001) with a read-only root filesystem, no
capabilities and the RuntimeDefault seccomp profile; `/tmp` and
`/app/.next/cache` are emptyDirs.

## Configuration

Plain settings go in `providers.<area>.options` by their instance-setting
names (the names `usertasks-admin switch --set` takes) and become
environment variables; [`files/provider-options.json`](files/provider-options.json)
maps every name to its variable (generated from the code:
`npx tsx scripts/helm-options.ts`). Options the app treats as secrets
(`smtp_password`, `redis_password`, `secret_access_key`, `vault_token`, …)
are refused there: put them in the Secret, or set the option to a
`secret://<name>` reference resolved by the secrets provider. In
`sso_providers`, each `clientSecret` must be a `secret://` reference.

Secrets reach every container from one Secret (`envFrom`), in order of
preference: `secrets.existingSecret`; an ExternalSecret
(`secrets.externalSecret`); or one the chart creates from `secrets.values`,
with `ENCRYPTION_KEY` and `CRON_SECRET` generated and kept across upgrades.
With the Secrets Store CSI driver (`secrets.csi`), the mounted files are
read as `SECRETS_FILES_DIR`, so `secret://<name>` resolves to the file.
When a key is set both in values and the Secret, the Secret wins.

**Migrations.** `migrate.mode: auto` runs them as a pre-install /
pre-upgrade hook when the Secret exists before the release
(`secrets.existingSecret`) and nothing is bundled; otherwise as a Job named
after the release revision, and the app and worker pods wait for it (an
init container polls `usertasks-admin db status`). The hook gets its own
ServiceAccount (`…-migrate`, same annotations): with IAM database auth,
federate or bind it as well. Hook resources stay after `helm uninstall`
(`kubectl delete job,configmap,serviceaccount -l app.kubernetes.io/instance=<release>`).

## Values

| Key | Default | Description |
|---|---|---|
| `global.imageRegistry` | `""` | Registry prefix for every image (app and bundled dependencies), e.g. the internal registry of an air-gapped install |
| `image.repository` / `tag` / `digest` / `pullPolicy` | `usertasks` / appVersion / `""` / `IfNotPresent` | The UserTasks image (`digest` wins over `tag`) |
| `imagePullSecrets` | `[]` | Pull secrets for every pod |
| `appUrl` | `http://usertasks.local` | Public origin (`APP_URL`, `NEXT_PUBLIC_APP_URL`); also the Ingress / HTTPRoute host by default |
| `instanceAdminEmails` | `[]` | `INSTANCE_ADMIN_EMAILS` |
| `infrastructureUi.switching` | `true` | `false` sets `INFRA_UI_SWITCHING=false` (Settings → Infrastructure read-only) |
| `infrastructureUi.backupDir` | `""` | `BACKUP_DIR` for switches started from the page; mount a volume there |
| `providers.<area>.provider` | `""` (app default) | `<AREA>_PROVIDER` for db, auth, storage, realtime, scheduler, email, secrets, cache, kms |
| `providers.<area>.options` | `{}` | Provider options by name (see Configuration) |
| `logExport.allowInstanceIdentity` | `false` | `LOG_EXPORT_ALLOW_INSTANCE_IDENTITY` |
| `logExport.endpoints.<name>` | `{}` | `LOG_EXPORT_<NAME>`: `datadog_url`, `event_hubs_url`, `gcp_logging_url`, `gcp_pubsub_url`, `azure_authority_url`, `gcp_token_url` |
| `security.allowPrivateEgress` | `false` | `ALLOW_PRIVATE_EGRESS` (LDAP / AD directory sync, log destinations and integrations on private addresses) |
| `security.enableCustomActivityCode` / `allowQueryKeyAuth` / `mcpAllowedOrigins` | `false` / `false` / `[]` | `ENABLE_CUSTOM_ACTIVITY_CODE`, `ALLOW_QUERY_KEY_AUTH`, `MCP_ALLOWED_ORIGINS` |
| `env` | `{}` | Extra plain variables for every container |
| `extraEnv` / `extraEnvFrom` | `[]` | Raw EnvVar / EnvFromSource entries |
| `extraVolumes` / `extraVolumeMounts` | `[]` | For every UserTasks container (e.g. a ReadWriteMany PVC for `STORAGE_PROVIDER=local`) |
| `caBundle.configMap` / `secret` / `key` | `""` / `""` / `ca.crt` | Private CA, mounted and set as `NODE_EXTRA_CA_CERTS` |
| `secrets.existingSecret` | `""` | A Secret you manage |
| `secrets.externalSecret.*` | off | `enabled`, `apiVersion` (`external-secrets.io/v1`), `secretStoreRef`, `refreshInterval`, `data`, `dataFrom` |
| `secrets.create` / `secrets.values` | `true` / `{}` | The chart's own Secret and its extra keys |
| `secrets.csi.*` | off | `enabled`, `secretProviderClass` (existing) or `spec` (created), `mountPath` (`/mnt/secrets-store`) |
| `bootstrap.*` | off | `enabled`, `email`, `org`, `name`, `passwordSecret` / `passwordKey` (default: the main Secret's `BOOTSTRAP_PASSWORD`) |
| `app.replicas` | `2` | Web replicas (ignored with autoscaling) |
| `app.command` | `["node", "server.js"]` | |
| `app.resources` | 250m / 512Mi requests, 1Gi limit | |
| `app.probes.*` | `/api/config/public` | `path`, `startup`, `readiness`, `liveness` (period, thresholds, timeouts) |
| `app.autoscaling.*` | off, 2–10, 70% CPU | `enabled`, `minReplicas`, `maxReplicas`, `targetCPUUtilizationPercentage`, `targetMemoryUtilizationPercentage` |
| `app.pdb.enabled` / `minAvailable` | `true` / `1` | Created with more than one replica or autoscaling |
| `app.podAnnotations`, `podLabels`, `nodeSelector`, `tolerations`, `affinity`, `topologySpreadConstraints`, `priorityClassName`, `terminationGracePeriodSeconds` | | Scheduling |
| `worker.enabled` / `replicas` / `resources` | `true` / `1` | The worker Deployment (with `scheduler.provider: worker`); extra replicas are standbys |
| `worker.podAnnotations`, `nodeSelector`, `tolerations`, `affinity`, `terminationGracePeriodSeconds` | `90` s grace | |
| `tick.schedule` / `mode` | `* * * * *` / `http` | The tick CronJob (with `scheduler.provider: external`): `http` or `worker-once` |
| `migrate.enabled` / `mode` / `storageInit` / `args` | `true` / `auto` / `true` / `[]` | See Configuration |
| `migrate.backoffLimit` / `activeDeadlineSeconds` / `ttlSecondsAfterFinished` / `resources` | `6` / `1800` / `86400` | |
| `waitForMigrations` | `true` | App, worker and bootstrap pods wait until no migration is pending |
| `podSecurityContext` / `securityContext` | non-root 1001, read-only root, no capabilities | |
| `serviceAccount.create` / `name` / `annotations` / `automountServiceAccountToken` | `true` / `""` / `{}` / `false` | The token is mounted when workload identity or Vault Kubernetes auth needs it |
| `serviceAccount.workloadIdentity.awsRoleArn` | `""` | EKS IRSA (`eks.amazonaws.com/role-arn`) |
| `serviceAccount.workloadIdentity.azureClientId` / `azureTenantId` | `""` | AKS workload identity (annotation + `azure.workload.identity/use` pod label) |
| `serviceAccount.workloadIdentity.gcpServiceAccount` | `""` | GKE workload identity (`iam.gke.io/gcp-service-account`) |
| `service.type` / `port` / `annotations` | `ClusterIP` / `80` | |
| `ingress.enabled` / `className` / `annotations` / `host` | off | Host defaults to `appUrl`'s. SSE needs proxy buffering off and a long read timeout |
| `ingress.certManager.clusterIssuer` / `issuer` | `""` | cert-manager annotations |
| `ingress.tls.enabled` / `secretName` | off / `<fullname>-tls` | |
| `gateway.enabled` / `parentRefs` / `hostnames` / `annotations` | off | Gateway API HTTPRoute |
| `networkPolicy.enabled` | `false` | |
| `networkPolicy.ingress.from` | `[]` | Extra peers allowed to reach the app (empty: anyone in the cluster) |
| `networkPolicy.egress.mode` | `open` | `allowlist`: DNS, the release's own pods and `allow` only (no internet) |
| `networkPolicy.egress.allow` | `[]` | `[{cidr, except, ports}]` |
| `networkPolicy.egress.kubeApiCidr` | `""` | The API server, for Vault Kubernetes auth |
| `postgresql.*` | off | `enabled`, `image`, `database`, `username`, `persistence.{enabled,size,storageClass}`, `resources` |
| `minio.*` | off | `enabled`, `image`, `persistence.*`, `resources` |
| `valkey.*` | off | `enabled`, `image`, `resources` (no persistence) |
| `mailpit.*` | off | `enabled`, `image`, `resources` |

## Tests

```bash
helm lint deploy/helm/usertasks
ct lint --config ct.yaml --all                  # chart-testing
npm run helm:gate -- --image usertasks:local    # kind: install, smoke, doctor, no-egress, upgrade, hook mode
```

`helm test <release>` checks the Service answers the health endpoint.
