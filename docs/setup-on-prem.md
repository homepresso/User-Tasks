# On-premises setup

This guide runs UserTasks entirely on your own infrastructure. It uses no
SaaS and needs no outbound internet. Every component below can run in an
air-gapped network. The [on-premises reference profile](deployment-profiles.md#on-premises-onprem)
is the tested version of this setup.

| Area | Recommended | Alternatives |
|---|---|---|
| Database | PostgreSQL 15+, behind PgBouncer in transaction mode | Patroni, CloudNativePG, Crunchy PGO, EDB |
| Auth | Built-in (email + password) | Keycloak, Authentik, ADFS, Dex or Zitadel over OIDC or SAML (`AUTH_SSO_PROVIDERS`) |
| Storage | MinIO or another S3-compatible store (Ceph RGW, SeaweedFS, StorageGRID) | a local disk or NFS volume (`STORAGE_PROVIDER=local`) |
| Realtime | `sse` (LISTEN/NOTIFY; needs no extra service) | |
| Scheduler | `worker` container | OS cron, a systemd timer or a Kubernetes CronJob calling `/api/cron/tick` (`external`) |
| Email | SMTP to Exchange, Postfix or any relay | |
| Secrets | `env` with Docker or Kubernetes secrets (`<VAR>_FILE`, `SECRETS_FILES_DIR`) | HashiCorp Vault / OpenBao |
| KMS | `env` (`ENCRYPTION_KEY`) | Vault / OpenBao Transit (`KMS_PROVIDER=vault_transit`) for envelope encryption |
| Cache | Valkey or Redis (`CACHE_PROVIDER=redis`) | `postgres` (no extra service); KeyDB, Dragonfly; `memory` for a single instance |
| AI agents | Ollama, vLLM, or any OpenAI-compatible endpoint (an agent connector) | |
| Logs | Syslog over TLS (rsyslog, syslog-ng, a SIEM), Splunk HEC, an OpenTelemetry Collector, or a webhook to Fluent Bit / Vector | syslog over TCP / UDP on a private network |

## 1. Images

The [air-gapped bundle](setup-air-gapped.md) has all of them, signed, with
the Helm chart and Compose files (`npm run bundle -- create`). By hand:

You need four images: `usertasks` (built from the repository's
`Dockerfile`), `postgres:16`, MinIO, and optionally
`edoburu/pgbouncer` and Keycloak.

On a connected machine, build or pull them, then copy them into the
isolated network:

```bash
docker build -t registry.internal/usertasks:<version> .
docker save registry.internal/usertasks:<version> | gzip > usertasks.tar.gz
```

Then push them to your internal registry.

The image leaves the Snowflake, Oracle and MongoDB drivers out unless you
build it with `--build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true`, and a missing
driver can't be added to the finished image. Choose the drivers before you
build: see [Optional drivers](optional-drivers.md).

## 2. Configuration

1. Start from `deploy/compose/standalone.env.example`. `npm run stack -- init`
   fills in fresh secrets for you.
2. Set `APP_URL` to the address users open, for example
   `https://tasks.corp.example`.
3. Point `SMTP_HOST` / `SMTP_PORT` at your relay. Use `SMTP_STARTTLS=required`
   for a relay that supports TLS.
4. If the database, the relay or your IdP use a private CA, mount the CA
   certificate and set `NODE_EXTRA_CA_CERTS`.
5. For Keycloak, add an entry like this to `AUTH_SSO_PROVIDERS`:

   ```
   [{"id":"keycloak","type":"oidc","preset":"keycloak","baseUrl":"https://sso.corp.example","realm":"corp","clientId":"usertasks","clientSecret":"secret://keycloak-client-secret"}]
   ```

   Register the redirect URI `<APP_URL>/auth/sso/keycloak/callback` in
   Keycloak.

## 3. Start and create the first workspace

```bash
docker compose --profile standalone up -d --wait      # add --profile pgbouncer if you use it
docker compose exec -e BOOTSTRAP_PASSWORD=… app node admin.cjs bootstrap --email admin@corp.example --org "Corp"
docker compose exec app node admin.cjs instance-admins add ops@corp.example
docker compose exec app node admin.cjs doctor
```

Startup runs migrations and creates the storage buckets on every `up`, in
the `migrate` container. On Kubernetes, use the Helm chart instead:
[Kubernetes setup](setup-kubernetes.md) (`examples/onprem.yaml`). With no
internet access at all, install from the
[air-gapped bundle](setup-air-gapped.md).

## 4. Check the setup

`npm run stack -- smoke --profile onprem` runs the release-gate checks:
sign-in, files, SSE, email, scheduler ticks, and no outbound internet. To
run the same HTTP checks against your own install, use
`deploy/compose/smoke/smoke.mjs` as described in
[Deployment profiles](deployment-profiles.md#smoke-test).

## Moving an existing Supabase install

Follow the order in
[Switching providers](switching-providers.md#moving-a-whole-install-off-supabase).
