import net from 'node:net'
import { readSettingsCacheStale } from '@/lib/config/settings-cache'

/**
 * On-premises egress policy (self-hosted only): which private-network targets
 * connectors may reach, and which hosts may be called over plain http://.
 *
 *   EGRESS_PRIVATE_ALLOW / instance.egress_private_allow
 *     Hostnames (`spsites`, `*.contoso.local`) and CIDRs (`10.0.0.0/8`,
 *     `fd00:1234::/32`, a bare address = /32 or /128). A private target is
 *     allowed when its hostname matches, or when the resolved address is
 *     inside an allowed CIDR. Loopback, link-local and unspecified addresses
 *     need a CIDR entry that covers them (a hostname match is not enough);
 *     cloud metadata addresses are blocked whatever is listed.
 *   EGRESS_HTTP_ALLOW / instance.egress_http_allow
 *     Same syntax: targets a connector base URL may use over http:// (HTTPS
 *     is required otherwise, loopback excepted).
 *
 * The environment wins over the instance setting (as for every instance
 * setting). In the cloud edition (DEPLOYMENT_MODE=cloud) both lists are
 * ignored. ALLOW_PRIVATE_EGRESS=true (opens every private range, metadata
 * still blocked) keeps working for back-compat.
 *
 * getEgressPolicy() is synchronous (connect-time DNS checks run inside
 * socket lookups): it reads the environment and the last loaded instance
 * settings (lib/config/settings-cache). loadEgressPolicy() refreshes the
 * settings first; the egress guard awaits it before every check, so the
 * synchronous read that follows at connect time sees current values.
 *
 * Server-only (node:net).
 */

export const EGRESS_PRIVATE_ALLOW_ENV = 'EGRESS_PRIVATE_ALLOW'
export const EGRESS_HTTP_ALLOW_ENV = 'EGRESS_HTTP_ALLOW'
export const EGRESS_PRIVATE_ALLOW_SETTING = 'instance.egress_private_allow'
export const EGRESS_HTTP_ALLOW_SETTING = 'instance.egress_http_allow'
export const ALLOW_PRIVATE_EGRESS_ENV = 'ALLOW_PRIVATE_EGRESS'

export type EgressRule =
  | { kind: 'host'; value: string; text: string }
  | { kind: 'suffix'; value: string; text: string }
  | { kind: 'cidr'; family: 4 | 6; bits: number[]; prefix: number; text: string }

export type EgressListSource = 'env' | 'setting' | 'none'

export interface EgressPolicy {
  mode: 'cloud' | 'self_hosted'
  /** ALLOW_PRIVATE_EGRESS=true: every private range (metadata still blocked). */
  allowAllPrivate: boolean
  /** Effective lists ([] in the cloud edition). */
  privateAllow: EgressRule[]
  httpAllow: EgressRule[]
  /** Where each list came from (before the cloud edition empties it). */
  privateSource: EgressListSource
  httpSource: EgressListSource
  /** Entries that didn't parse (ignored), for display. */
  invalid: string[]
}

/* ── Addresses ─────────────────────────────────────────────────────── */

export function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

export function inCidr4(ip: number, base: string, maskBits: number): boolean {
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0
  return (ip & mask) === (ipv4ToInt(base) & mask)
}

/** Expand an IPv6 literal to its 8 hextets (embedded dotted IPv4 converted); null when malformed. */
export function ipv6Hextets(ip: string): number[] | null {
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

/** An address as bits: IPv4-mapped IPv6 (::ffff:a.b.c.d) is treated as the IPv4 address. */
function addressBits(ip: string): { family: 4 | 6; bits: number[] } | null {
  const text = ip.replace(/^\[|\]$/g, '')
  if (net.isIPv4(text)) return { family: 4, bits: text.split('.').map(Number) }
  if (!net.isIPv6(text)) return null
  const h = ipv6Hextets(text)
  if (!h) return null
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return { family: 4, bits: [h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff] }
  }
  return { family: 6, bits: h.flatMap((x) => [x >> 8, x & 0xff]) }
}

function bitsMatch(a: number[], b: number[], prefix: number): boolean {
  let left = prefix
  for (let i = 0; i < a.length && left > 0; i++, left -= 8) {
    const mask = left >= 8 ? 0xff : (0xff << (8 - left)) & 0xff
    if ((a[i] & mask) !== (b[i] & mask)) return false
  }
  return true
}

/* ── Rules ─────────────────────────────────────────────────────────── */

const HOST_LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/

function validHostname(host: string): boolean {
  return host.length > 0 && host.length <= 253 && host.split('.').every((label) => HOST_LABEL.test(label))
}

/** One entry → a rule, or an error message. */
export function parseEgressRule(raw: string): EgressRule | string {
  const text = raw.trim().toLowerCase()
  if (!text) return 'empty entry'
  const slash = text.indexOf('/')
  const addrText = (slash === -1 ? text : text.slice(0, slash)).replace(/^\[|\]$/g, '')
  if (net.isIP(addrText)) {
    const parsed = addressBits(addrText)
    if (!parsed) return `"${raw.trim()}" is not a valid address`
    const max = parsed.family === 4 ? 32 : 128
    // An IPv4-mapped IPv6 CIDR is stored as its IPv4 form.
    const mappedShift = net.isIPv6(addrText) && parsed.family === 4 ? 96 : 0
    const prefixText = slash === -1 ? String(max + mappedShift) : text.slice(slash + 1)
    if (!/^\d{1,3}$/.test(prefixText)) return `"${raw.trim()}": the prefix length must be a number`
    const prefix = Number(prefixText) - mappedShift
    if (prefix < 0 || prefix > max) return `"${raw.trim()}": the prefix length must be from 0 to ${max}`
    if (prefix < 8) return `"${raw.trim()}" is too broad (use ALLOW_PRIVATE_EGRESS=true to open every private range)`
    return { kind: 'cidr', family: parsed.family, bits: parsed.bits, prefix, text }
  }
  if (slash !== -1) return `"${raw.trim()}" is not a valid CIDR`
  if (text.startsWith('*.')) {
    const suffix = text.slice(2)
    if (!validHostname(suffix) || !suffix.includes('.')) return `"${raw.trim()}": a wildcard needs a domain with a dot (e.g. *.contoso.local)`
    return { kind: 'suffix', value: suffix, text }
  }
  if (text.includes('*')) return `"${raw.trim()}": wildcards are only allowed as a leading "*." (e.g. *.contoso.local)`
  const host = text.replace(/\.$/, '')
  if (!validHostname(host)) return `"${raw.trim()}" is not a valid hostname, wildcard or CIDR`
  return { kind: 'host', value: host, text }
}

/** A comma / whitespace separated list (env) or an array (setting) → entries. */
export function egressListEntries(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.flatMap((v) => egressListEntries(v))
  if (typeof raw !== 'string') return []
  return raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
}

export function parseEgressList(raw: unknown): { rules: EgressRule[]; errors: string[] } {
  const rules: EgressRule[] = []
  const errors: string[] = []
  for (const entry of egressListEntries(raw)) {
    const parsed = parseEgressRule(entry)
    if (typeof parsed === 'string') errors.push(parsed)
    else if (!rules.some((r) => r.text === parsed.text)) rules.push(parsed)
  }
  return { rules, errors }
}

/** Normalised list for storing as an instance setting; throws listing every bad entry. */
export function normaliseEgressList(raw: unknown): string[] {
  const { rules, errors } = parseEgressList(raw)
  if (errors.length) throw new Error(errors.join('; '))
  return rules.map((r) => r.text)
}

export function hostMatchesRules(host: string, rules: readonly EgressRule[]): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  return rules.some((rule) =>
    rule.kind === 'host' ? h === rule.value
      : rule.kind === 'suffix' ? h.endsWith(`.${rule.value}`)
        : false)
}

export function addressInRules(address: string, rules: readonly EgressRule[]): boolean {
  const parsed = addressBits(address)
  if (!parsed) return false
  return rules.some((rule) => rule.kind === 'cidr' && rule.family === parsed.family && bitsMatch(parsed.bits, rule.bits, rule.prefix))
}

/* ── The policy ────────────────────────────────────────────────────── */

function pickList(env: string | undefined, setting: unknown): { raw: unknown; source: EgressListSource } {
  if (env !== undefined && env.trim() !== '') return { raw: env, source: 'env' }
  if (egressListEntries(setting).length) return { raw: setting, source: 'setting' }
  return { raw: [], source: 'none' }
}

/**
 * The policy from an environment and stored settings (pure; tests and the
 * admin CLI call it directly).
 */
export function resolveEgressPolicy(env: Record<string, string | undefined>, settings: Map<string, unknown> | null): EgressPolicy {
  const mode = env.DEPLOYMENT_MODE?.trim().toLowerCase() === 'cloud' ? 'cloud' : 'self_hosted'
  const priv = pickList(env[EGRESS_PRIVATE_ALLOW_ENV], settings?.get(EGRESS_PRIVATE_ALLOW_SETTING))
  const http = pickList(env[EGRESS_HTTP_ALLOW_ENV], settings?.get(EGRESS_HTTP_ALLOW_SETTING))
  const p = parseEgressList(priv.raw)
  const h = parseEgressList(http.raw)
  const cloud = mode === 'cloud'
  return {
    mode,
    allowAllPrivate: env[ALLOW_PRIVATE_EGRESS_ENV] === 'true',
    privateAllow: cloud ? [] : p.rules,
    httpAllow: cloud ? [] : h.rules,
    privateSource: priv.source,
    httpSource: http.source,
    invalid: [...p.errors, ...h.errors],
  }
}

/** Synchronous: environment + the last loaded instance settings. */
export function getEgressPolicy(): EgressPolicy {
  return resolveEgressPolicy(process.env, readSettingsCacheStale())
}

/** Refresh the instance settings (cached, short TTL), then the policy. Never throws. */
export async function loadEgressPolicy(): Promise<EgressPolicy> {
  if (process.env.DEPLOYMENT_MODE?.trim().toLowerCase() !== 'cloud') {
    try {
      const { loadInstanceSettings } = await import('@/lib/config/instance-settings')
      await loadInstanceSettings()
    } catch {
      // Settings unavailable: environment and defaults, like every other setting.
    }
  }
  return getEgressPolicy()
}

/**
 * Whether plain http:// to `host` is allowed by EGRESS_HTTP_ALLOW without a
 * DNS lookup: a hostname rule, or an IP literal inside a CIDR rule. Hosts
 * that could only match by resolving into a CIDR need assertHttpAllowed.
 */
export function httpAllowedForHost(host: string, policy: EgressPolicy = getEgressPolicy()): boolean {
  if (policy.mode === 'cloud') return false
  const h = host.replace(/^\[|\]$/g, '')
  return hostMatchesRules(h, policy.httpAllow) || (net.isIP(h) !== 0 && addressInRules(h, policy.httpAllow))
}

export function hasCidrRules(rules: readonly EgressRule[]): boolean {
  return rules.some((r) => r.kind === 'cidr')
}

/** Which setting to change, for error messages. */
export function privateAllowHint(policy: EgressPolicy): string {
  if (policy.mode === 'cloud') return 'private networks cannot be reached from the cloud edition'
  return `add the host or its network to ${EGRESS_PRIVATE_ALLOW_ENV} (or the instance setting ${EGRESS_PRIVATE_ALLOW_SETTING}, e.g. \`usertasks-admin egress allow-private <host|CIDR>\`)`
}

export function httpAllowHint(policy: EgressPolicy): string {
  if (policy.mode === 'cloud') return 'use https://'
  return `use https:// (recommended, an internal CA can be added on the connection), or add the host to ${EGRESS_HTTP_ALLOW_ENV} (or ${EGRESS_HTTP_ALLOW_SETTING}, e.g. \`usertasks-admin egress allow-http <host>\`)`
}

export function describeRules(rules: readonly EgressRule[]): string {
  return rules.length ? rules.map((r) => r.text).join(', ') : '(none)'
}

/** Validation hook for instance_settings writes: the egress lists must be normalised string arrays. */
export function validateEgressSetting(key: string, value: unknown): void {
  if (key !== EGRESS_PRIVATE_ALLOW_SETTING && key !== EGRESS_HTTP_ALLOW_SETTING) return
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new Error(`${key} must be a list of hostnames, *.domain wildcards and CIDRs`)
  }
  let normalised: string[]
  try {
    normalised = normaliseEgressList(value)
  } catch (error) {
    throw new Error(`${key}: ${(error as Error).message}`)
  }
  if (JSON.stringify(normalised) !== JSON.stringify(value)) throw new Error(`${key}: store ${JSON.stringify(normalised)}, not ${JSON.stringify(value)}`)
}

/** Display summary (Settings → Infrastructure, usertasks-admin egress show). */
export interface EgressPolicySummary {
  mode: 'cloud' | 'self_hosted'
  allowAllPrivate: boolean
  privateAllow: string[]
  httpAllow: string[]
  privateSource: EgressListSource
  httpSource: EgressListSource
  /** Listed but ignored (cloud edition). */
  ignoredInCloud: boolean
  invalid: string[]
}

export function summariseEgressPolicy(policy: EgressPolicy, raw?: { privateAllow: string[]; httpAllow: string[] }): EgressPolicySummary {
  return {
    mode: policy.mode,
    allowAllPrivate: policy.allowAllPrivate,
    privateAllow: raw?.privateAllow ?? policy.privateAllow.map((r) => r.text),
    httpAllow: raw?.httpAllow ?? policy.httpAllow.map((r) => r.text),
    privateSource: policy.privateSource,
    httpSource: policy.httpSource,
    ignoredInCloud: policy.mode === 'cloud' && (policy.privateSource !== 'none' || policy.httpSource !== 'none'),
    invalid: policy.invalid,
  }
}
