# Choosing a secret store

Credentials for the other providers (storage keys, SMTP passwords, client
secrets, API keys, even `ENCRYPTION_KEY`) can live in a secret store
instead of the environment or the database. Any provider option can be a
reference, `secret://name` or `secret://name#field`. Resolved values are
cached for `SECRETS_CACHE_TTL_SECONDS` (default 300), so rotations are
picked up without a restart.

| Option | `SECRETS_PROVIDER` | On-prem | AWS | Azure | Google Cloud | Switch |
|---|---|---|---|---|---|---|
| Environment, `<VAR>_FILE`, a mounted secrets directory | `env` (default) | yes | yes: ECS `secrets`, mounted files | yes: Container Apps secrets | yes: Cloud Run secret volumes | config |
| Encrypted in Postgres (`secrets.<name>` instance settings) | `db` | yes | yes | yes | yes | config |
| Supabase Vault | `supabase_vault` | with a Supabase database | — | — | — | config |
| HashiCorp Vault / OpenBao (KV v2) | `hashicorp_vault` | yes | compatible: HCP Vault | compatible | compatible | config |
| AWS Secrets Manager | `aws_secrets_manager` | — | native | — | — | config |
| Azure Key Vault | `azure_key_vault` | — | — | native | — | config |
| Google Secret Manager | `gcp_secret_manager` | — | — | — | native, with regional endpoints | config |

## When to pick which

- **Environment / mounted files** when your platform already injects
  secrets (Kubernetes Secrets, ECS task definitions, Docker secrets).
- **Your cloud's secret store** when the app runs in that cloud: it reaches
  the store with its own identity, and rotation and audit happen there.
- **Vault / OpenBao** on premises, or when one store serves several clouds.
- **`db`** for small installs that want secrets out of the environment
  without another service.

## Rules

- **SDKs:** `aws_secrets_manager`, `azure_key_vault` and `gcp_secret_manager` need their optional SDK, included in the Docker image by default ([Optional drivers](../optional-drivers.md)).
- **Keep the store in the app's cloud** (see
  [multi-cloud](../topologies/multi-cloud.md)). Credentials for other
  clouds then become references in it.
- `supabase_vault` needs the Supabase database. Move secrets elsewhere
  before moving the database.
- The switch checks that every `secret://` reference in every area resolves
  in the new store before it writes anything.
- Secret values are never printed by `status`, `doctor` or the switch log.

```bash
usertasks-admin switch secrets --to hashicorp_vault --set vault_addr=https://vault.internal:8200 --dry-run
```

Reference: [Secrets](../infrastructure.md#secrets).
