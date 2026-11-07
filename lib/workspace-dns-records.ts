/**
 * Workspace addresses: the DNS records an instance admin creates so that
 * `<workspace>.<base domain>` reaches the app (Settings → Workspace DNS).
 * Pure and dependency-free (the page's client component imports it); every
 * value is computed from the configured base domain.
 *
 *  - Cloud on Vercel: Vercel serves the app and issues the wildcard
 *    certificate through a DNS-01 challenge, which needs either Vercel's
 *    nameservers (recommended, Vercel's documented route for wildcards) or
 *    the `_acme-challenge` name delegated to them.
 *  - Self-hosted: a wildcard record next to the apex record, pointing at the
 *    same load balancer.
 */

export type DnsProvider = 'godaddy' | 'vercel' | 'cloudflare' | 'route53' | 'other' | 'unknown'

/** Where the app runs: Vercel (the cloud edition) or the operator's own infrastructure. */
export type DnsHosting = 'vercel' | 'self_hosted'

/** The DNS host tabs on the page. */
export type DnsHostTab = 'godaddy' | 'cloudflare' | 'other'

/** Vercel setup route: switch nameservers to Vercel (A) or keep the current DNS host and add records (B). */
export type VercelRoute = 'nameservers' | 'records'

export const VERCEL_NAMESERVERS = ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'] as const
export const VERCEL_CNAME_TARGET = 'cname.vercel-dns.com'

export const DNS_PROVIDER_LABELS: Record<DnsProvider, string> = {
  godaddy: 'GoDaddy',
  vercel: 'Vercel DNS',
  cloudflare: 'Cloudflare',
  route53: 'Amazon Route 53',
  other: 'Another DNS provider',
  unknown: 'Unknown',
}

export interface DnsRecord {
  type: 'A' | 'AAAA' | 'CNAME' | 'NS' | 'TXT'
  /** The name as the DNS host's form wants it: relative to the zone (`*`, `_acme-challenge`), `@` for the zone apex. */
  host: string
  /** The fully qualified name, for providers that want it and for clarity. */
  fqdn: string
  value: string
  /** Seconds; GoDaddy's "1 Hour" default is 3600. */
  ttl: number
  note?: string
}

/** Which DNS host the nameservers belong to (GoDaddy domaincontrol.com, vercel-dns.com, Cloudflare, Route 53). */
export function detectDnsProvider(nameservers: readonly string[]): DnsProvider {
  const ns = nameservers.map((n) => n.toLowerCase().replace(/\.$/, ''))
  if (ns.length === 0) return 'unknown'
  const any = (re: RegExp) => ns.some((n) => re.test(n))
  if (any(/(^|\.)domaincontrol\.com$/)) return 'godaddy'
  if (any(/(^|\.)vercel-dns\.com$/)) return 'vercel'
  if (any(/(^|\.)ns\.cloudflare\.com$/)) return 'cloudflare'
  if (any(/^ns-\d+\.awsdns-\d+\.(com|net|org|co\.uk)$/)) return 'route53'
  return 'other'
}

/** The DNS host tab to open first for a detected provider (GoDaddy is the default). */
export function defaultDnsHostTab(provider: DnsProvider): DnsHostTab {
  if (provider === 'cloudflare') return 'cloudflare'
  if (provider === 'route53' || provider === 'other') return 'other'
  return 'godaddy'
}

/**
 * `fqdn` relative to `zone` (`*.tasks.example.com` in `example.com` → `*.tasks`,
 * the zone itself → `@`). Without a known zone, relative to the base domain.
 */
export function relativeHost(fqdn: string, zone: string): string {
  if (fqdn === zone) return '@'
  return fqdn.endsWith(`.${zone}`) ? fqdn.slice(0, -(zone.length + 1)) : fqdn
}

/** The zone a record lives in: the detected zone when the base domain is in it, else the base domain. */
function zoneFor(baseDomain: string, zone?: string | null): string {
  return zone && (baseDomain === zone || baseDomain.endsWith(`.${zone}`)) ? zone : baseDomain
}

function record(type: DnsRecord['type'], fqdn: string, zone: string, value: string, ttl: number, note?: string): DnsRecord {
  return { type, host: relativeHost(fqdn, zone), fqdn, value, ttl, ...(note ? { note } : {}) }
}

export interface RecordOptions {
  baseDomain: string
  /** The DNS zone the base domain is in (where its nameservers were found), e.g. `example.com` for `tasks.example.com`. */
  zone?: string | null
  /** Self-hosted only: what the apex resolves to, reused for the wildcard (else placeholders). */
  apexAddresses?: { v4?: readonly string[]; v6?: readonly string[] }
}

/** Option A (switch nameservers): the nameservers to enter at the registrar. */
export function vercelNameserverRecords(options: RecordOptions): DnsRecord[] {
  const zone = zoneFor(options.baseDomain, options.zone)
  return VERCEL_NAMESERVERS.map((ns) => record('NS', zone, zone, ns, 3600, 'Entered as the domain\'s nameservers at the registrar, not as DNS records.'))
}

/**
 * Option B (keep the current DNS host): the wildcard CNAME to Vercel, and the
 * `_acme-challenge` delegation so Vercel can answer the DNS-01 challenge for
 * the wildcard certificate.
 */
export function vercelDnsRecords(options: RecordOptions, tab: DnsHostTab = 'godaddy'): DnsRecord[] {
  const base = options.baseDomain
  const zone = zoneFor(base, options.zone)
  const cnameNote = tab === 'cloudflare' ? 'Proxy status: DNS only (grey cloud). A proxied record hides Vercel and breaks the certificate.' : undefined
  return [
    record('CNAME', `*.${base}`, zone, VERCEL_CNAME_TARGET, 3600, cnameNote),
    ...VERCEL_NAMESERVERS.map((ns) => record('NS', `_acme-challenge.${base}`, zone, ns, 3600, 'Delegates the certificate challenge to Vercel.')),
  ]
}

/** Self-hosted: the wildcard next to the apex, at the same addresses (placeholders when the apex doesn't resolve). */
export function selfHostedRecords(options: RecordOptions): DnsRecord[] {
  const base = options.baseDomain
  const zone = zoneFor(base, options.zone)
  const v4 = options.apexAddresses?.v4 ?? []
  const v6 = options.apexAddresses?.v6 ?? []
  if (v4.length === 0 && v6.length === 0) {
    return [
      record('A', `*.${base}`, zone, '<load balancer IPv4 address>', 3600, 'Or a CNAME to the load balancer\'s hostname. Use the same target as the apex.'),
      record('CNAME', `*.${base}`, zone, '<load balancer hostname>', 3600, 'Instead of the A record, when the load balancer has a hostname.'),
    ]
  }
  return [
    ...v4.map((ip) => record('A', `*.${base}`, zone, ip, 3600, `Same address as ${base}.`)),
    ...v6.map((ip) => record('AAAA', `*.${base}`, zone, ip, 3600, `Same address as ${base}.`)),
  ]
}

/** The records for the chosen environment, DNS host and route. */
export function dnsRecordsFor(hosting: DnsHosting, options: RecordOptions, tab: DnsHostTab = 'godaddy', route: VercelRoute = 'nameservers'): DnsRecord[] {
  if (hosting === 'self_hosted') return selfHostedRecords(options)
  return route === 'nameservers' ? vercelNameserverRecords(options) : vercelDnsRecords(options, tab)
}

/** Where the app runs, from the environment: Vercel for the cloud edition or when VERCEL is set. */
export function dnsHostingFrom(env: { deploymentMode?: string | null; vercel?: string | null }): DnsHosting {
  return env.deploymentMode === 'cloud' || Boolean(env.vercel) ? 'vercel' : 'self_hosted'
}

/** A record as a tab-separated line (copy all). */
export function recordLine(r: DnsRecord): string {
  return [r.type, r.host, r.value, String(r.ttl)].join('\t')
}
