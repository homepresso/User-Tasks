/**
 * `auth_type: windows` connection settings: shape, defaults and validation.
 * Pure and client-safe (the integration forms import it).
 *
 * auth_config = {
 *   mode:      'negotiate' (Kerberos, NTLM fallback; default) | 'ntlm' | 'kerberos',
 *   username:  'DOMAIN\\user' or a UPN 'user@corp.example.com',
 *   password:  encrypted at rest (a sensitive key), write-only in the API/UI,
 *   spn?:      'HTTP/host' override for Kerberos (default HTTP/<base_url host>),
 *   ca_bundle?: PEM certificates trusted in addition to the public roots,
 *   proxy_url?: 'http://proxy:port' (a CONNECT tunnel; also egress-guarded),
 * }
 */

export const WINDOWS_AUTH_MODES = ['negotiate', 'ntlm', 'kerberos'] as const
export type WindowsAuthMode = (typeof WINDOWS_AUTH_MODES)[number]

export const WINDOWS_AUTH_MODE_LABELS: Record<WindowsAuthMode, string> = {
  negotiate: 'Negotiate (Kerberos, falling back to NTLM)',
  ntlm: 'NTLM only (NTLMv2)',
  kerberos: 'Kerberos only',
}

export interface WindowsAuthConfig {
  mode: WindowsAuthMode
  username: string
  password: string
  spn: string | null
  ca_bundle: string | null
  proxy_url: string | null
}

export const MAX_CA_BUNDLE_BYTES = 256 * 1024

const PEM_CERT_RE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g

/** The PEM certificate blocks in a bundle (other PEM blocks, e.g. keys, are rejected by validation). */
export function pemCertificates(bundle: string): string[] {
  return bundle.match(PEM_CERT_RE) ?? []
}

/**
 * Validate and normalise a windows auth_config. Returns the cleaned config or
 * a list of problems (messages are safe to show: they never echo secrets).
 * Run it after '__SECRET__' placeholders are resolved (an update that keeps
 * the stored password then carries its ciphertext, which counts as set).
 */
export function validateWindowsAuthConfig(raw: unknown): { ok: true; config: WindowsAuthConfig } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const cfg = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

  const mode = (str(cfg.mode) || 'negotiate') as WindowsAuthMode
  if (!WINDOWS_AUTH_MODES.includes(mode)) errors.push('auth_config.mode must be negotiate, ntlm or kerberos')

  const username = str(cfg.username)
  if (!username) errors.push('auth_config.username is required (DOMAIN\\user or user@domain)')
  else if (username.length > 256 || /[\r\n\0]/.test(username)) errors.push('auth_config.username is not valid')
  else if (/^\\|\\$/.test(username) || (username.match(/\\/g) ?? []).length > 1) errors.push('auth_config.username must be DOMAIN\\user or user@domain')

  const password = typeof cfg.password === 'string' ? cfg.password : ''
  if (!password && mode !== 'kerberos') errors.push('auth_config.password is required for NTLM')

  const spn = str(cfg.spn) || null
  if (spn && !/^[A-Za-z][A-Za-z0-9-]*[/@][^\s/@]+(:\d+)?(@[^\s]+)?$/.test(spn)) errors.push('auth_config.spn must look like HTTP/host.example.com')

  let caBundle = str(cfg.ca_bundle) || null
  if (caBundle) {
    if (caBundle.length > MAX_CA_BUNDLE_BYTES) errors.push('auth_config.ca_bundle is larger than 256 KB')
    if (/PRIVATE KEY-----/.test(caBundle)) errors.push('auth_config.ca_bundle must contain certificates only, never a private key')
    const certs = pemCertificates(caBundle)
    if (certs.length === 0) errors.push('auth_config.ca_bundle has no PEM certificates (-----BEGIN CERTIFICATE-----)')
    else caBundle = certs.join('\n')
  }

  const proxyUrl = str(cfg.proxy_url) || null
  if (proxyUrl) {
    let parsed: URL | null = null
    try { parsed = new URL(proxyUrl) } catch { /* reported below */ }
    if (!parsed || parsed.protocol !== 'http:') errors.push('auth_config.proxy_url must be an http:// proxy URL (the tunnel itself carries TLS)')
    else if (parsed.username || parsed.password) errors.push('auth_config.proxy_url cannot contain credentials')
    else if (parsed.pathname !== '/' || parsed.search || parsed.hash) errors.push('auth_config.proxy_url must be just http://host:port')
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, config: { mode, username, password, spn, ca_bundle: caBundle, proxy_url: proxyUrl } }
}

/**
 * Kerberos client principal for a username: a UPN maps to user@REALM (realm
 * upper-cased). DOMAIN\user gives null (the NetBIOS domain is usually not the
 * realm): GSSAPI then uses the default principal of the cache / keytab.
 */
export function kerberosPrincipal(username: string): string | null {
  const value = username.trim()
  const at = value.lastIndexOf('@')
  if (at > 0 && !value.includes('\\')) return `${value.slice(0, at)}@${value.slice(at + 1).toUpperCase()}`
  return null
}
