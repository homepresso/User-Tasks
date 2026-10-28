// Secret scrubbing for tenant-level exports.
//
// Tenant manifests are designed to leave the platform (GitHub sync, cross-
// tenant cloning), so credential material must never travel with them.
// scrubSecretsForExport mirrors the deep traversal of encryptSensitiveFields
// in lib/secret-fields.ts: every string under a sensitive key (at any depth),
// every string under the v2 export blocklist (auth_config.token/password/
// key_value, db_config.password), and every already-encrypted 'enc:v1:' / 'enc:v2:'
// string is replaced with the '__SECRET__' sentinel.
//
// resolveSecretPlaceholders is the import-side counterpart: sentinels are
// restored from an existing record at the same path when one is provided
// (upsert flows), otherwise the key is removed so create-mode imports never
// persist the literal placeholder.

import { isSensitiveKey } from '@/lib/secret-fields'
import { isCiphertext } from '@/lib/secret-format'

export const SECRET_PLACEHOLDER = '__SECRET__'

const MAX_DEPTH = 32

// Keys whose direct children are always scrubbed regardless of
// isSensitiveKey — mirrors the explicit v2 app-export blocklist.
const BLOCKED_CHILD_KEYS: Record<string, readonly string[]> = {
  auth_config: ['token', 'password', 'key_value'],
  db_config: ['password'],
}

// Header values that carry credentials (integration `headers`, MCP headers).
// Not part of isSensitiveKey (they're stored as plain config), but they must
// never leave the platform in an export.
const CREDENTIAL_HEADERS = new Set(['authorization', 'proxy-authorization', 'x-api-key', 'api-key', 'cookie'])
function isCredentialHeader(key: string): boolean {
  return CREDENTIAL_HEADERS.has(key.toLowerCase())
}

/** True when exports scrub values under `key` (sensitive keys and credential headers). */
export function isSecretKey(key: string): boolean {
  return isSensitiveKey(key) || isCredentialHeader(key)
}

function scrubWalk(value: unknown, sensitive: boolean, blockedChildren: readonly string[] | undefined, depth: number): unknown {
  if (depth > MAX_DEPTH) return value
  if (typeof value === 'string') {
    return sensitive || isCiphertext(value) ? SECRET_PLACEHOLDER : value
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubWalk(item, sensitive, undefined, depth + 1))
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      const childSensitive = sensitive || isSensitiveKey(key) || isCredentialHeader(key) || (blockedChildren?.includes(key) ?? false)
      out[key] = scrubWalk(child, childSensitive, BLOCKED_CHILD_KEYS[key], depth + 1)
    }
    return out
  }
  return value
}

/**
 * Deep-copy `value`, replacing every string under a sensitive key, every
 * blocklisted credential field, and every 'enc:v1:' encrypted string with
 * the '__SECRET__' sentinel.
 */
export function scrubSecretsForExport<T>(value: T): T {
  if (value == null) return value
  return scrubWalk(value, false, undefined, 0) as T
}

function resolveWalk(incoming: unknown, existing: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return incoming
  if (Array.isArray(incoming)) {
    const resolved: unknown[] = []
    incoming.forEach((item, index) => {
      const prior = Array.isArray(existing) ? existing[index] : undefined
      if (item === SECRET_PLACEHOLDER) {
        // Restore from the existing value at the same position, else drop.
        if (prior !== undefined) resolved.push(prior)
        return
      }
      resolved.push(resolveWalk(item, prior, depth + 1))
    })
    return resolved
  }
  if (typeof incoming === 'object' && incoming !== null) {
    const existingRecord =
      typeof existing === 'object' && existing !== null && !Array.isArray(existing)
        ? (existing as Record<string, unknown>)
        : undefined
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(incoming)) {
      const prior = existingRecord?.[key]
      if (child === SECRET_PLACEHOLDER) {
        // Restore from the existing value at the same path, else remove key.
        if (prior !== undefined) out[key] = prior
        continue
      }
      out[key] = resolveWalk(child, prior, depth + 1)
    }
    return out
  }
  if (incoming === SECRET_PLACEHOLDER) return existing
  return incoming
}

/**
 * Deep-copy `incoming`, replacing '__SECRET__' sentinels with the value at
 * the same path in `existing` when provided; sentinels with no existing
 * counterpart are removed entirely.
 */
export function resolveSecretPlaceholders<T>(incoming: T, existing?: unknown): T {
  if (incoming == null) return incoming
  return resolveWalk(incoming, existing, 0) as T
}
