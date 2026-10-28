/**
 * KMS provider options (`kms.<option>` instance settings, or the environment
 * variables below, which win). Options may be `secret://` references
 * (resolved from the secret store — not the `db` store, whose values are
 * themselves encrypted). Credentials needed to reach the KMS can never be
 * protected by it: instance settings store them encrypted with the
 * bootstrap ENCRYPTION_KEY (enc:v1) only.
 *
 * All providers:  refresh_seconds (how often running processes look for new
 *                 data keys; default 60), activation_seconds (delay before a
 *                 rotated data key is used for new ciphertext, so every
 *                 process has loaded it first; default 120)
 * env:            none — the key-encryption key is ENCRYPTION_KEY
 * vault_transit:  vault_transit_key (required), vault_transit_mount (default
 *                 transit), and the Vault connection / auth options shared
 *                 with the secrets provider: vault_addr, vault_namespace,
 *                 vault_auth, vault_token, vault_role_id, vault_secret_id,
 *                 vault_approle_mount, vault_k8s_role, vault_k8s_mount,
 *                 vault_k8s_token_path (VAULT_* variables)
 * aws_kms:        aws_kms_key_id (key id, ARN or alias/…), aws_region
 *                 (default AWS_REGION), aws_endpoint (VPC endpoint, local KMS)
 * azure_key_vault: azure_key_id (https://<vault>.vault.azure.net/keys/<name>[/<version>]
 *                 or a Managed HSM key URL), azure_key_algorithm (RSA-OAEP-256
 *                 (default), RSA-OAEP, A256KW for Managed HSM AES keys)
 * gcp_kms:        gcp_kms_key_name (projects/…/locations/…/keyRings/…/cryptoKeys/…),
 *                 gcp_credentials_json (default ADC / workload identity),
 *                 gcp_kms_endpoint (regional / private endpoint)
 */

export const KMS_OPTION_ENV: Record<string, string> = {
  refresh_seconds: 'KMS_REFRESH_SECONDS',
  activation_seconds: 'KMS_ACTIVATION_SECONDS',
  vault_transit_key: 'VAULT_TRANSIT_KEY',
  vault_transit_mount: 'VAULT_TRANSIT_MOUNT',
  vault_addr: 'VAULT_ADDR',
  vault_namespace: 'VAULT_NAMESPACE',
  vault_auth: 'VAULT_AUTH_METHOD',
  vault_token: 'VAULT_TOKEN',
  vault_role_id: 'VAULT_ROLE_ID',
  vault_secret_id: 'VAULT_SECRET_ID',
  vault_approle_mount: 'VAULT_APPROLE_MOUNT',
  vault_k8s_role: 'VAULT_K8S_ROLE',
  vault_k8s_mount: 'VAULT_K8S_MOUNT',
  vault_k8s_token_path: 'VAULT_K8S_TOKEN_PATH',
  aws_kms_key_id: 'AWS_KMS_KEY_ID',
  aws_region: 'AWS_KMS_REGION',
  aws_endpoint: 'AWS_KMS_ENDPOINT',
  azure_key_id: 'AZURE_KMS_KEY_ID',
  azure_key_algorithm: 'AZURE_KMS_KEY_ALGORITHM',
  gcp_kms_key_name: 'GCP_KMS_KEY_NAME',
  gcp_credentials_json: 'GCP_KMS_CREDENTIALS_JSON',
  gcp_kms_endpoint: 'GCP_KMS_ENDPOINT',
}

/** Credentials among the options: instance settings must store them encrypted (enc:v1) or as secret:// refs. */
export const KMS_SECRET_OPTIONS = new Set(['vault_token', 'vault_secret_id', 'gcp_credentials_json'])

export type KmsOptions = Record<string, unknown>

export function kmsOption(options: KmsOptions, name: string): string | undefined {
  const value = options[name]
  if (value === undefined || value === null) return undefined
  const text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.trim() === '' ? undefined : text.trim()
}

export function kmsSeconds(options: KmsOptions, name: string, fallback: number): number {
  const raw = Number(kmsOption(options, name))
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback
}
