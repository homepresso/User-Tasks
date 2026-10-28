# Topology: on-premises and air-gapped

Everything runs inside your own network: no SaaS, no CDN and no outbound
internet. The [on-premises reference profile](../deployment-profiles.md#on-premises-onprem)
proves it: it runs the stack on a Docker network with no route out, and its
smoke test checks that the app can't reach the internet.

<!-- ::topology on-prem -->

## What runs where

| Area | Service | Provider id | Alternatives |
|---|---|---|---|
| Hosting | Docker Compose (`standalone` profile) or Kubernetes with the Helm chart, same image | — | Any container runtime |
| Database | PostgreSQL 15+ behind PgBouncer in transaction mode | `postgres` | Patroni, CloudNativePG, Crunchy PGO, EDB |
| Auth | Built-in passwords, plus Keycloak, Authentik, AD FS, Dex or Zitadel over OIDC or SAML | `builtin` | `oidc` / `saml` for SSO only; LDAP bind login with directory sync |
| Storage | MinIO or another S3-compatible store (Ceph RGW, SeaweedFS, StorageGRID) | `s3` | Local disk or NFS / SMB (`local`) |
| Realtime | Built-in SSE over LISTEN/NOTIFY | `sse` | — |
| Scheduler | The worker container (on Kubernetes: the worker Deployment) | `worker` | OS cron, a systemd timer or the chart's tick CronJob calling `/api/cron/tick` (`external`) |
| Email | An SMTP relay (Exchange, Postfix) | `smtp` | `console` for demos |
| Secrets | Environment and mounted files (`<VAR>_FILE`, `SECRETS_FILES_DIR`) | `env` | HashiCorp Vault / OpenBao (`hashicorp_vault`), encrypted in Postgres (`db`) |
| KMS | `ENCRYPTION_KEY` | `env` | Vault / OpenBao Transit (`vault_transit`) for envelope encryption |
| Cache | Valkey or Redis | `redis` | `postgres` (no extra service); KeyDB, Dragonfly; `memory` for one instance |
| Log export | Syslog over TLS to rsyslog, syslog-ng or a SIEM; Splunk HEC; an OpenTelemetry Collector; a webhook to Fluent Bit or Vector | destinations | Syslog over TCP or UDP on a private network |
| Directory sync | LDAP / Active Directory (LDAPS or StartTLS), or SCIM from an on-premises IdP | per workspace | — |
| AI agents (optional) | Ollama, vLLM or any OpenAI-compatible endpoint | agent connector | — |

## Configuration

Start from `deploy/compose/standalone.env.example` (`npm run stack -- init`
generates the secrets). The parts that make it on-premises:

```bash
DB_PROVIDER=postgres
DATABASE_URL=postgresql://usertasks:…@pgbouncer:5432/usertasks
MIGRATION_DATABASE_URL=postgresql://usertasks:…@postgres:5432/usertasks
REALTIME_DATABASE_URL=postgresql://usertasks:…@postgres:5432/usertasks
SCHEDULER_DATABASE_URL=postgresql://usertasks:…@postgres:5432/usertasks
AUTH_PROVIDER=builtin
AUTH_SSO_PROVIDERS=[{"id":"keycloak","type":"oidc","preset":"keycloak","baseUrl":"https://sso.corp.example","realm":"corp","clientId":"usertasks","clientSecret":"secret://keycloak-client-secret"}]
REALTIME_PROVIDER=sse
SCHEDULER_PROVIDER=worker
SCHEDULER_IN_PROCESS=false          # the worker container ticks
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://minio.corp.example:9000
S3_FORCE_PATH_STYLE=true
STORAGE_BUCKET_PREFIX=usertasks-
EMAIL_PROVIDER=smtp
SMTP_HOST=mail.corp.example
SMTP_STARTTLS=required
EMAIL_FROM="UserTasks <tasks@corp.example>"
SECRETS_FILES_DIR=/run/secrets
KMS_PROVIDER=vault_transit          # optional
VAULT_ADDR=https://vault.corp.example:8200
VAULT_TRANSIT_KEY=usertasks
CACHE_PROVIDER=redis
CACHE_REDIS_URL=rediss://valkey.corp.example:6379
NODE_EXTRA_CA_CERTS=/etc/ssl/corp-ca.pem
ALLOW_PRIVATE_EGRESS=true           # integrations, LDAP and log destinations on private addresses
```

The full walkthrough (images, configuration, first workspace, checks) is
[On-premises setup](../setup-on-prem.md).

## Air-gapped installs

- **The bundle.** `npm run bundle -- create` on a connected machine packs
  the images (the app, PostgreSQL, MinIO, Valkey, Mailpit, OpenBao, and
  optionally PgBouncer and Keycloak), the Helm chart, the Compose files, the
  CLI and SDK, the docs and SBOMs into one tarball, with SHA256SUMS and an
  ed25519 signature. On the offline side, `bundle.sh verify`, `load`
  (optionally into your registry) and `up`. See
  [Air-gapped installs](../setup-air-gapped.md).
  Build the `usertasks` image with the [optional drivers](../optional-drivers.md)
  you need first (`INCLUDE_OPTIONAL_DB_DRIVERS=true` for Snowflake, Oracle
  and MongoDB): they can't be downloaded inside the network later, and a
  finished image can't gain one without a rebuild.
- **No outbound connections.** Fonts and scripts are bundled into the
  image at build time, and the docs site is part of the app (`/docs`). The
  reference profile's smoke test fails if the app can reach the internet.
- **Integrations and agents** reach only what you allow. Private addresses
  need `ALLOW_PRIVATE_EGRESS=true`, and cloud metadata addresses stay
  blocked.
- **Private CA.** Mount it and set `NODE_EXTRA_CA_CERTS` for the database,
  SMTP, the IdP, Vault, LDAP and log destinations.
- **Kubernetes.** The Helm chart (`deploy/helm/usertasks`, also in the
  bundle) runs the app, the worker or a tick CronJob and the migrations,
  with `examples/onprem.yaml` for your services, Vault, a private CA and an
  egress allowlist NetworkPolicy (no internet). See
  [Kubernetes setup](../setup-kubernetes.md).

## Getting here from Supabase

If you evaluated on Supabase and now move in-house, follow the order in
[Switching providers](../switching-providers.md#moving-a-whole-install-off-supabase):
auth, realtime, scheduler, storage, email and secrets first, then the
database. Run the switches from a machine that can reach both sides. After
the database copy, the install no longer needs any outbound connection.

```bash
usertasks-admin switch auth      --to builtin --yes
usertasks-admin switch realtime  --to sse --yes
usertasks-admin switch scheduler --to worker --yes
usertasks-admin switch storage   --to s3 --set endpoint=https://minio.corp.example:9000 --set force_path_style=true \
  --set access_key_id=usertasks --secret secret_access_key=… --yes
usertasks-admin switch email     --to smtp --set smtp_host=mail.corp.example --set from='UserTasks <tasks@corp.example>' --test-to you@corp.example --yes
usertasks-admin switch secrets   --to db --yes
# stop writes, then:
usertasks-admin switch database  --to postgres --target-url 'postgresql://usertasks:…@postgres.corp.example:5432/usertasks' --yes
```

A new install doesn't need any of this: start directly with the
`standalone` profile (`npm run stack -- up`).

## Trade-offs

- **Cost:** hardware and people instead of cloud bills. Nothing is
  metered.
- **Operations:** you run everything: PostgreSQL HA and backups, object
  storage, the IdP, certificates, upgrades. The reference profile and
  `usertasks-admin doctor` give you a tested baseline.
- **Latency:** everything sits on your LAN.
- **Compliance:** the strongest story. Data never leaves your network, and
  every component is open source or yours.

## Data residency

Your data centre. Backups (`pg_dump`, object store replication,
`BACKUP_DIR` for switch backups) stay wherever you put them.

## Failure domains

Your own infrastructure. Run PostgreSQL with a replica and automated
failover (Patroni, CloudNativePG), MinIO in distributed mode, and at least
two app instances with a shared cache. The worker elects a leader through
the database, so extra worker replicas wait as standbys.
