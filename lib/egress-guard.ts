import { lookup } from 'node:dns/promises'
import net from 'node:net'
import {
  addressInRules, getEgressPolicy, hasCidrRules, hostMatchesRules, httpAllowedForHost, httpAllowHint, inCidr4, ipv4ToInt, ipv6Hextets,
  loadEgressPolicy, privateAllowHint, type EgressPolicy,
} from './egress-policy'

/**
 * SSRF egress guard for user-supplied connection targets (integration base URLs,
 * DB hosts, connector probes). Blocks requests that would reach loopback,
 * link-local (cloud metadata), or private-range addresses — including via DNS
 * names that resolve there.
 *
 * Self-hosted deployments reach on-premises systems through the private
 * network allowlist (EGRESS_PRIVATE_ALLOW / instance.egress_private_allow,
 * lib/egress-policy.ts): a private target is allowed when its hostname
 * matches an entry or its resolved address is inside a listed CIDR.
 * ALLOW_PRIVATE_EGRESS=true still opens every private range (broad; prefer
 * the allowlist). Cloud metadata endpoints stay blocked unconditionally, and
 * the cloud edition ignores the allowlist.
 *
 * Decisions are made on resolved addresses. Transports that dial sockets
 * themselves check each address at connect time (assertSafeResolvedAddress
 * in a socket lookup), so a name that passed the check cannot rebind to a
 * blocked address before the connection is made.
 *
 * Server-only (uses node:dns) — do not import from client components.
 */

export class EgressBlockedError extends Error {
  constructor(target: string, reason: string) {
    super(`Connection to ${target} is not allowed: ${reason}`)
    this.name = 'EgressBlockedError'
  }
}

/** How a check passed: `private` says a private address was allowed, and by what. */
export interface EgressCheck {
  private: null | 'allow_all' | 'allowlist'
}

const METADATA_HOSTS = new Set([
  '169.254.169.254', // AWS/GCP/Azure IMDS
  'metadata.google.internal',
  'metadata.goog',
  'fd00:ec2::254', // AWS IMDSv6
])

/** Cloud metadata / credential endpoints: blocked whatever the policy lists. */
const METADATA_IPV4 = new Set([
  '169.254.169.254', // AWS / GCP / Azure / OpenStack IMDS
  '169.254.170.2', // ECS task metadata / credentials
  '169.254.170.23', // EKS Pod Identity
  '100.100.100.200', // Alibaba Cloud
])
const METADATA_IPV6 = [
  [0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254], // AWS IMDSv6
  [0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0023], // EKS Pod Identity (IPv6)
]

const v4Of = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`

/** The IPv4 address an IPv6 literal carries (mapped, compatible, NAT64, 6to4); null when none. */
function embeddedIpv4(h: number[]): string | null {
  const allZeroUntil = (i: number) => h.slice(0, i).every((x) => x === 0)
  if (allZeroUntil(5) && (h[5] === 0xffff || h[5] === 0) && !(allZeroUntil(7) && h[7] <= 1)) return v4Of(h[6], h[7])
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return v4Of(h[6], h[7])
  if (h[0] === 0x2002) return v4Of(h[1], h[2])
  return null
}

type AddressClass = 'metadata' | 'public' | 'private' | 'loopback' | 'link_local' | 'unspecified'

function classifyIpv4(ip: string): AddressClass {
  if (METADATA_IPV4.has(ip)) return 'metadata'
  const n = ipv4ToInt(ip)
  if (inCidr4(n, '0.0.0.0', 8)) return 'unspecified'
  if (inCidr4(n, '127.0.0.0', 8)) return 'loopback'
  if (inCidr4(n, '169.254.0.0', 16)) return 'link_local'
  if (inCidr4(n, '10.0.0.0', 8) || inCidr4(n, '100.64.0.0', 10) || inCidr4(n, '172.16.0.0', 12) || inCidr4(n, '192.168.0.0', 16)) return 'private'
  return 'public'
}

function classifyAddress(ip: string): AddressClass {
  const text = ip.replace(/^\[|\]$/g, '')
  if (net.isIPv4(text)) return classifyIpv4(text)
  if (!net.isIPv6(text)) return 'public' // not an address (callers pass resolved addresses)
  const h = ipv6Hextets(text)
  if (!h) return 'unspecified' // unparseable literal: fail closed
  if (METADATA_IPV6.some((m) => m.every((x, i) => x === h[i]))) return 'metadata'
  const allZeroUntil = (i: number) => h.slice(0, i).every((x) => x === 0)
  if (allZeroUntil(8)) return 'unspecified' // ::
  if (allZeroUntil(7) && h[7] === 1) return 'loopback' // ::1
  if ((h[0] & 0xffc0) === 0xfe80) return 'link_local' // fe80::/10
  if ((h[0] & 0xfe00) === 0xfc00) return 'private' // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfec0) return 'private' // fec0::/10 site-local (deprecated)
  const v4 = embeddedIpv4(h)
  return v4 ? classifyIpv4(v4) : 'public'
}

function isMetadataName(host: string): boolean {
  const lower = host.toLowerCase().replace(/\.$/, '')
  return METADATA_HOSTS.has(lower) || (net.isIP(lower) !== 0 && classifyAddress(lower) === 'metadata')
}

function isInternalName(lower: string): boolean {
  return lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')
}

/**
 * One address `host` resolved to → how it is allowed, or the reason it is
 * blocked. `hostListed`: the hostname matches EGRESS_PRIVATE_ALLOW.
 */
function decideAddress(address: string, policy: EgressPolicy, hostListed: boolean): { ok: true; via: EgressCheck['private'] } | { ok: false; reason: string } {
  const cls = classifyAddress(address)
  if (cls === 'metadata') return { ok: false, reason: 'cloud metadata endpoints are blocked' }
  if (cls === 'public') return { ok: true, via: null }
  // Loopback / link-local / unspecified: only a CIDR entry that covers them.
  const cidrListed = addressInRules(address, policy.privateAllow)
  if (cls === 'private' && (hostListed || cidrListed)) return { ok: true, via: 'allowlist' }
  if (cls !== 'private' && cidrListed) return { ok: true, via: 'allowlist' }
  // ALLOW_PRIVATE_EGRESS (back-compat): every private range except IPv4 link-local.
  if (policy.allowAllPrivate && !(cls === 'link_local' && net.isIPv4(address))) return { ok: true, via: 'allow_all' }
  const what = cls === 'private' ? 'a private address' : cls === 'loopback' ? 'a loopback address' : cls === 'link_local' ? 'a link-local address' : 'an unspecified address'
  const extra = cls !== 'private' && hostListed && policy.mode !== 'cloud' ? ' (a hostname entry does not cover loopback / link-local addresses: list the address as a CIDR)' : ''
  return { ok: false, reason: `${what} (${address}) is blocked${extra}; ${privateAllowHint(policy)}` }
}

function merge(a: EgressCheck['private'], b: EgressCheck['private']): EgressCheck['private'] {
  if (a === 'allowlist' || b === 'allowlist') return 'allowlist'
  return a ?? b
}

/**
 * Throws EgressBlockedError when `host` (hostname or IP literal) points at a
 * blocked address. DNS names are resolved and every returned address checked,
 * so `my-rebind.attacker.com → 127.0.0.1` is caught too.
 */
export async function assertSafeEgressHost(host: string): Promise<EgressCheck> {
  const target = String(host ?? '').trim().replace(/^\[|\]$/g, '') // strip ipv6 brackets
  if (!target) throw new EgressBlockedError(host, 'empty host')

  if (isMetadataName(target)) {
    throw new EgressBlockedError(target, 'cloud metadata endpoints are blocked')
  }

  const policy = await loadEgressPolicy()
  const hostListed = hostMatchesRules(target, policy.privateAllow)

  if (net.isIP(target)) {
    const verdict = decideAddress(target, policy, false)
    if (!verdict.ok) throw new EgressBlockedError(target, verdict.reason)
    return { private: verdict.via }
  }

  const lower = target.toLowerCase().replace(/\.$/, '')
  const internal = isInternalName(lower)
  // Internal names (localhost, .local, .internal) are refused by name unless
  // listed, ALLOW_PRIVATE_EGRESS is on, or a CIDR entry could cover their
  // addresses (no slow mDNS lookups for names that can't be allowed anyway).
  if (internal && !hostListed && !policy.allowAllPrivate && !policy.privateAllow.some((r) => r.kind === 'cidr')) {
    throw new EgressBlockedError(target, `internal hostnames are blocked; ${privateAllowHint(policy)}`)
  }

  // DNS name — resolve all addresses and check each.
  let addresses: { address: string }[]
  try {
    addresses = await lookup(target, { all: true })
  } catch {
    // Unresolvable names can't be reached anyway; let the caller's connection
    // attempt produce the natural error. Internal names stay blocked unless
    // listed (or ALLOW_PRIVATE_EGRESS).
    if (internal && !hostListed && !policy.allowAllPrivate) {
      throw new EgressBlockedError(target, `internal hostnames are blocked; ${privateAllowHint(policy)}`)
    }
    return { private: null }
  }
  let via: EgressCheck['private'] = null
  for (const { address } of addresses) {
    const verdict = decideAddress(address, policy, hostListed)
    if (!verdict.ok) {
      throw new EgressBlockedError(target, verdict.reason.startsWith('cloud') ? verdict.reason : `resolves to ${verdict.reason}`)
    }
    via = merge(via, verdict.via)
  }
  // An internal name (.local, .internal, localhost) that resolves to public
  // addresses is still an internal name: allowed only when listed.
  if (internal && via === null && !hostListed && !policy.allowAllPrivate) {
    throw new EgressBlockedError(target, `internal hostnames are blocked; ${privateAllowHint(policy)}`)
  }
  return { private: via }
}

/**
 * Check one address a DNS lookup returned for `host`, at connect time. Used by
 * transports that dial sockets themselves (lib/integrations/windows-auth), so
 * the address actually connected to obeys the same rules as
 * assertSafeEgressHost (no DNS-rebinding window between check and connect).
 * Synchronous: uses the policy loaded by the preceding assertSafeEgress* call.
 */
export function assertSafeResolvedAddress(host: string, address: string): void {
  const policy = getEgressPolicy()
  const verdict = decideAddress(address, policy, hostMatchesRules(host, policy.privateAllow))
  if (!verdict.ok) {
    throw new EgressBlockedError(host, verdict.reason.startsWith('cloud') ? verdict.reason : `resolves to ${verdict.reason}`)
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * Plain http:// rule for connector base URLs: HTTPS is required except for
 * loopback and, self-hosted, targets in EGRESS_HTTP_ALLOW (a hostname entry,
 * or a CIDR containing the IP literal or every address the name resolves
 * to). Throws EgressBlockedError naming the setting to change.
 */
export async function assertHttpAllowed(rawUrl: string): Promise<void> {
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new EgressBlockedError(rawUrl, 'invalid URL') }
  if (url.protocol !== 'http:') return
  if (LOOPBACK_HOSTS.has(url.hostname)) return
  const policy = await loadEgressPolicy()
  const problem = `plain http:// is not allowed for ${url.hostname}; ${httpAllowHint(policy)}`
  if (policy.mode === 'cloud') throw new EgressBlockedError(url.origin, problem)
  if (httpAllowedForHost(url.hostname, policy)) return
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!net.isIP(host) && hasCidrRules(policy.httpAllow)) {
    const addresses = await lookup(host, { all: true }).catch(() => [])
    if (addresses.length && addresses.every(({ address }) => addressInRules(address, policy.httpAllow))) return
  }
  throw new EgressBlockedError(url.origin, problem)
}

/**
 * Synchronous form of the http:// rule for validators that can't resolve DNS:
 * null when allowed (or when only a CIDR match after resolution could allow
 * it — assertHttpAllowed decides that), else the error message.
 */
export function httpUrlProblem(url: URL, policy: EgressPolicy = getEgressPolicy()): string | null {
  if (url.protocol !== 'http:' || LOOPBACK_HOSTS.has(url.hostname)) return null
  if (policy.mode !== 'cloud') {
    if (httpAllowedForHost(url.hostname, policy)) return null
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) === 0 && hasCidrRules(policy.httpAllow)) return null
  }
  return `plain http:// is not allowed for ${url.hostname}; ${httpAllowHint(policy)}`
}

/** URL variant: validates protocol (http/https only) and the hostname. */
export async function assertSafeEgressUrl(rawUrl: string): Promise<EgressCheck> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new EgressBlockedError(rawUrl, 'invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EgressBlockedError(rawUrl, `protocol ${url.protocol} is not allowed`)
  }
  return assertSafeEgressHost(url.hostname)
}

export interface SafeFetchOptions {
  /** Hostnames allowed (exact, or `*.example.com` for subdomains). Empty / absent = any public host. */
  allowedHosts?: readonly string[]
  /** Redirect hops followed (each re-checked). Default 3. */
  maxRedirects?: number
  fetchImpl?: typeof fetch
}

/** Does `host` match an allowlist entry (`example.com`, `*.example.com`)? */
export function hostAllowed(host: string, allowedHosts: readonly string[] | undefined): boolean {
  if (!allowedHosts || allowedHosts.length === 0) return true
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  return allowedHosts.some((entry) => {
    const e = entry.trim().toLowerCase()
    if (!e) return false
    if (e.startsWith('*.')) return h === e.slice(2) || h.endsWith(e.slice(1))
    return h === e
  })
}

/**
 * fetch() for URLs that untrusted input chose (agent tools: the model picks
 * the URL). Every hop is checked by assertSafeEgressUrl (and the optional
 * host allowlist) — redirects are followed manually so a public URL cannot
 * bounce the request to a private or metadata address.
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}, options: SafeFetchOptions = {}): Promise<Response> {
  const doFetch = options.fetchImpl ?? fetch
  const maxRedirects = options.maxRedirects ?? 3
  let current = rawUrl
  let currentInit: RequestInit = { ...init, redirect: 'manual' }
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertSafeEgressUrl(current)
    const host = new URL(current).hostname
    if (!hostAllowed(host, options.allowedHosts)) {
      throw new EgressBlockedError(host, 'not in this agent\'s allowed hosts')
    }
    const res = await doFetch(current, currentInit)
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {})
      current = new URL(location, current).toString()
      // 303 (and 301/302 after POST, as browsers do) continue as GET without a body.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && String(currentInit.method ?? 'GET').toUpperCase() === 'POST')) {
        const { body: _body, ...rest } = currentInit
        currentInit = { ...rest, method: 'GET' }
      }
      continue
    }
    return res
  }
  throw new EgressBlockedError(rawUrl, 'too many redirects')
}

/**
 * Best-effort host extraction from a DB connection string (postgres://…,
 * mongodb+srv://…, Server=…;Database=…). Returns null when no host can be
 * determined (e.g. Oracle TNS descriptors) — callers should then rely on the
 * driver-level timeout rather than failing closed on legacy formats.
 */
export function extractDbHost(connectionString: string): string | null {
  const raw = String(connectionString ?? '').trim()
  if (!raw) return null
  // URL-style (postgres://, mysql://, mongodb://, mongodb+srv://, …)
  const urlish = raw.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)
  if (urlish) {
    try {
      const u = new URL(raw.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*)\+srv:\/\//, '$1://'))
      return u.hostname || null
    } catch {
      return null
    }
  }
  // Key=value style (Server=host,1433;Database=…)
  const kv = raw.match(/(?:^|;)\s*(?:server|host|data source|address)\s*=\s*([^;,]+)/i)
  if (kv) return kv[1].trim().replace(/^tcp:/i, '')
  return null
}
