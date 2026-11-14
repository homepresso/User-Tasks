/**
 * Windows integrated authentication transport (`auth_type: windows`): NTLMv2
 * and Negotiate (Kerberos via an optional GSSAPI provider, NTLM fallback) for
 * connector calls. Plugs into the connector transport hook
 * (lib/integrations/transports.ts) as the core `windows` kind, so it replaces
 * only the single fetch call: connectorFetch still runs the egress guard on
 * every hop, owns timeouts, retries and redirects.
 *
 * What it adds around the handshake:
 *  - Connection affinity. NTLM authenticates a TCP connection, not a request,
 *    so every handshake leg runs on one keep-alive socket: each pool "slot"
 *    is an http(s).Agent with maxSockets 1, used by one request at a time. A
 *    slot whose socket is still the one that authenticated sends requests
 *    without a handshake; a new socket, or a 401 on an authenticated one,
 *    re-handshakes. Pools are per credential + origin + TLS/proxy settings.
 *  - Bodies are sent once, after the challenge: requests with a body start
 *    the handshake with an empty body (Content-Length: 0, as curl does) and
 *    send the real body with the AUTHENTICATE leg. Buffered bodies can be
 *    replayed after a lost connection; streams never are.
 *  - Credentials are bound to the connection's origin (base_url). A request
 *    for any other origin (a redirect elsewhere) goes out anonymously, with
 *    credential headers removed — the password-derived response never leaves
 *    the origin it was configured for.
 *  - Egress at connect time: DNS answers are checked with the egress guard
 *    when the socket is dialled (no rebinding window), and the proxy host is
 *    egress-checked too.
 *  - TLS: the public roots plus the connection's CA bundle; certificate
 *    verification is never turned off. Over HTTPS the NTLM response carries a
 *    tls-server-end-point channel binding (Extended Protection / EPA).
 *
 * Server-only.
 */
import { createHash } from 'node:crypto'
import dns from 'node:dns'
import { once } from 'node:events'
import http from 'node:http'
import https from 'node:https'
import type net from 'node:net'
import { Readable } from 'node:stream'
import tls from 'node:tls'
import { assertSafeEgressHost, assertSafeResolvedAddress } from '@/lib/egress-guard'
import { tlsServerEndPoint } from './channel-binding'
import { kerberosPrincipal, pemCertificates, type WindowsAuthConfig } from './config'
import { initialKerberosToken, KerberosUnavailableError, type SpnegoContext } from './kerberos'
import {
  createAuthenticateMessage,
  createNegotiateMessage,
  isNtlmToken,
  NtlmProtocolError,
  parseChallengeMessage,
  parseWindowsUsername,
} from './ntlm'

export class WindowsAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WindowsAuthError'
  }
}

export interface WindowsTransportOptions {
  /** The connection's base URL: credentials are only ever used for its origin. */
  baseUrl: string
  auth: WindowsAuthConfig
  /** Parallel authenticated connections per pool (default 4). */
  maxConnections?: number
}

type Scheme = 'NTLM' | 'Negotiate'

type PreparedBody =
  | { kind: 'none' }
  | { kind: 'buffer'; data: Buffer }
  | { kind: 'stream'; stream: Readable }

interface OutgoingRequest {
  url: URL
  method: string
  headers: Record<string, string>
  body: PreparedBody
  signal?: AbortSignal
}

const DEFAULT_MAX_CONNECTIONS = 4
const SOCKET_IDLE_MS = 55_000
const POOL_IDLE_MS = 5 * 60_000
const MAX_POOLS = 64
const MAX_DRAIN_BYTES = 256 * 1024
const MAX_KERBEROS_LEGS = 3
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'te', 'upgrade', 'proxy-connection', 'trailer'])
const CREDENTIAL_HEADER_RE = /^(authorization|cookie|proxy-authorization|x-api-key|api-key|x-auth-token|x-access-token)$/i
const BODYLESS_DEFAULT = new Set(['GET', 'HEAD', 'DELETE', 'OPTIONS', 'TRACE'])

// ── DNS: the egress guard at connect time ────────────────────────────────

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void

export function guardedLookup(hostname: string, options: dns.LookupOptions | number | LookupCallback, callback?: LookupCallback): void {
  const cb = (typeof options === 'function' ? options : callback) as LookupCallback
  const opts: dns.LookupOptions = typeof options === 'object' && options ? options : typeof options === 'number' ? { family: options } : {}
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err, [])
    try {
      for (const { address } of addresses) assertSafeResolvedAddress(hostname, address)
    } catch (error) {
      return cb(error as NodeJS.ErrnoException, [])
    }
    if (addresses.length === 0) return cb(Object.assign(new Error(`No addresses for ${hostname}`), { code: 'ENOTFOUND' }), [])
    if (opts.all) cb(null, addresses)
    else cb(null, addresses[0].address, addresses[0].family)
  })
}

// ── Agents (TLS trust, proxy tunnel) ─────────────────────────────────────

interface AgentSettings {
  isTls: boolean
  ca: string[] | undefined
  proxy: URL | null
  keepAlive: boolean
}

function proxyTunnel(settings: AgentSettings) {
  const proxy = settings.proxy!
  return function createConnection(options: Record<string, any>, done: (err: Error | null, socket?: net.Socket) => void): undefined {
    const host = String(options.host ?? options.hostname)
    const port = Number(options.port)
    const authority = `${host.includes(':') ? `[${host}]` : host}:${port}`
    const connectReq = http.request({
      host: proxy.hostname,
      port: Number(proxy.port) || 80,
      method: 'CONNECT',
      path: authority,
      headers: { Host: authority },
      agent: false,
      lookup: guardedLookup as never,
    })
    connectReq.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        done(new WindowsAuthError(`The proxy refused the tunnel to ${authority} (HTTP ${res.statusCode}${res.statusCode === 407 ? ': proxy authentication is not supported' : ''})`))
        return
      }
      if (!settings.isTls) return done(null, socket)
      const secure = tls.connect({
        socket,
        servername: options.servername ?? host,
        ca: settings.ca,
        rejectUnauthorized: true,
      })
      done(null, secure)
    })
    connectReq.once('error', (err) => done(err))
    connectReq.end()
    return undefined
  }
}

function makeAgent(settings: AgentSettings): http.Agent {
  const common = {
    keepAlive: settings.keepAlive,
    maxSockets: 1,
    maxFreeSockets: 1,
    timeout: SOCKET_IDLE_MS,
    lookup: guardedLookup,
  }
  const agent = settings.isTls
    ? new https.Agent({ ...common, ca: settings.ca, rejectUnauthorized: true })
    : new http.Agent(common)
  if (settings.proxy) (agent as any).createConnection = proxyTunnel(settings)
  return agent
}

// ── Pools: per-credential slots with connection affinity ─────────────────

class Slot {
  agent: http.Agent
  busy = false
  /** The socket the last handshake authenticated (null = none). */
  authedSocket: net.Socket | null = null

  constructor(private readonly settings: AgentSettings) {
    this.agent = makeAgent(settings)
  }

  /** Drop the connection (after an error mid-exchange) and start clean next time. */
  reset() {
    this.agent.destroy()
    this.agent = makeAgent(this.settings)
    this.authedSocket = null
  }

  isAuthenticated(): boolean {
    return Boolean(this.authedSocket && !this.authedSocket.destroyed)
  }

  destroy() {
    this.agent.destroy()
    this.authedSocket = null
  }
}

class ConnectionPool {
  private readonly slots: Slot[] = []
  private readonly waiters: { resolve: (slot: Slot) => void; reject: (err: unknown) => void }[] = []
  /** Scheme the server accepted NTLM tokens under (learned from the first challenge). */
  ntlmScheme: Scheme = 'NTLM'
  lastUsed = Date.now()

  constructor(readonly settings: AgentSettings, private readonly max: number) {}

  acquire(signal?: AbortSignal): Promise<Slot> {
    this.lastUsed = Date.now()
    const free = this.slots.find((s) => !s.busy && s.isAuthenticated()) ?? this.slots.find((s) => !s.busy)
    if (free) {
      free.busy = true
      return Promise.resolve(free)
    }
    if (this.slots.length < this.max) {
      const slot = new Slot(this.settings)
      slot.busy = true
      this.slots.push(slot)
      return Promise.resolve(slot)
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject }
      this.waiters.push(waiter)
      signal?.addEventListener('abort', () => {
        const i = this.waiters.indexOf(waiter)
        if (i >= 0) this.waiters.splice(i, 1)
        reject(signal.reason ?? Object.assign(new Error('Aborted'), { name: 'AbortError' }))
      }, { once: true })
    })
  }

  release(slot: Slot) {
    this.lastUsed = Date.now()
    const next = this.waiters.shift()
    if (next) next.resolve(slot)
    else slot.busy = false
  }

  get idle(): boolean {
    return this.slots.every((s) => !s.busy) && this.waiters.length === 0
  }

  destroy() {
    for (const s of this.slots) s.destroy()
    this.slots.length = 0
  }
}

const pools = new Map<string, ConnectionPool>()
let sweeper: NodeJS.Timeout | null = null

function sweepPools(now = Date.now()) {
  for (const [key, pool] of pools) {
    if (pool.idle && now - pool.lastUsed > POOL_IDLE_MS) {
      pool.destroy()
      pools.delete(key)
    }
  }
}

function getPool(key: string, settings: AgentSettings, max: number): ConnectionPool {
  let pool = pools.get(key)
  if (pool) return pool
  if (pools.size >= MAX_POOLS) {
    sweepPools(Number.POSITIVE_INFINITY)
    if (pools.size >= MAX_POOLS) {
      // Evict the least recently used idle pool; otherwise grow past the soft cap.
      const victim = [...pools.entries()].filter(([, p]) => p.idle).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0]
      if (victim) { victim[1].destroy(); pools.delete(victim[0]) }
    }
  }
  pool = new ConnectionPool(settings, max)
  pools.set(key, pool)
  if (!sweeper) {
    sweeper = setInterval(() => sweepPools(), 60_000)
    sweeper.unref?.()
  }
  return pool
}

/** Close every pooled connection (tests, shutdown). */
export function closeWindowsTransportPools(): void {
  for (const pool of pools.values()) pool.destroy()
  pools.clear()
  if (sweeper) { clearInterval(sweeper); sweeper = null }
}

// ── Request plumbing ─────────────────────────────────────────────────────

function headerRecord(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!init) return out
  const entries = init instanceof Headers ? [...init.entries()] : Array.isArray(init) ? init : Object.entries(init)
  for (const [k, v] of entries) {
    if (v === undefined || v === null) continue
    if (/[\r\n]/.test(String(v))) throw new TypeError(`Invalid value for header ${k}`)
    out[k] = String(v)
  }
  return out
}

function hasHeader(headers: Record<string, string>, name: string) {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((k) => k.toLowerCase() === lower)
}

function withoutHeaders(headers: Record<string, string>, test: (lowerName: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) if (!test(k.toLowerCase())) out[k] = v
  return out
}

async function prepareBody(body: BodyInit | null | undefined, headers: Record<string, string>): Promise<PreparedBody> {
  if (body == null) return { kind: 'none' }
  const setType = (type: string | null) => { if (type && !hasHeader(headers, 'content-type')) headers['Content-Type'] = type }
  if (typeof body === 'string') {
    setType('text/plain;charset=UTF-8')
    return { kind: 'buffer', data: Buffer.from(body, 'utf8') }
  }
  if (body instanceof ArrayBuffer) return { kind: 'buffer', data: Buffer.from(body) }
  if (ArrayBuffer.isView(body)) return { kind: 'buffer', data: Buffer.from(body.buffer, body.byteOffset, body.byteLength) }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    return { kind: 'stream', stream: Readable.fromWeb(body as any) }
  }
  if (body instanceof Readable) return { kind: 'stream', stream: body }
  // URLSearchParams, FormData, Blob: let the platform serialise (and pick the content type / multipart boundary).
  const serialised = new Response(body as BodyInit)
  setType(serialised.headers.get('content-type'))
  return { kind: 'buffer', data: Buffer.from(await serialised.arrayBuffer()) }
}

interface SentResponse {
  res: http.IncomingMessage
  socket: net.Socket
  reused: boolean
}

function send(agent: http.Agent, req: OutgoingRequest, authorization: string | null, body: PreparedBody): Promise<SentResponse> {
  return new Promise((resolve, reject) => {
    const isTls = req.url.protocol === 'https:'
    const headers: Record<string, string> = withoutHeaders(req.headers, (k) => HOP_BY_HOP.has(k) || k === 'authorization' || (k === 'content-length' && body.kind !== 'stream'))
    if (authorization) headers.Authorization = authorization
    if (body.kind === 'buffer') headers['Content-Length'] = String(body.data.length)
    else if (body.kind === 'none' && !BODYLESS_DEFAULT.has(req.method)) headers['Content-Length'] = '0'
    let socket: net.Socket | null = null
    const r = (isTls ? https : http).request({
      protocol: req.url.protocol,
      hostname: req.url.hostname.replace(/^\[|\]$/g, ''),
      port: req.url.port || (isTls ? 443 : 80),
      path: `${req.url.pathname}${req.url.search}`,
      method: req.method,
      headers,
      agent,
      signal: req.signal,
      servername: isTls && !/^[\d.]+$|:/.test(req.url.hostname) ? req.url.hostname : undefined,
    })
    r.once('socket', (s) => { socket = s })
    r.once('response', (res) => resolve({ res, socket: (socket ?? res.socket) as net.Socket, reused: Boolean((r as any).reusedSocket) }))
    r.once('error', (err) => {
      ;(err as any).reusedSocket = Boolean((r as any).reusedSocket)
      reject(err)
    })
    if (body.kind === 'buffer') r.end(body.data)
    else if (body.kind === 'stream') {
      body.stream.once('error', (err) => r.destroy(err))
      body.stream.pipe(r)
    } else r.end()
  })
}

/** Read and discard a handshake response so its socket goes back to the slot. */
async function drain(res: http.IncomingMessage): Promise<void> {
  if (res.readableEnded || res.destroyed) return
  let seen = 0
  res.on('data', (chunk: Buffer) => {
    seen += chunk.length
    if (seen > MAX_DRAIN_BYTES) res.destroy()
  })
  await new Promise<void>((resolve) => {
    res.once('end', resolve)
    res.once('close', resolve)
    res.once('error', () => resolve())
  })
}

interface Challenge { scheme: string; token: string | null }

/** WWW-Authenticate challenges (several headers, or comma-separated in one). */
export function parseAuthenticateHeaders(values: string[] | string | undefined): Challenge[] {
  const list = Array.isArray(values) ? values : values ? [values] : []
  const out: Challenge[] = []
  for (const value of list) {
    for (const part of value.split(',')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const m = trimmed.match(/^([A-Za-z][A-Za-z0-9!#$%&'*+.^_`|~-]*)(?:\s+(.+))?$/)
      if (!m) continue
      const rest = m[2]?.trim() ?? null
      // A bare token68 (base64) belongs to the scheme; auth-params (realm="…") are not a token.
      out.push({ scheme: m[1], token: rest && /^[A-Za-z0-9+/=._~-]+$/.test(rest) ? rest : null })
    }
  }
  return out
}

function challengesOf(res: http.IncomingMessage): Challenge[] {
  return parseAuthenticateHeaders(res.headersDistinct?.['www-authenticate'] ?? res.headers['www-authenticate'])
}

function offersWindowsAuth(res: http.IncomingMessage): boolean {
  return challengesOf(res).some((c) => /^(ntlm|negotiate)$/i.test(c.scheme))
}

function toResponse(sent: SentResponse, method: string, onDone: () => void): Response {
  const { res } = sent
  let done = false
  const finish = () => { if (!done) { done = true; onDone() } }
  res.once('end', finish)
  res.once('close', finish)
  res.once('error', finish)
  const headers = new Headers()
  for (const [name, values] of Object.entries(res.headersDistinct ?? {})) {
    for (const v of values ?? []) headers.append(name, v)
  }
  const status = res.statusCode ?? 502
  const init = { status, statusText: res.statusMessage ?? '', headers }
  if (method === 'HEAD' || status === 204 || status === 205 || status === 304) {
    res.resume()
    return new Response(null, init)
  }
  return new Response(Readable.toWeb(res) as unknown as ReadableStream, init)
}

// ── The handshake ────────────────────────────────────────────────────────

interface Session {
  pool: ConnectionPool
  slot: Slot
  auth: WindowsAuthConfig
}

/** HTTP/<host>: the Host header when one is set (an alias), else the URL host. */
function defaultSpn(req: OutgoingRequest): string {
  const hostHeader = Object.entries(req.headers).find(([k]) => k.toLowerCase() === 'host')?.[1]
  const host = (hostHeader?.trim() || req.url.host).replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return `HTTP/${host}`
}

function brokenAffinity(): WindowsAuthError {
  return new WindowsAuthError(
    'The server closed the connection during the Windows authentication handshake. NTLM needs HTTP keep-alive end to end: '
    + 'check that no proxy or load balancer between UserTasks and the server breaks connection affinity.',
  )
}

async function ntlmHandshake(s: Session, req: OutgoingRequest): Promise<SentResponse> {
  const hasBody = req.body.kind !== 'none'
  const { user, domain } = parseWindowsUsername(s.auth.username)
  let scheme = s.pool.ntlmScheme
  const negotiate = createNegotiateMessage()

  for (let attempt = 0; attempt < 2; attempt++) {
    // Leg 1: NEGOTIATE. A request with a body sends it empty here; the body goes with leg 2.
    const leg1 = await send(s.slot.agent, req, `${scheme} ${negotiate.toString('base64')}`, { kind: 'none' })
    if (leg1.res.statusCode !== 401) {
      // The server did not ask for authentication.
      if (!hasBody) return leg1
      await drain(leg1.res)
      return send(s.slot.agent, req, null, req.body)
    }
    const challenges = challengesOf(leg1.res)
    const ntlmChallenge = challenges.find((c) => c.scheme.toLowerCase() === scheme.toLowerCase() && c.token && isNtlmToken(c.token))
    if (!ntlmChallenge) {
      const other: Scheme = scheme === 'NTLM' ? 'Negotiate' : 'NTLM'
      if (attempt === 0 && challenges.some((c) => c.scheme.toLowerCase() === other.toLowerCase())) {
        // e.g. a server that offers only Negotiate: send the NTLM token under that scheme.
        await drain(leg1.res)
        scheme = other
        continue
      }
      if (challenges.length && !offersWindowsAuth(leg1.res)) {
        await drain(leg1.res)
        throw new WindowsAuthError(`The server does not offer Windows authentication (WWW-Authenticate: ${challenges.map((c) => c.scheme).join(', ')})`)
      }
      return leg1 // a plain 401: hand it back
    }
    s.pool.ntlmScheme = scheme
    if (String(leg1.res.headers.connection ?? '').toLowerCase() === 'close') {
      await drain(leg1.res)
      throw brokenAffinity()
    }
    const challenge = parseChallengeMessage(ntlmChallenge.token!)
    const channelBinding = req.url.protocol === 'https:' ? peerChannelBinding(leg1.socket) : null
    await drain(leg1.res)

    // Leg 2: AUTHENTICATE, with the real body, on the same socket.
    const authenticate = createAuthenticateMessage({
      negotiate,
      challenge,
      credentials: { user, domain, password: s.auth.password },
      channelBinding,
      targetSpn: s.auth.spn ?? defaultSpn(req),
    })
    const leg2 = await send(s.slot.agent, req, `${scheme} ${authenticate.toString('base64')}`, req.body)
    if (leg2.socket !== leg1.socket) {
      await drain(leg2.res)
      throw brokenAffinity()
    }
    if (leg2.res.statusCode !== 401) s.slot.authedSocket = leg2.socket
    else s.slot.authedSocket = null
    return leg2
  }
  throw new WindowsAuthError('The server did not send an NTLM challenge')
}

function peerChannelBinding(socket: net.Socket): Buffer | null {
  const raw = (socket as tls.TLSSocket).getPeerCertificate?.()?.raw
  return raw && raw.length ? tlsServerEndPoint(raw) : null
}

function negotiateTokenOf(res: http.IncomingMessage): string | null {
  return challengesOf(res).find((c) => c.scheme.toLowerCase() === 'negotiate' && c.token && !isNtlmToken(c.token))?.token ?? null
}

/**
 * Kerberos (SPNEGO) on the real request: one leg usually, more when the
 * server continues the exchange. Returns null when Kerberos is unavailable
 * and the mode allows NTLM fallback.
 */
async function kerberosHandshake(s: Session, req: OutgoingRequest): Promise<SentResponse | null> {
  const spn = s.auth.spn ?? defaultSpn(req)
  let started: { token: string; context: SpnegoContext }
  try {
    started = await initialKerberosToken(spn, kerberosPrincipal(s.auth.username))
  } catch (error) {
    if (error instanceof KerberosUnavailableError && s.auth.mode === 'negotiate') return null
    throw error
  }
  let token = started.token
  for (let leg = 0; leg < MAX_KERBEROS_LEGS; leg++) {
    const sent = await send(s.slot.agent, req, `Negotiate ${token}`, req.body)
    const serverToken = negotiateTokenOf(sent.res)
    if (sent.res.statusCode !== 401) {
      if (serverToken && started.context.verify) {
        try {
          await started.context.verify(serverToken)
        } catch (error) {
          sent.res.destroy()
          throw new WindowsAuthError(`Kerberos mutual authentication failed: ${(error as Error)?.message ?? error}`)
        }
      }
      s.slot.authedSocket = sent.socket
      return sent
    }
    // A continuation token: step the context and answer on the same connection.
    if (!serverToken || req.body.kind === 'stream' || leg === MAX_KERBEROS_LEGS - 1) return sent
    await drain(sent.res)
    token = await started.context.step(serverToken)
  }
  return null
}

async function authenticatedSend(s: Session, req: OutgoingRequest): Promise<SentResponse> {
  // Fast path: this slot's socket already authenticated. Streams always
  // handshake first (they cannot be replayed after a 401).
  if (s.slot.isAuthenticated() && req.body.kind !== 'stream') {
    try {
      const sent = await send(s.slot.agent, req, null, req.body)
      if (sent.res.statusCode !== 401 || !offersWindowsAuth(sent.res)) {
        if (sent.socket !== s.slot.authedSocket) s.slot.authedSocket = sent.res.statusCode === 401 ? null : sent.socket
        return sent
      }
      // The connection lost its authentication: handshake again (the body is a buffer, safe to resend).
      await drain(sent.res)
    } catch (error) {
      // The idle socket closed under us before any response: handshake on a new one.
      const code = (error as NodeJS.ErrnoException)?.code
      if (!(error as any)?.reusedSocket || !['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(String(code))) throw error
    }
    s.slot.authedSocket = null
  }

  if (s.auth.mode !== 'ntlm') {
    const sent = await kerberosHandshake(s, req)
    if (sent) {
      // Negotiate mode: a rejected Kerberos ticket falls back to NTLM when the body can be resent.
      if (sent.res.statusCode !== 401 || s.auth.mode === 'kerberos' || req.body.kind === 'stream') return sent
      await drain(sent.res)
    }
  }
  return ntlmHandshake(s, req)
}

// ── The fetch ────────────────────────────────────────────────────────────

function poolKey(origin: string, auth: WindowsAuthConfig): string {
  return createHash('sha256')
    .update(JSON.stringify([origin, auth.mode, auth.username, auth.password, auth.spn, auth.ca_bundle, auth.proxy_url]))
    .digest('hex')
}

function caList(bundle: string | null): string[] | undefined {
  if (!bundle) return undefined
  // Node's `ca` replaces the default roots: keep the public ones and add the bundle.
  return [...tls.rootCertificates, ...pemCertificates(bundle)]
}

/**
 * A fetch() that performs Windows authentication for `baseUrl`'s origin.
 * Pass it as ConnectorFetchOptions.fetchImpl (connectorFetch keeps the egress
 * guard, retries and redirects).
 */
export function createWindowsTransport(options: WindowsTransportOptions): typeof fetch {
  let base: URL
  try { base = new URL(options.baseUrl) } catch { throw new WindowsAuthError('Windows authentication needs a valid base URL') }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new WindowsAuthError('Windows authentication works over HTTP and HTTPS only')
  const auth = options.auth
  const origin = base.origin
  const proxy = auth.proxy_url ? new URL(auth.proxy_url) : null
  const max = Math.max(1, Math.min(16, options.maxConnections ?? DEFAULT_MAX_CONNECTIONS))
  const ca = caList(auth.ca_bundle)

  const windowsFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError(`Unsupported protocol ${url.protocol}`)
    const method = String(init.method ?? 'GET').toUpperCase()
    const signal = init.signal ?? undefined
    signal?.throwIfAborted()
    let headers = headerRecord(init.headers)
    const body = await prepareBody(init.body, headers)
    if (proxy) await assertSafeEgressHost(proxy.hostname)
    const settings: AgentSettings = { isTls: url.protocol === 'https:', ca: url.protocol === 'https:' ? ca : undefined, proxy, keepAlive: true }

    if (url.origin !== origin) {
      // Not the connection's origin (a redirect elsewhere): no Windows
      // credentials, no credential headers, a one-off connection.
      headers = withoutHeaders(headers, (k) => CREDENTIAL_HEADER_RE.test(k))
      const agent = makeAgent({ ...settings, keepAlive: false })
      try {
        const sent = await send(agent, { url, method, headers, body, signal }, null, body)
        return toResponse(sent, method, () => agent.destroy())
      } catch (error) {
        agent.destroy()
        throw error
      }
    }

    const pool = getPool(poolKey(url.origin, auth), settings, max)
    const slot = await pool.acquire(signal)
    let released = false
    const release = () => { if (!released) { released = true; pool.release(slot) } }
    try {
      const sent = await authenticatedSend({ pool, slot, auth }, { url, method, headers, body, signal })
      return toResponse(sent, method, release)
    } catch (error) {
      slot.reset()
      release()
      if (error instanceof NtlmProtocolError) throw new WindowsAuthError(error.message)
      throw error
    }
  }
  return windowsFetch as typeof fetch
}

/**
 * A plain fetch() (no Windows credentials) over node:http / node:https whose
 * DNS answers are checked by the egress guard at connect time (guardedLookup),
 * so a name cannot rebind to a blocked address between the check and the
 * connection. connectorFetch uses it for targets the private-network
 * allowlist admits. One connection per request; redirects are returned, not
 * followed (connectorFetch follows them, re-checking each hop).
 */
export function createGuardedFetch(): typeof fetch {
  const guardedFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError(`Unsupported protocol ${url.protocol}`)
    const method = String(init.method ?? 'GET').toUpperCase()
    const signal = init.signal ?? undefined
    signal?.throwIfAborted()
    const headers = headerRecord(init.headers)
    const body = await prepareBody(init.body, headers)
    // send() sets Authorization itself (the handshake owns it): pass the caller's through.
    const authorization = Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1] ?? null
    const agent = makeAgent({ isTls: url.protocol === 'https:', ca: undefined, proxy: null, keepAlive: false })
    try {
      const sent = await send(agent, { url, method, headers, body, signal }, authorization, body)
      return toResponse(sent, method, () => agent.destroy())
    } catch (error) {
      agent.destroy()
      throw error
    }
  }
  return guardedFetch as typeof fetch
}
