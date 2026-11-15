/**
 * gateway.json — the customer's configuration. Everything the gateway may
 * reach is listed here; the cloud can only name these targets by id.
 *
 * {
 *   "cloudUrl": "https://acme.usertasks.com",          (https only)
 *   "instanceName": "SPGW-01",                         (default: host name)
 *   "stateDir": "C:\\ProgramData\\UserTasks Gateway",  (key + registration; default per platform)
 *   "cloudCaFile": "corp-proxy-ca.pem",                (extra CA for the cloud, e.g. TLS inspection)
 *   "cloudProxy": "http://proxy.contoso.com:8080",     (outbound CONNECT proxy to the cloud)
 *   "maxConcurrent": 16,
 *   "maxRequestBytes": 52428800, "maxResponseBytes": 52428800,
 *   "keyRotationDays": 90,                             (0 = never rotate automatically)
 *   "targets": [{
 *     "id": "sharepoint",                              (what UserTasks connections name)
 *     "url": "https://sharepoint.contoso.com",         (origin; nothing outside it is reachable)
 *     "auth": { "type": "windows", "mode": "negotiate", "username": "CONTOSO\\svc-usertasks",
 *               "passwordEnv": "UTGW_SHAREPOINT_PASSWORD" | "passwordFile": "C:\\…\\sp.pwd", "spn": "HTTP/…" }
 *             | { "type": "none" },
 *     "caFile": "contoso-root.pem", "proxy": "http://…",
 *     "forwardAuthorization": false,                   (let the cloud's own Authorization header through —
 *                                                       needed for SharePoint high-trust add-in tokens)
 *     "methods": ["GET", "POST", …],                   (default: all job methods)
 *     "pathPrefixes": ["/sites/finance/"],             (default: "/")
 *     "timeoutMs": 120000
 *   }],
 *   "relay": {                                         (inbound callbacks, e.g. SharePoint remote event receivers)
 *     "listen": "0.0.0.0:8443",
 *     "tls": { "certFile": "gw.pem", "keyFile": "gw.key" } | null,
 *     "allowHttp": false,                              (plain http only on a trusted LAN segment)
 *     "publicUrl": "https://utgw.contoso.com:8443",    (what SharePoint should call; behind a load balancer for HA)
 *     "pathPrefixes": ["/ext-public/sharepoint/"],
 *     "allowSources": ["10.20.0.0/16"],                (client addresses allowed to call the relay; default any)
 *     "maxBodyBytes": 1048576
 *   }
 * }
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON (configuration) */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { JOB_METHODS, MAX_RELAY_BODY_BYTES, MAX_REQUEST_BODY_BYTES, MAX_RESPONSE_BODY_BYTES, MAX_TARGETS, TARGET_ID_RE, normaliseOrigin, type JobMethod } from '../../../lib/gateway/protocol'

export interface WindowsTargetAuth {
  type: 'windows'
  mode: 'negotiate' | 'ntlm' | 'kerberos'
  username: string
  password: string
  spn: string | null
}

export interface TargetConfig {
  id: string
  origin: string
  auth: WindowsTargetAuth | { type: 'none' }
  caBundle: string | null
  proxy: string | null
  forwardAuthorization: boolean
  methods: Set<JobMethod>
  pathPrefixes: string[]
  timeoutMs: number
}

export interface RelayConfig {
  host: string
  port: number
  tls: { cert: string; key: string } | null
  publicUrl: string
  pathPrefixes: string[]
  allowSources: Array<{ net: string; bits: number; family: 4 | 6 }>
  maxBodyBytes: number
}

export interface GatewayConfig {
  file: string
  cloudUrl: string
  instanceName: string
  stateDir: string
  cloudCa: string | null
  cloudProxy: string | null
  maxConcurrent: number
  maxRequestBytes: number
  maxResponseBytes: number
  keyRotationDays: number
  targets: TargetConfig[]
  relay: RelayConfig | null
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export function defaultStateDir(): string {
  if (process.platform === 'win32') return path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'UserTasks Gateway')
  return process.env.UTGW_STATE_DIR ?? '/var/lib/usertasks-gateway'
}

export function defaultConfigFile(): string {
  if (process.env.UTGW_CONFIG) return process.env.UTGW_CONFIG
  if (process.platform === 'win32') return path.join(defaultStateDir(), 'gateway.json')
  return '/etc/usertasks-gateway/gateway.json'
}

function readText(file: string, base: string, what: string): string {
  const resolved = path.isAbsolute(file) ? file : path.resolve(base, file)
  try { return fs.readFileSync(resolved, 'utf8') } catch (error) { throw new ConfigError(`${what}: cannot read ${resolved} (${(error as Error).message})`) }
}

function pemCerts(text: string, what: string): string {
  if (/PRIVATE KEY-----/.test(text)) throw new ConfigError(`${what} must contain certificates only`)
  const certs = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []
  if (!certs.length) throw new ConfigError(`${what} has no PEM certificates`)
  return certs.join('\n')
}

function parseProxy(value: unknown, what: string): string | null {
  if (value === undefined || value === null || value === '') return null
  let url: URL
  try { url = new URL(String(value)) } catch { throw new ConfigError(`${what} must be http://host:port`) }
  if (url.protocol !== 'http:' || url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) throw new ConfigError(`${what} must be http://host:port (no credentials, no path)`)
  return `http://${url.host}`
}

function parseCidr(raw: string): { net: string; bits: number; family: 4 | 6 } {
  const [addr, bitsRaw] = String(raw).trim().split('/')
  const family = net.isIP(addr)
  if (family !== 4 && family !== 6) throw new ConfigError(`relay.allowSources: "${raw}" is not an address or CIDR`)
  const max = family === 4 ? 32 : 128
  const bits = bitsRaw === undefined ? max : Number(bitsRaw)
  if (!Number.isInteger(bits) || bits < 0 || bits > max) throw new ConfigError(`relay.allowSources: "${raw}" has an invalid prefix length`)
  return { net: addr, bits, family: family as 4 | 6 }
}

function readSecret(auth: Record<string, unknown>, base: string, what: string): string {
  if (typeof auth.passwordEnv === 'string' && auth.passwordEnv) {
    const value = process.env[auth.passwordEnv]
    if (!value) throw new ConfigError(`${what}: environment variable ${auth.passwordEnv} is not set`)
    return value
  }
  if (typeof auth.passwordFile === 'string' && auth.passwordFile) return readText(auth.passwordFile, base, what).replace(/\r?\n$/, '')
  if (typeof auth.password === 'string') throw new ConfigError(`${what}: do not put the password in gateway.json; use passwordEnv or passwordFile`)
  return ''
}

export function parseConfig(raw: unknown, file: string): GatewayConfig {
  const base = path.dirname(file)
  const c = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, any>
  const cloud = normaliseOrigin(String(c.cloudUrl ?? ''))
  if (!cloud) throw new ConfigError('cloudUrl must be the UserTasks address (https://<workspace>.usertasks.com)')
  const cloudUrl = String(c.cloudUrl).replace(/\/+$/, '')
  const loopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(cloud)
  if (!cloud.startsWith('https://') && !(loopback && process.env.UTGW_ALLOW_INSECURE_LOOPBACK === '1')) throw new ConfigError('cloudUrl must use https://')

  const targets: TargetConfig[] = []
  const targetList = Array.isArray(c.targets) ? c.targets : []
  if (targetList.length > MAX_TARGETS) throw new ConfigError(`At most ${MAX_TARGETS} targets`)
  for (const [i, t] of targetList.entries()) {
    const what = `targets[${i}]`
    const id = String(t?.id ?? '')
    if (!TARGET_ID_RE.test(id)) throw new ConfigError(`${what}.id must be lower-case letters, digits and hyphens (start with a letter, ≤ 40)`)
    if (targets.some((x) => x.id === id)) throw new ConfigError(`${what}.id "${id}" is used twice`)
    const origin = normaliseOrigin(String(t?.url ?? ''))
    if (!origin) throw new ConfigError(`${what}.url must be an http(s) origin such as https://sharepoint.contoso.com`)
    const parsedUrl = new URL(String(t.url))
    if (parsedUrl.pathname !== '/' && parsedUrl.pathname !== '') throw new ConfigError(`${what}.url must be an origin (no path); restrict paths with pathPrefixes`)
    const a = (t?.auth ?? { type: 'none' }) as Record<string, unknown>
    let auth: TargetConfig['auth']
    if (a.type === 'windows') {
      const mode = (String(a.mode ?? 'negotiate')) as WindowsTargetAuth['mode']
      if (!['negotiate', 'ntlm', 'kerberos'].includes(mode)) throw new ConfigError(`${what}.auth.mode must be negotiate, ntlm or kerberos`)
      const username = String(a.username ?? '').trim()
      if (!username) throw new ConfigError(`${what}.auth.username is required (DOMAIN\\user or user@domain)`)
      const password = readSecret(a, base, `${what}.auth`)
      if (!password && mode !== 'kerberos') throw new ConfigError(`${what}.auth needs passwordEnv or passwordFile for ${mode}`)
      auth = { type: 'windows', mode, username, password, spn: typeof a.spn === 'string' && a.spn ? a.spn : null }
    } else if (a.type === 'none' || a.type === undefined) {
      auth = { type: 'none' }
    } else {
      throw new ConfigError(`${what}.auth.type must be windows or none`)
    }
    const methods = new Set<JobMethod>()
    for (const m of Array.isArray(t.methods) ? t.methods : JOB_METHODS) {
      const up = String(m).toUpperCase()
      if (!(JOB_METHODS as readonly string[]).includes(up)) throw new ConfigError(`${what}.methods: ${m} is not supported`)
      methods.add(up as JobMethod)
    }
    const pathPrefixes = (Array.isArray(t.pathPrefixes) && t.pathPrefixes.length ? t.pathPrefixes : ['/']).map((p: unknown) => {
      const s = String(p)
      if (!s.startsWith('/') || /[\\\s]/.test(s)) throw new ConfigError(`${what}.pathPrefixes: "${s}" must start with /`)
      return s.toLowerCase()
    })
    targets.push({
      id,
      origin,
      auth,
      caBundle: t.caFile ? pemCerts(readText(String(t.caFile), base, `${what}.caFile`), `${what}.caFile`) : null,
      proxy: parseProxy(t.proxy, `${what}.proxy`),
      forwardAuthorization: t.forwardAuthorization === true,
      methods,
      pathPrefixes,
      timeoutMs: Math.max(1000, Math.min(300_000, Number(t.timeoutMs) || 120_000)),
    })
  }
  if (!targets.length) throw new ConfigError('Configure at least one target (targets[])')

  let relay: RelayConfig | null = null
  if (c.relay && c.relay.enabled !== false) {
    const r = c.relay as Record<string, any>
    const listen = String(r.listen ?? '0.0.0.0:8443')
    const m = /^(.*):(\d{1,5})$/.exec(listen)
    if (!m) throw new ConfigError('relay.listen must be host:port')
    const tls = r.tls ? { cert: readText(String(r.tls.certFile), base, 'relay.tls.certFile'), key: readText(String(r.tls.keyFile), base, 'relay.tls.keyFile') } : null
    if (!tls && r.allowHttp !== true) throw new ConfigError('relay: configure tls (certFile / keyFile), or set allowHttp: true for a trusted LAN segment')
    const publicUrl = String(r.publicUrl ?? '').replace(/\/+$/, '')
    if (!normaliseOrigin(publicUrl)) throw new ConfigError('relay.publicUrl must be the http(s) address other systems call (e.g. https://utgw.contoso.com:8443)')
    const prefixes = (Array.isArray(r.pathPrefixes) && r.pathPrefixes.length ? r.pathPrefixes : ['/ext-public/']).map((p: unknown) => {
      const s = String(p)
      if (!s.startsWith('/ext-public/')) throw new ConfigError('relay.pathPrefixes must start with /ext-public/')
      return s
    })
    relay = {
      host: m[1].replace(/^\[|\]$/g, '') || '0.0.0.0',
      port: Number(m[2]),
      tls,
      publicUrl,
      pathPrefixes: prefixes,
      allowSources: (Array.isArray(r.allowSources) ? r.allowSources : []).map((s: unknown) => parseCidr(String(s))),
      maxBodyBytes: Math.max(1024, Math.min(MAX_RELAY_BODY_BYTES, Number(r.maxBodyBytes) || 1024 * 1024)),
    }
  }

  return {
    file,
    cloudUrl,
    instanceName: String(c.instanceName ?? os.hostname()).slice(0, 200),
    stateDir: c.stateDir ? path.resolve(base, String(c.stateDir)) : defaultStateDir(),
    cloudCa: c.cloudCaFile ? pemCerts(readText(String(c.cloudCaFile), base, 'cloudCaFile'), 'cloudCaFile') : null,
    cloudProxy: parseProxy(c.cloudProxy, 'cloudProxy'),
    maxConcurrent: Math.max(1, Math.min(64, Number(c.maxConcurrent) || 16)),
    maxRequestBytes: Math.max(1024, Math.min(MAX_REQUEST_BODY_BYTES, Number(c.maxRequestBytes) || 50 * 1024 * 1024)),
    maxResponseBytes: Math.max(1024, Math.min(MAX_RESPONSE_BODY_BYTES, Number(c.maxResponseBytes) || 50 * 1024 * 1024)),
    keyRotationDays: Math.max(0, Math.min(3650, c.keyRotationDays === undefined ? 90 : Number(c.keyRotationDays) || 0)),
    targets,
    relay,
  }
}

export function loadConfig(file: string): GatewayConfig {
  let raw: unknown
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) { throw new ConfigError(`Cannot read ${file}: ${(error as Error).message}`) }
  return parseConfig(raw, file)
}

/** Is `address` inside one of the CIDRs (empty list = any)? */
export function sourceAllowed(address: string, list: RelayConfig['allowSources']): boolean {
  if (!list.length) return true
  const addr = address.replace(/^::ffff:/i, '')
  const fam = net.isIP(addr)
  for (const c of list) {
    if (c.family !== fam) continue
    const block = new net.BlockList()
    block.addSubnet(c.net, c.bits, c.family === 4 ? 'ipv4' : 'ipv6')
    if (block.check(addr, fam === 4 ? 'ipv4' : 'ipv6')) return true
  }
  return false
}
