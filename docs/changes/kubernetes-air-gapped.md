# Release notes: Kubernetes and air-gapped installs

UserTasks now ships a Helm chart and a signed air-gapped install bundle,
and the reference deployments gained a managed cache and KMS stand-ins. No
application behaviour changes, no new migrations, and the default (Supabase)
providers are untouched.

## Added

- **Helm chart** (`deploy/helm/usertasks`): the web app (probes, HPA, PDB,
  non-root, read-only root filesystem), the worker Deployment or a tick
  CronJob, migrations as a pre-install / pre-upgrade hook or a Job per
  revision that the pods wait for, an optional bootstrap Job, Ingress
  (cert-manager) or Gateway API, NetworkPolicies with an egress allowlist,
  workload identity for EKS, AKS and GKE, secrets from an existing Secret,
  External Secrets or the Secrets Store CSI driver, every provider area from
  values (secret options refused in plain values), bundled PostgreSQL /
  MinIO / Valkey / Mailpit for evaluation, `values.schema.json`, and example
  values for evaluation, on-premises, EKS, AKS and GKE. See
  [Kubernetes setup](../setup-kubernetes.md).
- **Air-gapped bundle** (`npm run bundle -- create | verify | load`): the
  images, chart, Compose files, CLI and SDK tarballs (installable offline),
  docs and SBOMs, with SHA256SUMS and an ed25519 signature (the package
  signing fingerprint format); `bundle.sh` verifies, loads (optionally into
  a private registry), runs and smoke-tests it with no Node.js. See
  [Air-gapped installs](../setup-air-gapped.md).
- **KMS stand-ins in the reference profiles:** onprem runs envelope
  encryption against OpenBao Transit, azure against a Key Vault key
  stand-in, gcp against a Cloud KMS stand-in, and `--kms aws_kms` adds
  local-kms to any profile. `npm run stack -- up` creates the first data key
  and the smoke test checks it.
- **Caches in the templates:** Azure Cache for Redis (Entra-only auth,
  private endpoint) in the Bicep and Terraform templates, Memorystore for
  Redis (AUTH + TLS, Direct VPC egress) in the Google Cloud template, both
  wired to `CACHE_PROVIDER=redis` (`cacheEnabled` / `cache_enabled = false`
  for the postgres cache).
- **Release gates:** Helm lint, chart-testing, kubeconform, a kind run
  (install, in-cluster smoke test, doctor, no-egress check, upgrade, hook
  mode) and the air-gapped bundle on an offline Docker-in-Docker host.

## Upgrading

Nothing to do for existing installs. Existing Azure and Google Cloud
template deployments gain the cache resources on the next apply (set the
cache variable to false to keep the current setup).
