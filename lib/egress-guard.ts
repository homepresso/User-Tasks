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

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true
  // IPv4-mapped (::ffff:10.0.0.1)
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIpv4(mapped[1])
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
