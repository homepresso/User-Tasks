import { promises as dnsPromises } from 'node:dns'
import * as tls from 'node:tls'
import { randomBytes } from 'node:crypto'
import { baseDomainFromEnv } from '@/lib/workspace-address'
import { configuredAppUrl, getBootstrapConfig } from '@/lib/config/bootstrap'
import { DNS_PROVIDER_LABELS, VERCEL_NAMESERVERS, detectDnsProvider, dnsHostingFrom, type DnsHosting, type DnsProvider } from '@/lib/workspace-dns-records'

/**
 * Workspace addresses: live DNS / TLS / HTTP checks for Settings → Workspace
 * DNS (server only, instance admins only).
 *
 * SSRF: every hostname checked is derived from the configured base domain
 * (APP_BASE_DOMAIN / the APP_URL host): the base itself, `_acme-challenge.`
 * and `ut-check-<random>.` in front of it. Nothing comes from the request.
 *
 * Every check has a short timeout and turns every error into a failed (or
 * warning) result with its message — nothing here throws. Results are cached
 * per process for a minute; "Check again" bypasses the cache.
 */

export type DnsCheckStatus = 'pass' | 'warn' | 'fail' | 'skip'

export interface DnsCheck {
  id: 'config' | 'wildcard' | 'apex' | 'nameservers' | 'acme' | 'tls' | 'http'
  label: string
  status: DnsCheckStatus
  /** One line: what was found, or what went wrong. */
  detail: string
  /** What the name resolves to / the certificate / the status, for display. */
  values?: string[]
}

export interface WorkspaceDnsReport {
  enabled: boolean
  baseDomain: string | null
  hosting: DnsHosting
  /** The random name the wildcard checks used (`ut-check-1a2b3c4d.<base>`). */
  probeHost: string | null
  /** The zone the nameservers were found at (the base domain or a parent). */
  zone: string | null
  nameservers: string[]
  provider: DnsProvider
  apexAddresses: { v4: string[]; v6: string[] }
  checks: DnsCheck[]
  checkedAt: string
}

export interface DnsCheckDeps {
  resolve4(host: string): Promise<string[]>
  resolve6(host: string): Promise<string[]>
  resolveCname(host: string): Promise<string[]>
  resolveNs(host: string): Promise<string[]>
  /** TLS handshake with SNI; resolves with what the peer presented (never rejects on an invalid certificate). */
  tlsProbe(host: string, port: number, timeoutMs: number): Promise<TlsProbeResult>
  fetch: typeof fetch
  randomLabel(): string
}

export interface TlsProbeResult {
  authorized: boolean
  authorizationError?: string
  subject?: string
  issuer?: string
  validTo?: string
  altNames?: string
}

export const DNS_TIMEOUT_MS = 4000
export const TLS_TIMEOUT_MS = 4000
export const HTTP_TIMEOUT_MS = 5000
export const REPORT_TTL_MS = 60_000

/** Rejects after `ms` with "timed out after Ns". */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function message(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code
    const msg = (error as { message?: unknown }).message
    if (code === 'ENOTFOUND' || code === 'ENODATA') return `no record (${code})`
    if (typeof msg === 'string' && msg) return msg
    if (typeof code === 'string') return code
  }
  return String(error)
}

function defaultTlsProbe(host: string, port: number, timeoutMs: number): Promise<TlsProbeResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs })
    const done = (fn: () => void) => { if (settled) return; settled = true; fn(); socket.destroy() }
    socket.once('secureConnect', () => done(() => {
      const cert = socket.getPeerCertificate()
      const name = (part: unknown) => {
        const p = part as Record<string, string | string[] | undefined> | undefined
        const v = p?.O ?? p?.CN
        return Array.isArray(v) ? v.join(', ') : v
      }
      resolve({
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : undefined,
        subject: name(cert?.subject),
        issuer: name(cert?.issuer),
        validTo: cert?.valid_to,
        altNames: cert?.subjectaltname,
      })
    }))
    socket.once('timeout', () => done(() => reject(new Error(`TLS handshake timed out after ${Math.round(timeoutMs / 1000)} s`))))
    socket.once('error', (error) => done(() => reject(error)))
  })
}

export const defaultDnsCheckDeps: DnsCheckDeps = {
  resolve4: (h) => dnsPromises.resolve4(h),
  resolve6: (h) => dnsPromises.resolve6(h),
  resolveCname: (h) => dnsPromises.resolveCname(h),
  resolveNs: (h) => dnsPromises.resolveNs(h),
  tlsProbe: defaultTlsProbe,
  fetch: (...args) => fetch(...args),
  randomLabel: () => `ut-check-${randomBytes(4).toString('hex')}`,
}

/** The addresses a name resolves to (A, then AAAA), with its CNAME when it has one. */
async function resolveHost(deps: DnsCheckDeps, host: string): Promise<{ cname: string[]; v4: string[]; v6: string[] }> {
  const settle = <T>(p: Promise<T>) => withTimeout(p, DNS_TIMEOUT_MS, `DNS lookup of ${host}`).then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e }))
  const [cname, v4, v6] = await Promise.all([settle(deps.resolveCname(host)), settle(deps.resolve4(host)), settle(deps.resolve6(host))])
  if (!v4.ok && !v6.ok) throw v4.e
  return { cname: cname.ok ? cname.v : [], v4: v4.ok ? v4.v : [], v6: v6.ok ? v6.v : [] }
}

/** The nameservers of the base domain, walking up to the parent zone (tasks.example.com → example.com). */
async function findNameservers(deps: DnsCheckDeps, baseDomain: string): Promise<{ zone: string; nameservers: string[] } | { error: string }> {
  const labels = baseDomain.split('.')
  let lastError = 'no NS records'
  for (let i = 0; i <= labels.length - 2; i++) {
    const zone = labels.slice(i).join('.')
    try {
      const ns = await withTimeout(deps.resolveNs(zone), DNS_TIMEOUT_MS, `NS lookup of ${zone}`)
      if (ns.length) return { zone, nameservers: ns.map((n) => n.toLowerCase().replace(/\.$/, '')).sort() }
    } catch (error) {
      lastError = message(error)
    }
  }
  return { error: lastError }
}

function scheme(appUrl: string | null | undefined): { https: boolean; port: number; portSuffix: string } {
  try {
    const url = new URL(String(appUrl ?? ''))
    const https = url.protocol !== 'http:'
    return { https, port: url.port ? Number(url.port) : https ? 443 : 80, portSuffix: url.port ? `:${url.port}` : '' }
  } catch {
    return { https: true, port: 443, portSuffix: '' }
  }
}

const VERCEL_NS = new Set<string>(VERCEL_NAMESERVERS)

/** Whether `ns` are Vercel's nameservers. */
function isVercelNs(ns: readonly string[]): boolean {
  return ns.length > 0 && ns.every((n) => VERCEL_NS.has(n.toLowerCase().replace(/\.$/, '')) || /(^|\.)vercel-dns\.com\.?$/.test(n.toLowerCase()))
}

export interface CheckInput {
  baseDomain: string | null
  appUrl?: string | null
  hosting: DnsHosting
}

/** Run every check against the configured base domain. Never throws. */
export async function runWorkspaceDnsChecks(input: CheckInput, deps: DnsCheckDeps = defaultDnsCheckDeps): Promise<WorkspaceDnsReport> {
  const checkedAt = new Date().toISOString()
  const base = input.baseDomain
  const empty = { probeHost: null, zone: null, nameservers: [], provider: 'unknown' as DnsProvider, apexAddresses: { v4: [], v6: [] } }
  if (!base) {
    return {
      enabled: false, baseDomain: null, hosting: input.hosting, ...empty, checkedAt,
      checks: [{ id: 'config', label: 'Base domain', status: 'fail', detail: 'Workspace addresses are off: APP_BASE_DOMAIN is not set (or is "off"), so there is no base domain to check.' }],
    }
  }

  const config: DnsCheck = { id: 'config', label: 'Base domain', status: 'pass', detail: `Workspace addresses are on: <workspace>.${base}`, values: [base] }

  // Local development: browsers resolve *.localhost themselves; public DNS and certificates don't apply.
  if (!base.includes('.') || base === 'localhost' || base.endsWith('.localhost')) {
    return {
      enabled: true, baseDomain: base, hosting: input.hosting, ...empty, checkedAt,
      checks: [config, { id: 'wildcard', label: 'Wildcard DNS', status: 'skip', detail: `Local development: browsers resolve *.${base} to this machine, so there is nothing to set up. Open http://<workspace>.${base}${scheme(input.appUrl).portSuffix}.` }],
    }
  }

  let label: string
  try { label = deps.randomLabel() } catch { label = 'ut-check-probe' }
  if (!/^ut-check-[a-z0-9-]{1,30}$/.test(label)) label = 'ut-check-probe'
  const probeHost = `${label}.${base}`
  const { https, port, portSuffix } = scheme(input.appUrl)
  const checks: DnsCheck[] = [config]

  // Wildcard, apex and nameservers in parallel.
  const [wildcard, apex, ns] = await Promise.all([
    resolveHost(deps, probeHost).then((r) => ({ ok: true as const, r }), (e: unknown) => ({ ok: false as const, e })),
    resolveHost(deps, base).then((r) => ({ ok: true as const, r }), (e: unknown) => ({ ok: false as const, e })),
    findNameservers(deps, base),
  ])

  const shown = (r: { cname: string[]; v4: string[]; v6: string[] }) => [...r.cname.map((c) => `CNAME ${c}`), ...r.v4, ...r.v6]
  checks.push(wildcard.ok
    ? { id: 'wildcard', label: 'Wildcard DNS', status: 'pass', detail: `${probeHost} resolves, so every *.${base} name does.`, values: shown(wildcard.r) }
    : { id: 'wildcard', label: 'Wildcard DNS', status: 'fail', detail: `${probeHost} doesn't resolve: ${message(wildcard.e)}. Add the *.${base} record.` })
  checks.push(apex.ok
    ? { id: 'apex', label: 'Apex DNS', status: 'pass', detail: `${base} resolves.`, values: shown(apex.r) }
    : { id: 'apex', label: 'Apex DNS', status: 'fail', detail: `${base} doesn't resolve: ${message(apex.e)}.` })

  const nameservers = 'nameservers' in ns ? ns.nameservers : []
  const zone = 'zone' in ns ? ns.zone : null
  const provider = detectDnsProvider(nameservers)
  checks.push('nameservers' in ns
    ? { id: 'nameservers', label: 'Nameservers', status: 'pass', detail: `${zone} uses ${DNS_PROVIDER_LABELS[provider]}${provider === 'other' ? '' : ' nameservers'}.`, values: nameservers }
    : { id: 'nameservers', label: 'Nameservers', status: 'warn', detail: `Couldn't look up the nameservers of ${base}: ${ns.error}.` })

  // _acme-challenge delegation: only meaningful when Vercel issues the certificate without owning the zone.
  const acmeHost = `_acme-challenge.${base}`
  try {
    const acmeNs = (await withTimeout(deps.resolveNs(acmeHost), DNS_TIMEOUT_MS, `NS lookup of ${acmeHost}`)).map((n) => n.toLowerCase().replace(/\.$/, ''))
    checks.push({
      id: 'acme', label: '_acme-challenge delegation',
      status: acmeNs.length && (input.hosting === 'self_hosted' || isVercelNs(acmeNs)) ? 'pass' : 'warn',
      detail: isVercelNs(acmeNs) ? `${acmeHost} is delegated to Vercel.` : `${acmeHost} is delegated to ${acmeNs.join(', ') || 'nothing'}.`,
      values: acmeNs,
    })
  } catch (error) {
    const notNeeded = provider === 'vercel' || input.hosting === 'self_hosted'
    checks.push({
      id: 'acme', label: '_acme-challenge delegation', status: notNeeded ? 'skip' : 'warn',
      detail: provider === 'vercel'
        ? 'Not needed: the domain uses Vercel\'s nameservers, so Vercel answers the certificate challenge itself.'
        : input.hosting === 'self_hosted'
          ? 'Not delegated. That\'s fine when your certificate tooling has API access to the DNS zone.'
          : `No NS records for ${acmeHost} (${message(error)}). Without them, or Vercel nameservers, Vercel can't issue the wildcard certificate.`,
    })
  }

  // TLS and HTTP need the wildcard to resolve.
  if (!https) {
    checks.push({ id: 'tls', label: 'Wildcard certificate', status: 'skip', detail: 'The app URL is plain http, so there is no certificate to check.' })
  } else if (!wildcard.ok) {
    checks.push({ id: 'tls', label: 'Wildcard certificate', status: 'skip', detail: 'Skipped: the wildcard name doesn\'t resolve yet.' })
  } else {
    try {
      const cert = await withTimeout(deps.tlsProbe(probeHost, port, TLS_TIMEOUT_MS), TLS_TIMEOUT_MS + 500, `TLS handshake with ${probeHost}`)
      const values = [cert.subject && `Subject: ${cert.subject}`, cert.issuer && `Issuer: ${cert.issuer}`, cert.validTo && `Expires: ${cert.validTo}`, cert.altNames && `Names: ${cert.altNames}`].filter((v): v is string => Boolean(v))
      checks.push(cert.authorized
        ? { id: 'tls', label: 'Wildcard certificate', status: 'pass', detail: `The certificate is valid for ${probeHost}.`, values }
        : { id: 'tls', label: 'Wildcard certificate', status: 'fail', detail: `The certificate isn't valid for ${probeHost}: ${cert.authorizationError ?? 'not trusted'}.`, values })
    } catch (error) {
      checks.push({ id: 'tls', label: 'Wildcard certificate', status: 'fail', detail: `TLS connection to ${probeHost} failed: ${message(error)}.` })
    }
  }

  if (!wildcard.ok) {
    checks.push({ id: 'http', label: 'App answers', status: 'skip', detail: 'Skipped: the wildcard name doesn\'t resolve yet.' })
  } else {
    const url = `${https ? 'https' : 'http'}://${probeHost}${portSuffix}/`
    try {
      const res = await withTimeout(deps.fetch(url, { method: 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) }), HTTP_TIMEOUT_MS + 500, `Request to ${url}`)
      checks.push(httpCheck(res, url))
    } catch (error) {
      checks.push({ id: 'http', label: 'App answers', status: 'fail', detail: `Request to ${url} failed: ${message(error)}.` })
    }
  }

  return {
    enabled: true, baseDomain: base, hosting: input.hosting, probeHost, zone, nameservers, provider,
    apexAddresses: apex.ok ? { v4: apex.r.v4, v6: apex.r.v6 } : { v4: [], v6: [] },
    checks, checkedAt,
  }
}

/**
 * Whether the answer came from this app. The proxy (proxy.ts) sets a
 * Content-Security-Policy on every page response, and an unknown workspace
 * label answers 404 ("No workspace at this address"). Vercel's own errors
 * (no deployment for the domain) carry `x-vercel-error`.
 */
export function httpCheck(res: Pick<Response, 'status' | 'headers'>, url: string): DnsCheck {
  const status = res.status
  const vercelError = res.headers.get('x-vercel-error')
  const ours = Boolean(res.headers.get('content-security-policy'))
  if (vercelError) return { id: 'http', label: 'App answers', status: 'fail', detail: `Vercel answered ${status} ${vercelError}: *.${wildcardBase(url)} isn't added to the project (Settings → Domains).`, values: [`HTTP ${status}`] }
  if (status >= 500) return { id: 'http', label: 'App answers', status: 'fail', detail: `${url} answered ${status}.`, values: [`HTTP ${status}`] }
  const appStatus = (status >= 200 && status < 400) || status === 404
  if (appStatus && ours) return { id: 'http', label: 'App answers', status: 'pass', detail: `The app answered ${status} on ${url} (404 is expected: no workspace has this test name).`, values: [`HTTP ${status}`] }
  return { id: 'http', label: 'App answers', status: 'warn', detail: `Something answered ${status} on ${url}, but without the app's headers: check that the name points at the app.`, values: [`HTTP ${status}`] }
}

/** `ut-check-x.example.com` in a URL → `example.com`. */
function wildcardBase(url: string): string {
  try { return new URL(url).hostname.split('.').slice(1).join('.') } catch { return 'base' }
}

let cached: { key: string; at: number; report: WorkspaceDnsReport } | null = null

/** The checks for this instance's configured base domain, cached for a minute (`refresh` re-runs them). */
export async function getWorkspaceDnsReport(options: { refresh?: boolean } = {}, deps?: DnsCheckDeps): Promise<WorkspaceDnsReport> {
  const input: CheckInput = {
    baseDomain: baseDomainFromEnv(),
    appUrl: configuredAppUrl(),
    hosting: currentDnsHosting(),
  }
  const key = `${input.baseDomain}|${input.appUrl}|${input.hosting}`
  if (!options.refresh && cached && cached.key === key && Date.now() - cached.at < REPORT_TTL_MS) return cached.report
  const report = await runWorkspaceDnsChecks(input, deps)
  cached = { key, at: Date.now(), report }
  return report
}

/** Tests: forget the cached report. */
export function resetWorkspaceDnsCache(): void {
  cached = null
}

/** Where this instance runs (Vercel for the cloud edition or when VERCEL is set). */
export function currentDnsHosting(): DnsHosting {
  let mode: string | undefined
  try { mode = getBootstrapConfig().deploymentMode } catch { mode = process.env.DEPLOYMENT_MODE }
  return dnsHostingFrom({ deploymentMode: mode, vercel: process.env.VERCEL })
}
