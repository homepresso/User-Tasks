import type { ProviderArea } from '@/lib/config/schema'

/**
 * Hosts a provider test would contact, from its (proposed) options: the
 * setup wizard and Settings → Infrastructure check each one against the
 * egress policy (lib/egress-guard) before a "Test" button connects, so the
 * buttons can't be used to probe cloud metadata endpoints or the private
 * network (SSRF). Pure: the guard itself is in ./egress-server.
 */

const URL_OPTIONS = new Set([
  'endpoint', 'azure_endpoint', 'gcs_endpoint', 'public_base_url', 'acs_endpoint', 'graph_endpoint', 'redis_url', 'vault_addr',
  'azure_key_vault_url', 'gcp_endpoint', 'aws_endpoint', 'gcp_kms_endpoint', 'azure_key_id', 'pg_cron_base_url',
])
const HOST_OPTIONS = new Set(['smtp_host'])
const IDP_URL_FIELDS = ['issuer', 'discoveryUrl', 'baseUrl', 'metadataUrl', 'entryPoint'] as const

export function hostOfUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const text = raw.trim()
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text.replace(/^(postgres(ql)?|rediss?|ldaps?):/i, 'http:') : `http://${text}`)
    return url.hostname.replace(/^\[|\]$/g, '') || null
  } catch {
    return null
  }
}

/** Hosts in one area's options (and switch flags, e.g. the database target). */
export function hostsForOptions(area: ProviderArea, options: Record<string, unknown>, flags: Record<string, unknown> = {}): string[] {
  const hosts = new Set<string>()
  const add = (h: string | null) => { if (h) hosts.add(h.toLowerCase()) }
  for (const [option, value] of Object.entries(options)) {
    if (URL_OPTIONS.has(option)) add(hostOfUrl(value))
    else if (HOST_OPTIONS.has(option) && typeof value === 'string' && value.trim()) add(value.trim().replace(/^\[|\]$/g, ''))
    else if (option === 'sso_providers' && typeof value === 'string') {
      try {
        const list = JSON.parse(value) as unknown
        if (Array.isArray(list)) for (const idp of list) for (const field of IDP_URL_FIELDS) add(hostOfUrl((idp as Record<string, unknown>)?.[field]))
        for (const idp of Array.isArray(list) ? list : []) {
          const domain = (idp as Record<string, unknown>)?.domain
          if (typeof domain === 'string' && domain.trim()) add(hostOfUrl(domain))
        }
      } catch {
        // Invalid JSON is reported by the field validation.
      }
    }
  }
  if (area === 'db') {
    add(hostOfUrl(flags['target-url']))
    if (typeof flags['target-host'] === 'string' && flags['target-host'].trim()) add(flags['target-host'].trim())
  }
  return [...hosts]
}
