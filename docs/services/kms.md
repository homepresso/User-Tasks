# Choosing a KMS

Credentials stored in the database (connector and integration secrets,
log-destination tokens, the package signing key, encrypted instance
settings) are encrypted with AES-256-GCM. By default the key is
`ENCRYPTION_KEY`. With **envelope encryption**, each value is encrypted with
a data key, and only the data key, wrapped by a key-encryption key in your
KMS, is stored. The KMS never sees your data, and its key never leaves the
KMS.

| Option | `KMS_PROVIDER` | On-prem | AWS | Azure | Google Cloud | Switch |
|---|---|---|---|---|---|---|
| `ENCRYPTION_KEY` (environment or secret store) | `env` (default) | yes | yes | yes | yes | data |
| HashiCorp Vault / OpenBao Transit | `vault_transit` | yes | compatible | compatible | compatible | data |
| AWS KMS | `aws_kms` | — | native: encryption context in CloudTrail | — | — | data |
| Azure Key Vault key or Managed HSM key | `azure_key_vault` | — | — | native: managed identity | — | data |
| Google Cloud KMS (Cloud HSM, Cloud EKM) | `gcp_kms` | — | — | — | native: workload identity | data |

## When to pick which

- **`ENCRYPTION_KEY`** for most installs. Keep it in a secret store
  (`ENCRYPTION_KEY=secret://encryption-key`) rather than in plain
  environment variables.
- **A KMS** when policy says keys must be held in an HSM or KMS, when you
  need key-use audit logs, or when you want to revoke access by disabling a
  key.

## Rules

- **SDKs:** `aws_kms` and `azure_key_vault` need their optional SDK, included in the Docker image by default; `gcp_kms` and `vault_transit` need none ([Optional drivers](../optional-drivers.md)).
- **Nothing changes until a data key exists.** Turn it on with
  `usertasks-admin kms rotate --yes`, then `kms rewrap --yes` to
  re-encrypt existing values. The rewrap is resumable, and existing values
  keep decrypting meanwhile.
- **Start-up fails closed** with a non-`env` KMS: if the data keys can't be
  unwrapped, the app refuses to start rather than write secrets it couldn't
  read back.
- **A KMS can't protect its own credentials.** The options needed to reach
  it stay on `ENCRYPTION_KEY`. Keep them in the environment, in files or in
  an external secret store, never in the `db` store.
- Rotating the key in the KMS needs nothing: existing data keys keep
  unwrapping. `kms rewrap-keys` re-wraps them with the newest version.

```bash
usertasks-admin switch kms --to aws_kms --set aws_kms_key_id=alias/usertasks --yes
usertasks-admin kms rewrap --yes
usertasks-admin kms status
```

Reference: [KMS](../infrastructure.md#kms) and
[Switching providers](../switching-providers.md).
