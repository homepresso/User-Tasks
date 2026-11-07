import { lookup } from 'node:dns/promises'
import net from 'node:net'

/**
 * SSRF egress guard for user-supplied connection targets (integration base URLs,
 * DB hosts, connector probes). Blocks requests that would reach loopback,
 * link-local (cloud metadata), or private-range addresses — including via DNS
 * names that resolve there.
 *
 * Self-hosted deployments that legitimately connect to internal databases can
 * set ALLOW_PRIVATE_EGRESS=true to permit RFC1918/loopback targets; cloud
 * metadata endpoints stay blocked unconditionally.
 *
 * Server-only (uses node:dns) — do not import from client components.
 */

export class EgressBlockedError extends Error {
  constructor(target: string, reason: string) {
    super(`Connection to ${target} is not allowed: ${reason}`)
    this.name = 'EgressBlockedError'
  }
}

const METADATA_HOSTS = new Set([
  '169.254.169.254', // AWS/GCP/Azure IMDS
  'metadata.google.internal',
  'metadata.goog',
  'fd00:ec2::254', // AWS IMDSv6
])

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function inCidr4(ip: number, base: string, maskBits: number): boolean {
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0
  return (ip & mask) === (ipv4ToInt(base) & mask)
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip)
  return (
    inCidr4(n, '0.0.0.0', 8) ||
    inCidr4(n, '10.0.0.0', 8) ||
    inCidr4(n, '100.64.0.0', 10) || // CGNAT
    inCidr4(n, '127.0.0.0', 8) ||
    inCidr4(n, '169.254.0.0', 16) || // link-local (incl. metadata)
    inCidr4(n, '172.16.0.0', 12) ||
    inCidr4(n, '192.168.0.0', 16)
  )
}

/** Expand an IPv6 literal to its 8 hextets (embedded dotted IPv4 converted); null when malformed. */
function ipv6Hextets(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0]
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const n = ipv4ToInt(dotted[2])
    text = `${dotted[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  if (fill < 0) return null
  const parts = [...head, ...Array(fill).fill('0'), ...tail]
  if (parts.length !== 8) return null
  const out = parts.map((p) => parseInt(p, 16))
  return out.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? out : null
}

function isPrivateIpv6(ip: string): boolean {
  const h = ipv6Hextets(ip)
  if (!h) return true // unparseable literal: fail closed
  const allZeroUntil = (i: number) => h.slice(0, i).every((x) => x === 0)
  if (allZeroUntil(8)) return true // ::
  if (allZeroUntil(7) && h[7] === 1) return true // ::1
  if ((h[0] & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((h[0] & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfec0) return true // fec0::/10 site-local (deprecated)
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
  // IPv4-mapped ::ffff:a.b.c.d (also written ::ffff:7f00:1) and IPv4-compatible ::a.b.c.d
  if (allZeroUntil(5) && (h[5] === 0xffff || h[5] === 0)) return isPrivateIpv4(v4(h[6], h[7]))
  // NAT64 64:ff9b::/96
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return isPrivateIpv4(v4(h[6], h[7]))
  // 6to4 2002:AABB:CCDD::/48 embeds an IPv4 address
  if (h[0] === 0x2002) return isPrivateIpv4(v4(h[1], h[2]))
  return false
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip)
  if (net.isIPv6(ip)) return isPrivateIpv6(ip)
  return false
}

function isMetadataTarget(hostOrIp: string): boolean {
  const lower = hostOrIp.toLowerCase()
  if (METADATA_HOSTS.has(lower)) return true
  // 169.254.0.0/16 covers IMDS regardless of the exact address
  return net.isIPv4(lower) ? inCidr4(ipv4ToInt(lower), '169.254.0.0', 16) : false
}

function allowPrivateEgress(): boolean {
  return process.env.ALLOW_PRIVATE_EGRESS === 'true'
}

/**
 * Throws EgressBlockedError when `host` (hostname or IP literal) points at a
 * blocked address. DNS names are resolved and every returned address checked,
 * so `my-rebind.attacker.com → 127.0.0.1` is caught too.
 */
export async function assertSafeEgressHost(host: string): Promise<void> {
  const target = String(host ?? '').trim().replace(/^\[|\]$/g, '') // strip ipv6 brackets
  if (!target) throw new EgressBlockedError(host, 'empty host')

  if (isMetadataTarget(target)) {
    throw new EgressBlockedError(target, 'cloud metadata endpoints are blocked')
  }

  const lower = target.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) {
    if (!allowPrivateEgress()) throw new EgressBlockedError(target, 'internal hostnames are blocked')
    return
  }

  if (net.isIP(target)) {
    if (isPrivateIp(target) && !allowPrivateEgress()) {
      throw new EgressBlockedError(target, 'private/loopback addresses are blocked')
    }
    return
  }

  // DNS name — resolve all addresses and check each.
  let addresses: { address: string }[]
  try {
    addresses = await lookup(target, { all: true })
  } catch {
    // Unresolvable names can't be reached anyway; let the caller's connection
    // attempt produce the natural error.
    return
  }
  for (const { address } of addresses) {
    if (isMetadataTarget(address)) {
      throw new EgressBlockedError(target, 'cloud metadata endpoints are blocked')
    }
    if (isPrivateIp(address) && !allowPrivateEgress()) {
      throw new EgressBlockedError(target, `resolves to a private address (${address})`)
    }
  }
}

/** URL variant: validates protocol (http/https only) and the hostname. */
export async function assertSafeEgressUrl(rawUrl: string): Promise<void> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new EgressBlockedError(rawUrl, 'invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EgressBlockedError(rawUrl, `protocol ${url.protocol} is not allowed`)
  }
  await assertSafeEgressHost(url.hostname)
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
