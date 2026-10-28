import { isSecretRef, parseSecretRef } from './secret-refs'

/**
 * `secret://` references in credentials a workspace supplies (directory
 * sync connectors, log destinations). A workspace may only reference
 * secret-store names under `tenants/<workspace id>/`: anything else could
 * read instance secrets (ENCRYPTION_KEY, SMTP passwords, another workspace's
 * credentials) and send them to a server the workspace admin controls.
 */

export function tenantSecretPrefix(tenantId: string): string {
  return `tenants/${tenantId}/`
}

export function assertTenantSecretRef(ref: string, tenantId: string, label: string, example = 'my-secret'): void {
  let name: string
  try {
    name = parseSecretRef(ref).name
  } catch {
    throw new Error(`${label}: invalid secret reference`)
  }
  const prefix = tenantSecretPrefix(tenantId)
  if (!name.startsWith(prefix) || name.includes('..') || name.length <= prefix.length) {
    throw new Error(`${label}: secret references must name a secret under ${prefix} (e.g. secret://${prefix}${example})`)
  }
}

/**
 * Resolve `secret://` values in `credentials` (only references under the
 * workspace's own prefix; others are refused) from the configured secret
 * store. Plain values pass through.
 */
export async function resolveTenantSecretRefs<T extends Record<string, unknown>>(tenantId: string, credentials: T, labelPrefix: string, example?: string): Promise<T> {
  const out: Record<string, unknown> = { ...credentials }
  const refs = Object.entries(credentials).filter(([, value]) => isSecretRef(value))
  if (refs.length === 0) return out as T
  const { getProviderConfig } = await import('@/lib/config')
  const { resolveSecretRef, secretTtlMs } = await import('@/lib/config/secret-refs')
  const { secretStoreFor } = await import('@/lib/providers/secrets')
  const secrets = await getProviderConfig('secrets')
  const store = secretStoreFor(secrets.id, secrets.options)
  for (const [key, ref] of refs) {
    assertTenantSecretRef(ref as string, tenantId, `${labelPrefix} ${key}`, example)
    out[key] = await resolveSecretRef(ref as string, store, { label: `${labelPrefix} ${key}`, ttlMs: secretTtlMs(secrets.options) })
  }
  return out as T
}
