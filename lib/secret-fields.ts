import { encryptSecret, decryptSecret, isEncrypted } from './secret-crypto'
import { isPlainObject } from '@/lib/utils/guards'

/**
 * Field-level secret encryption for credential-bearing JSON blobs
 * (`integrations.config`, `tenant_connectors.config` / `.credentials`).
 *
 * Only values under SENSITIVE keys are encrypted so non-secret config
 * (base_url, host, port, key_name, usernames, tags, …) stays readable for
 * list views and edit UIs. The walk is deep (nested auth_config / db_config /
 * service-account payloads) and idempotent:
 *  - encryptSensitiveFields skips values that are already `enc:v1:` encrypted
 *    (via isEncrypted inside encryptSecret), so round-tripping an edit form
 *    never double-encrypts.
 *  - decryptSensitiveFields decrypts ANY `enc:v1:` string it finds and leaves
 *    legacy plaintext untouched, so encrypted and legacy rows can coexist.
 */

// A key is considered sensitive when it names a credential-ish value.
// Derived from the shapes built in app/actions/integrations.ts,
// app/actions/connectors.ts, lib/connectors/definitions/* and consumed by
// lib/reference-executor.ts, lib/db-connector.ts, lib/workflow-engine.ts.
export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase()
  return (
    k.includes('password') ||          // password, entra_password, db password
    k.includes('secret') ||            // secret, client_secret, app_secret, secret_access_key, secret_key, entra_client_secret
    k.includes('private_key') ||       // private_key (google service accounts)
    k.includes('account_key') ||       // account_key (azure blob)
    k.includes('service_account') ||   // service_account, service_account_json
    k === 'token' ||
    k.endsWith('_token') ||            // access_token, api_token, auth_token, bot_token, sas_token, refresh_token
    k === 'api_key' ||
    k.endsWith('_api_key') ||
    k === 'key_value'                  // generic api-key auth value
  )
}

const MAX_DEPTH = 32

function walk(value: unknown, transform: (v: string, keyIsSensitive: boolean) => string, keyIsSensitive: boolean, depth: number): unknown {
  if (depth > MAX_DEPTH) return value
  if (typeof value === 'string') {
    return transform(value, keyIsSensitive)
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, transform, keyIsSensitive, depth + 1))
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      out[key] = walk(val, transform, keyIsSensitive || isSensitiveKey(key), depth + 1)
    }
    return out
  }
  return value
}

/**
 * Deep-copy `obj`, encrypting every string value that sits under a sensitive
 * key (at any nesting depth). Already-encrypted values and non-sensitive keys
 * are left untouched. No-op passthrough when ENCRYPTION_KEY is unset.
 */
export function encryptSensitiveFields<T>(obj: T): T {
  if (obj == null) return obj
  return walk(obj, (v, sensitive) => (sensitive ? encryptSecret(v) : v), false, 0) as T
}

/**
 * Deep-copy `obj`, decrypting every `enc:v1:` string found anywhere (not just
 * under sensitive keys, so renamed/legacy keys still decrypt). Plaintext
 * values pass through unchanged, which keeps legacy unencrypted rows working.
 */
export function decryptSensitiveFields<T>(obj: T): T {
  if (obj == null) return obj
  return walk(obj, (v) => (isEncrypted(v) ? decryptSecret(v) : v), false, 0) as T
}
