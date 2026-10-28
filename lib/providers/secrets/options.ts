/**
 * Secret store options (`secrets.<option>` instance settings, or the
 * environment variables below, which win). Unlike other areas these can't
 * be secret references themselves: the store has to be reachable first.
 *
 * All stores:         name_prefix (prepended to every name, e.g. "usertasks/"),
 *                     cache_ttl_seconds (default 300), encryption_key_name
 *                     (where ENCRYPTION_KEY is looked up; default encryption_key)
 * env:                files_dir (also read <dir>/<name>: Docker / Kubernetes
 *                     secret mounts such as /run/secrets)
 * supabase_vault:     database_url (default DATABASE_URL)
 * hashicorp_vault:    vault_addr, vault_namespace, vault_mount (KV v2 mount,
 *                     default "secret"), vault_auth (token | approle |
 *                     kubernetes; default inferred), vault_token,
 *                     vault_role_id, vault_secret_id, vault_approle_mount,
 *                     vault_k8s_role, vault_k8s_mount, vault_k8s_token_path
 * azure_key_vault:    azure_key_vault_url (https://<vault>.vault.azure.net)
 * gcp_secret_manager: gcp_project_id (default GOOGLE_CLOUD_PROJECT),
 *                     gcp_credentials_json (default ADC / workload identity),
 *                     gcp_endpoint (regional / private endpoint)
 * aws_secrets_manager: aws_region (default AWS_REGION), aws_endpoint
 */

export const SECRETS_OPTION_ENV: Record<string, string> = {
  name_prefix: 'SECRETS_NAME_PREFIX',
  cache_ttl_seconds: 'SECRETS_CACHE_TTL_SECONDS',
  encryption_key_name: 'SECRETS_ENCRYPTION_KEY_NAME',
  files_dir: 'SECRETS_FILES_DIR',
  database_url: 'SECRETS_DATABASE_URL',
  vault_addr: 'VAULT_ADDR',
  vault_namespace: 'VAULT_NAMESPACE',
  vault_mount: 'VAULT_KV_MOUNT',
  vault_auth: 'VAULT_AUTH_METHOD',
  vault_token: 'VAULT_TOKEN',
  vault_role_id: 'VAULT_ROLE_ID',
  vault_secret_id: 'VAULT_SECRET_ID',
  vault_approle_mount: 'VAULT_APPROLE_MOUNT',
  vault_k8s_role: 'VAULT_K8S_ROLE',
  vault_k8s_mount: 'VAULT_K8S_MOUNT',
  vault_k8s_token_path: 'VAULT_K8S_TOKEN_PATH',
  azure_key_vault_url: 'AZURE_KEY_VAULT_URL',
  gcp_project_id: 'GCP_SECRET_MANAGER_PROJECT',
  gcp_credentials_json: 'GCP_SECRET_MANAGER_CREDENTIALS_JSON',
  gcp_endpoint: 'GCP_SECRET_MANAGER_ENDPOINT',
  aws_region: 'AWS_SECRETS_MANAGER_REGION',
  aws_endpoint: 'AWS_SECRETS_MANAGER_ENDPOINT',
}

/** Credentials among the options: instance settings must store them encrypted. */
export const SECRETS_SECRET_OPTIONS = new Set(['vault_token', 'vault_secret_id', 'gcp_credentials_json'])

export type SecretStoreOptions = Record<string, unknown>

export function secretOption(options: SecretStoreOptions, name: string): string | undefined {
  const value = options[name]
  if (value === undefined || value === null) return undefined
  const text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.trim() === '' ? undefined : text.trim()
}
