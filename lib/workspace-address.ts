/**
 * Workspace addresses (`<subdomain>.<base domain>`): validation, the base
 * domain, host parsing and URL building. Pure and dependency-free so the
 * proxy, server code and client components can all import it.
 *
 *  - The base domain is APP_BASE_DOMAIN; without it, the cloud edition uses
 *    the host of APP_URL / NEXT_PUBLIC_APP_URL (`www.` / `app.` stripped) and
 *    a self-hosted install has no workspace subdomains at all.
 *    APP_BASE_DOMAIN=off turns them off everywhere.
 *  - The apex, `www.` and `app.` always behave as before; every other single
 *    label in front of the base domain is a workspace address.
 *  - Subdomains: lowercase a–z, 0–9 and hyphens, 3–40 characters, no
 *    leading, trailing or double hyphen, not a reserved name (the same list
 *    is in migration 20261223000000_workspace_subdomains.sql; a test keeps
 *    them equal).
 */

export const SUBDOMAIN_MIN = 3
export const SUBDOMAIN_MAX = 40

/** Names no workspace can take: our own hosts, auth / mail / infra conventions and app paths. */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  'about', 'account', 'accounts', 'admin', 'administrator', 'api', 'app', 'apps', 'assets', 'auth', 'autoconfig', 'autodiscover',
  'beta', 'billing', 'blog', 'cdn', 'cli', 'cloud', 'community', 'console', 'contact', 'dashboard', 'demo', 'dev', 'developer',
  'developers', 'dns', 'doc', 'docs', 'download', 'downloads', 'edge', 'email', 'events', 'files', 'form', 'forms', 'ftp',
  'gallery', 'git', 'health', 'help', 'imap', 'img', 'internal', 'legal', 'localhost', 'login', 'logout', 'mail', 'mcp', 'media',
  'metrics', 'mx', 'news', 'ns1', 'ns2', 'oauth', 'origin', 'pop', 'portal', 'preview', 'privacy', 'proxy', 'public', 'realtime',
  'root', 'saml', 'scim', 'sdk', 'security', 'signin', 'signup', 'smtp', 'sso', 'stage', 'staging', 'static', 'status', 'storage',
  'support', 'system', 'terms', 'test', 'usertasks', 'webhook', 'webhooks', 'webmail', 'wpad', 'www',
  // App path names (also invalid by length; listed so the rule reads clearly).
  'f', 'p', 'ws',
]

const RESERVED = new Set(RESERVED_SUBDOMAINS)

/** Hosts in front of the base domain that are the apex, not a workspace. */
export const APEX_ALIASES: readonly string[] = ['www', 'app']

const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/** Why `value` is not a valid subdomain, or null when it is (format and reserved names; availability is the server's). */
export function subdomainProblem(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return 'Enter an address.'
  if (value !== value.toLowerCase()) return 'Use lowercase letters only.'
  if (value.length < SUBDOMAIN_MIN) return `Use at least ${SUBDOMAIN_MIN} characters.`
  if (value.length > SUBDOMAIN_MAX) return `Use at most ${SUBDOMAIN_MAX} characters.`
  if (!SUBDOMAIN_RE.test(value)) {
    return /^-|-$/.test(value) ? 'It can\'t start or end with a hyphen.' : 'Use only letters a–z, numbers and hyphens.'
  }
  if (value.includes('--')) return 'It can\'t contain two hyphens in a row.'
  if (RESERVED.has(value)) return `"${value}" is reserved.`
  return null
}

export function isValidSubdomain(value: unknown): value is string {
  return subdomainProblem(value) === null
}

/** A subdomain suggested from a workspace name ("Acme Corp." → "acme-corp"), or '' when nothing usable is left. */
export function suggestSubdomain(name: string): string {
  let s = String(name ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SUBDOMAIN_MAX).replace(/-+$/g, '')
  if (s.length < SUBDOMAIN_MIN) s = s ? `${s}-team` : ''
  if (RESERVED.has(s)) s = `${s}-team`
  return isValidSubdomain(s) ? s : ''
}

/* ── Base domain and hosts ──────────────────────────────────────────── */

export interface AddressEnv {
  /** APP_BASE_DOMAIN (raw). */
  baseDomain?: string | null
  /** APP_URL / NEXT_PUBLIC_APP_URL. */
  appUrl?: string | null
  /** DEPLOYMENT_MODE is cloud. */
  cloud?: boolean
}

const OFF = new Set(['off', 'none', 'false', '0', 'disabled'])
const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/

function hostnameOf(url: string | null | undefined): string | null {
  try {
    return new URL(String(url ?? '').trim()).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/** The base domain workspace subdomains live under, or null when subdomains are off. */
export function resolveBaseDomain(env: AddressEnv): string | null {
  const raw = env.baseDomain?.trim().toLowerCase()
  if (raw !== undefined && raw !== '') {
    if (OFF.has(raw)) return null
    const host = raw.replace(/^https?:\/\//, '').replace(/[:/].*$/, '').replace(/^\.+|\.+$/g, '')
    return HOSTNAME_RE.test(host) ? host : null
  }
  if (!env.cloud) return null
  const appHost = hostnameOf(env.appUrl)
  if (!appHost || /^\d+\.\d+\.\d+\.\d+$/.test(appHost) || appHost.startsWith('[')) return null
  const labels = appHost.split('.')
  if (labels.length > 2 && APEX_ALIASES.includes(labels[0])) labels.shift()
  return labels.join('.')
}

/** The base domain from the process environment (server and proxy). */
export function baseDomainFromEnv(): string | null {
  // A dynamic key, read at runtime (never inlined at build time), like lib/config/bootstrap readEnv.
  const read = (name: string): string | undefined => (typeof process !== 'undefined' ? process.env[name] : undefined)
  return resolveBaseDomain({
    baseDomain: read('APP_BASE_DOMAIN'),
    appUrl: read('APP_URL') || read('NEXT_PUBLIC_APP_URL'),
    cloud: read('DEPLOYMENT_MODE')?.trim().toLowerCase() === 'cloud',
  })
}

export type HostKind =
  /** Subdomains are off, or the host is not under the base domain (a preview URL, a raw IP). */
  | { kind: 'none' }
  /** The base domain itself, or www. / app. */
  | { kind: 'apex' }
  /** `<label>.<base>`: a workspace address (it may not exist). */
  | { kind: 'workspace'; label: string }
  /** Under the base domain but not a possible workspace address (reserved, malformed, several labels deep). */
  | { kind: 'invalid' }

/** Strip the port (and IPv6 brackets) of a Host header value. */
export function hostnameOfHost(host: string | null | undefined): string {
  const h = String(host ?? '').trim().toLowerCase()
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1)
  return h.replace(/:\d+$/, '').replace(/\.$/, '')
}

/** Classify a request's Host against the base domain. */
export function classifyHost(host: string | null | undefined, baseDomain: string | null): HostKind {
  if (!baseDomain) return { kind: 'none' }
  const name = hostnameOfHost(host)
  if (!name) return { kind: 'none' }
  if (name === baseDomain) return { kind: 'apex' }
  if (!name.endsWith(`.${baseDomain}`)) return { kind: 'none' }
  const label = name.slice(0, -(baseDomain.length + 1))
  if (APEX_ALIASES.includes(label)) return { kind: 'apex' }
  if (label.includes('.') || !isValidSubdomain(label)) return { kind: 'invalid' }
  return { kind: 'workspace', label }
}

/** Whether a host is the base domain or one of its subdomains (cookie Domain scoping). */
export function isUnderBaseDomain(host: string | null | undefined, baseDomain: string | null): boolean {
  if (!baseDomain) return false
  const name = hostnameOfHost(host)
  return name === baseDomain || name.endsWith(`.${baseDomain}`)
}

/**
 * Whether a session cookie can be shared across the base domain's subdomains:
 * the base domain has a dot (browsers refuse `Domain=localhost`-style
 * single-label domains for subdomains) and cookies are Secure.
 */
export function canShareCookies(baseDomain: string | null, secure: boolean): boolean {
  return Boolean(baseDomain && baseDomain.includes('.') && secure)
}

/* ── URLs ────────────────────────────────────────────────────────────── */

/** Scheme and port of the configured app URL (http://localhost:3100 → http, :3100). */
function schemeAndPort(appUrl: string | null | undefined): { protocol: string; port: string } {
  try {
    const url = new URL(String(appUrl ?? '').trim())
    return { protocol: url.protocol, port: url.port ? `:${url.port}` : '' }
  } catch {
    return { protocol: 'https:', port: '' }
  }
}

/** `https://<subdomain>.<base>` (scheme and port follow the app URL). */
export function workspaceOrigin(subdomain: string, baseDomain: string, appUrl?: string | null): string {
  const { protocol, port } = schemeAndPort(appUrl)
  return `${protocol}//${subdomain}.${baseDomain}${port}`
}

/** The apex origin: the app URL's origin when it is under the base domain, else `https://<base>`. */
export function apexOrigin(baseDomain: string, appUrl?: string | null): string {
  try {
    const url = new URL(String(appUrl ?? '').trim())
    if (isUnderBaseDomain(url.host, baseDomain)) return url.origin
  } catch { /* fall through */ }
  const { protocol, port } = schemeAndPort(appUrl)
  return `${protocol}//${baseDomain}${port}`
}

/**
 * The path-only hop that returns a signed-in user from the apex to a
 * workspace address: `/ws/<subdomain><path>`. Auth flows only ever carry
 * same-origin paths (lib/safe-redirect), so the return target stays a path
 * until /ws/ turns it into `https://<subdomain>.<base><path>` — a host the
 * label can only ever name under our own base domain.
 */
export const WORKSPACE_HOP_PREFIX = '/ws/'

export function workspaceHopPath(subdomain: string, path: string): string {
  const safe = safeLocalPath(path) ?? '/'
  return `${WORKSPACE_HOP_PREFIX}${subdomain}${safe === '/' ? '' : safe}`
}

/** A same-origin path (`/x?y`), or null for anything that could leave the origin. */
export function safeLocalPath(raw: string | null | undefined): string | null {
  const p = String(raw ?? '').trim()
  if (!p) return null
  if (!/^\/(?![/\\])/.test(p)) return null
  if (/[\r\n\t\\]/.test(p) || p.includes('://')) return null
  return p
}

/** Parse a hop path back into { subdomain, path }, or null when it is not a valid hop. */
export function parseWorkspaceHop(pathname: string, search = ''): { subdomain: string; path: string } | null {
  if (!pathname.startsWith(WORKSPACE_HOP_PREFIX)) return null
  const rest = pathname.slice(WORKSPACE_HOP_PREFIX.length)
  const slash = rest.indexOf('/')
  const subdomain = slash === -1 ? rest : rest.slice(0, slash)
  if (!isValidSubdomain(subdomain)) return null
  const path = safeLocalPath((slash === -1 ? '/' : rest.slice(slash)) + (search && search !== '?' ? search : ''))
  return path ? { subdomain, path } : null
}

/* ── Proxy → server request headers ─────────────────────────────────── */

/**
 * Set by proxy.ts on every request (any client-sent value is dropped first):
 * the workspace label of the Host (`!` for a host under the base domain that
 * can't be a workspace), and the request's path + query for redirects made
 * by layouts.
 */
export const HOST_WORKSPACE_HEADER = 'x-ut-host-workspace'
export const REQUEST_PATH_HEADER = 'x-ut-request-path'
export const INVALID_HOST_MARK = '!'

/** The friendly URL of a form:`https://acme.usertasks.com/form/employee-onboarding`. */
export function friendlyFormUrl(origin: string, systemName: string): string {
  return `${origin.replace(/\/+$/, '')}/form/${encodeURIComponent(systemName)}`
}
