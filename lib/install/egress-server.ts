import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { assertSafeEgressHost, EgressBlockedError } from '@/lib/egress-guard'
import { EGRESS_PRIVATE_ALLOW_SETTING, getEgressPolicy, normaliseEgressList } from '@/lib/egress-policy'

/**
 * The egress guard for the setup wizard's and Settings → Infrastructure's
 * "Test" buttons (server only). A blocked host comes back with the
 * allowlist entry that would allow it (a hostname, or a /32 for a
 * loopback / link-local address, which a hostname entry doesn't cover), so
 * the page can offer "Allow this host" instead of a dead end. Cloud
 * metadata endpoints are never allowable; the cloud edition has no
 * allowlist.
 */

export type HostCheck = { ok: true } | { ok: false; host: string; reason: string; allowEntry: string | null }

function cidrFor(address: string): string {
  return net.isIPv6(address) ? `${address}/128` : `${address}/32`
}

function isLoopbackOrLinkLocal(address: string): boolean {
  if (net.isIPv4(address)) return address.startsWith('127.') || address.startsWith('169.254.') || address.startsWith('0.')
  const a = address.toLowerCase()
  return a === '::1' || a.startsWith('fe80:') || a === '::'
}

async function allowEntryFor(host: string, reason: string): Promise<string | null> {
  if (getEgressPolicy().mode === 'cloud' || /metadata/i.test(reason)) return null
  const bare = host.replace(/^\[|\]$/g, '')
  // The address the guard refused (a name can resolve to several, e.g. localhost → 127.0.0.1 and ::1).
  const refused = /\(([0-9a-f:.]+)\) is blocked/i.exec(reason)?.[1]
  if (refused && net.isIP(refused)) return isLoopbackOrLinkLocal(refused) ? cidrFor(refused) : net.isIP(bare) ? refused : bare.toLowerCase()
  if (net.isIP(bare)) return isLoopbackOrLinkLocal(bare) ? cidrFor(bare) : bare
  try {
    const addresses = await lookup(bare, { all: true })
    const special = addresses.find((a) => isLoopbackOrLinkLocal(a.address))
    if (special) return cidrFor(special.address)
  } catch {
    // Unresolvable: the hostname entry is the best suggestion.
  }
  return bare.toLowerCase()
}

/** Check every host; the first blocked one is returned with its allowlist suggestion. */
export async function checkHostsAllowed(hosts: string[]): Promise<HostCheck> {
  for (const host of hosts) {
    try {
      await assertSafeEgressHost(host)
    } catch (error) {
      if (!(error instanceof EgressBlockedError)) throw error
      return { ok: false, host, reason: error.message, allowEntry: await allowEntryFor(host, error.message) }
    }
  }
  return { ok: true }
}

/** Plain-language refusal with the remedy. */
export function blockedMessage(check: Extract<HostCheck, { ok: false }>): string {
  return `${check.host} is not reachable from tests on this page: ${check.reason.replace(/^Connection to \S+ is not allowed: /, '')}${check.allowEntry ? ` To allow it, use "Allow ${check.allowEntry}" or run usertasks-admin egress allow-private ${check.allowEntry}.` : ''}`
}

/** The private-network allowlist with `entry` added (normalised, as instance.egress_private_allow stores it). */
export function withAllowEntry(current: unknown, entry: string): string[] {
  const list = Array.isArray(current) ? current.map(String) : []
  return normaliseEgressList([...list, entry])
}

export { EGRESS_PRIVATE_ALLOW_SETTING }
