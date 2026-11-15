/**
 * The gateway's egress policy, in place of the server's lib/egress-guard
 * (swapped in at build time, tsup.config.ts) for core's Windows transport:
 * on the customer's network the only hosts the gateway may dial are the
 * targets (and their proxies) in its own configuration. Everything else is
 * refused before a socket opens — the gateway is never a general proxy into
 * the network, whatever the cloud asks.
 *
 * Resolved addresses of an allowed name are accepted (the customer named
 * the host; private and loopback addresses are normal on-premises) except
 * link-local / cloud metadata addresses.
 */

export class EgressBlockedError extends Error {
  constructor(target: string, reason: string) {
    super(`Connection to ${target} is not allowed: ${reason}`)
    this.name = 'EgressBlockedError'
  }
}

const allowed = new Set<string>()

/** Replace the allowlist (lower-case host names / IP literals). */
export function setGatewayEgressAllowlist(hosts: Iterable<string>): void {
  allowed.clear()
  for (const h of hosts) allowed.add(normalise(h))
}

export function gatewayEgressAllowlist(): string[] {
  return [...allowed]
}

function normalise(host: string): string {
  return String(host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

export interface EgressCheck { private: false | 'allowlist' }

export async function assertSafeEgressHost(host: string): Promise<EgressCheck> {
  const name = normalise(host)
  if (!name || !allowed.has(name)) throw new EgressBlockedError(host, 'not a target in this gateway\'s configuration')
  return { private: 'allowlist' }
}

const METADATA_V4 = /^169\.254\./
const METADATA_V6 = /^(fe80:|::ffff:169\.254\.)/i

export function assertSafeResolvedAddress(host: string, address: string): void {
  const name = normalise(host)
  if (!allowed.has(name)) throw new EgressBlockedError(host, 'not a target in this gateway\'s configuration')
  const addr = String(address ?? '').toLowerCase()
  if (METADATA_V4.test(addr) || METADATA_V6.test(addr) || addr === '0.0.0.0' || addr === '::') {
    throw new EgressBlockedError(host, `resolves to a link-local / unspecified address (${addr})`)
  }
}

/** Not used by the gateway (present for the transport's imports). */
export async function assertSafeEgressUrl(url: string): Promise<EgressCheck> {
  return assertSafeEgressHost(new URL(url).hostname)
}
