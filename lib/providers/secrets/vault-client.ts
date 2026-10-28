import { readFile } from 'node:fs/promises'
import { secretOption, type SecretStoreOptions } from './options'
import { SecretStoreError, describeError } from './types'

/**
 * HashiCorp Vault / OpenBao HTTP API client shared by the KV v2 secret store
 * (./hashicorp-vault) and the Transit KMS provider (lib/providers/kms).
 *
 * Auth (vault_auth, inferred when unset):
 *  - token        vault_token / VAULT_TOKEN
 *  - approle      vault_role_id + vault_secret_id (POST auth/<mount>/login)
 *  - kubernetes   vault_k8s_role + the pod's service-account token
 *                 (POST auth/<mount>/login)
 * Login tokens are reused until shortly before their lease ends, and
 * renewed by logging in again (also after a 403). vault_namespace sets
 * X-Vault-Namespace (Vault Enterprise / HCP Vault, OpenBao namespaces).
 * TLS to a private CA: NODE_EXTRA_CA_CERTS. Errors never carry a token.
 */

export const K8S_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token'

type AuthMethod = 'token' | 'approle' | 'kubernetes'

export interface VaultClientDeps {
  fetch?: typeof fetch
  readFile?: (path: string) => Promise<string>
  now?: () => number
}

export interface VaultResponse {
  status: number
  ok: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Vault JSON bodies
  json: any
}

export interface VaultClient {
  readonly addr: string | undefined
  /** An authenticated request to /v1/<path> (re-logs in once after a 403 for AppRole / Kubernetes). */
  request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<VaultResponse>
}

/** `label` names the setting in configuration errors (e.g. SECRETS_PROVIDER=hashicorp_vault). */
export function createVaultClient(options: SecretStoreOptions, deps: VaultClientDeps = {}, label = 'SECRETS_PROVIDER=hashicorp_vault'): VaultClient {
  const doFetch = deps.fetch ?? fetch
  const read = deps.readFile ?? ((path: string) => readFile(path, 'utf8'))
  const now = deps.now ?? Date.now
  const addr = secretOption(options, 'vault_addr')?.replace(/\/+$/, '')
  const namespace = secretOption(options, 'vault_namespace')
  const staticToken = secretOption(options, 'vault_token')
  const roleId = secretOption(options, 'vault_role_id')
  const k8sRole = secretOption(options, 'vault_k8s_role')
  const auth = (secretOption(options, 'vault_auth')?.toLowerCase() ?? (staticToken ? 'token' : roleId ? 'approle' : k8sRole ? 'kubernetes' : 'token')) as AuthMethod
  if (!['token', 'approle', 'kubernetes'].includes(auth)) throw new SecretStoreError('VAULT_AUTH_METHOD must be token, approle or kubernetes')

  let session: { token: string; until: number } | null = null

  const headers = (token?: string): Record<string, string> => ({
    ...(token ? { 'X-Vault-Token': token } : {}),
    ...(namespace ? { 'X-Vault-Namespace': namespace } : {}),
    'content-type': 'application/json',
  })

  async function call(path: string, init: RequestInit): Promise<Response> {
    if (!addr) throw new SecretStoreError(`${label} requires VAULT_ADDR`)
    try {
      return await doFetch(`${addr}/v1/${path}`, init)
    } catch (error) {
      throw new SecretStoreError(`Vault unreachable at ${addr}: ${describeError(error)}`)
    }
  }

  async function login(): Promise<string> {
    if (auth === 'token') {
      if (!staticToken) throw new SecretStoreError(`${label} requires VAULT_TOKEN (or AppRole / Kubernetes auth)`)
      return staticToken
    }
    if (session && session.until > now()) return session.token
    let path: string
    let body: Record<string, string>
    if (auth === 'approle') {
      const secretId = secretOption(options, 'vault_secret_id')
      if (!roleId || !secretId) throw new SecretStoreError('Vault AppRole auth requires VAULT_ROLE_ID and VAULT_SECRET_ID')
      path = `auth/${secretOption(options, 'vault_approle_mount') ?? 'approle'}/login`
      body = { role_id: roleId, secret_id: secretId }
    } else {
      if (!k8sRole) throw new SecretStoreError('Vault Kubernetes auth requires VAULT_K8S_ROLE')
      let jwt: string
      try {
        jwt = (await read(secretOption(options, 'vault_k8s_token_path') ?? K8S_TOKEN_PATH)).trim()
      } catch (error) {
        throw new SecretStoreError(`Vault Kubernetes auth: cannot read the service-account token (${describeError(error)})`)
      }
      path = `auth/${secretOption(options, 'vault_k8s_mount') ?? 'kubernetes'}/login`
      body = { role: k8sRole, jwt }
    }
    const res = await call(path, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
    const json = (await res.json().catch(() => null)) as { auth?: { client_token?: string; lease_duration?: number }; errors?: string[] } | null
    if (!res.ok || !json?.auth?.client_token) {
      throw new SecretStoreError(`Vault ${auth} login failed (${res.status})${json?.errors?.length ? `: ${json.errors.join('; ').slice(0, 200)}` : ''}`)
    }
    const lease = Number(json.auth.lease_duration) || 3600
    // Renew a little before the lease ends (at least 30 s before, at most 10% early).
    session = { token: json.auth.client_token, until: now() + Math.max(5, lease - Math.max(30, lease * 0.1)) * 1000 }
    return session.token
  }

  return {
    addr,
    async request(method, path, body) {
      for (let attempt = 0; ; attempt++) {
        const token = await login()
        const res = await call(path, { method, headers: headers(token), ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
        if (res.status === 403 && attempt === 0 && auth !== 'token') {
          session = null // token revoked or expired early: log in again once
          continue
        }
        const json = await res.json().catch(() => null)
        return { status: res.status, ok: res.ok, json }
      }
    },
  }
}

/** Vault's `errors` array as a short suffix (never contains request data). */
export function vaultErrors(json: { errors?: unknown } | null | undefined): string {
  const errors = Array.isArray(json?.errors) ? (json!.errors as unknown[]).map(String) : []
  return errors.length ? `: ${errors.join('; ').slice(0, 200)}` : ''
}
