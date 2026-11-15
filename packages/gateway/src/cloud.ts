/**
 * The gateway's only connection to the outside: HTTPS to the UserTasks
 * address (keep-alive, the platform roots plus an optional extra CA for
 * TLS-inspecting proxies, an optional CONNECT proxy). Every request after
 * registration is signed with the instance key; every answer must carry a
 * valid cloud signature bound to the request's nonce, or it is discarded —
 * a proxy that terminates TLS still cannot inject or replay work.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON (cloud answers) and node's Agent typing */
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import { createPrivateKey, type KeyObject } from 'node:crypto'
import {
  canonicalResponse,
  GATEWAY_API_PREFIX,
  REQUEST_SIGNATURE_HEADERS,
  RESPONSE_SIGNATURE_HEADERS,
  randomNonce,
  sha256Hex,
  signRequest,
  verifyBytes,
} from '../../../lib/gateway/protocol'

export interface CloudIdentity {
  keyId: string
  privateKeyPem: string
  cloudKeys: Array<{ id: string; publicKey: string }>
}

export class CloudError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
    this.name = 'CloudError'
  }
}

export interface CloudReply<T = any> { status: number; body: T }

class ProxyAgent extends https.Agent {
  constructor(private readonly proxy: URL, options: https.AgentOptions) {
    super(options)
  }

  // Tunnel through the proxy (CONNECT), then TLS to the cloud host.
  override createConnection(options: any, callback?: (err: Error | null, stream: any) => void): any {
    const req = http.request({ host: this.proxy.hostname, port: Number(this.proxy.port) || 80, method: 'CONNECT', path: `${options.host}:${options.port}`, headers: { host: `${options.host}:${options.port}` } })
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        callback?.(new Error(`Proxy CONNECT failed: ${res.statusCode}`), undefined)
        return
      }
      const secure = tls.connect({ ...options, socket, servername: options.servername ?? options.host })
      callback?.(null, secure)
    })
    req.once('error', (err) => callback?.(err, undefined))
    req.end()
    return undefined
  }
}

export class CloudClient {
  readonly base: URL
  private readonly agent: https.Agent | http.Agent
  private key: KeyObject | null = null
  private keyPem: string | null = null

  constructor(cloudUrl: string, options: { ca: string | null; proxy: string | null }, private identity: () => CloudIdentity | null) {
    this.base = new URL(cloudUrl)
    const ca = options.ca ? [...tls.rootCertificates, options.ca] : undefined
    const agentOptions: https.AgentOptions = { keepAlive: true, maxSockets: 32, keepAliveMsecs: 15_000, ...(ca ? { ca } : {}) }
    if (this.base.protocol === 'http:') this.agent = new http.Agent({ keepAlive: true, maxSockets: 32 })
    else this.agent = options.proxy ? new ProxyAgent(new URL(options.proxy), agentOptions) : new https.Agent(agentOptions)
  }

  private privateKey(pem: string): KeyObject {
    if (this.keyPem !== pem || !this.key) { this.key = createPrivateKey(pem); this.keyPem = pem }
    return this.key
  }

  private raw(method: string, path: string, body: Buffer | null, headers: Record<string, string>, timeoutMs: number, signal?: AbortSignal): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
    const url = new URL(path, this.base)
    const mod = url.protocol === 'https:' ? https : http
    return new Promise((resolve, reject) => {
      const req = mod.request(url, {
        method,
        agent: this.agent,
        headers: { ...headers, 'user-agent': 'usertasks-gateway', accept: 'application/json', ...(body ? { 'content-type': headers['content-type'] ?? 'application/json', 'content-length': String(body.length) } : {}) },
        timeout: timeoutMs,
        signal,
      }, (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > 8 * 1024 * 1024) { req.destroy(new Error('Cloud answer too large')); return }
          chunks.push(c)
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
        res.on('error', reject)
      })
      req.on('timeout', () => req.destroy(new Error(`Cloud request timed out after ${timeoutMs} ms`)))
      req.on('error', reject)
      if (body) req.write(body)
      req.end()
    })
  }

  /** Unsigned (registration with a one-time token). */
  async register(input: Record<string, unknown>): Promise<CloudReply> {
    const body = Buffer.from(JSON.stringify(input))
    const res = await this.raw('POST', `${GATEWAY_API_PREFIX}/register`, body, {}, 30_000)
    const parsed = safeJson(res.body)
    if (res.status !== 200) throw new CloudError(parsed?.error ?? `Registration failed (${res.status})`, res.status, parsed?.code ?? 'registration_failed')
    return { status: res.status, body: parsed }
  }

  /**
   * A signed call. `payload`: JSON value, raw Buffer (PUT parts) or null (GET).
   * Throws CloudError for non-2xx answers (with the cloud's code) and for
   * answers whose signature does not verify.
   */
  async call<T = any>(method: 'GET' | 'POST' | 'PUT', route: string, payload: unknown, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<CloudReply<T>> {
    const id = this.identity()
    if (!id) throw new CloudError('This gateway instance is not registered', 0, 'not_registered')
    const path = `${GATEWAY_API_PREFIX}/${route}`
    const body = payload === null || payload === undefined ? null : Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload))
    const nonce = randomNonce()
    const signed = signRequest({ keyId: id.keyId, privateKey: this.privateKey(id.privateKeyPem), method, path, body: body ?? Buffer.alloc(0), nonce })
    const res = await this.raw(method, path, body, { ...signed, ...(Buffer.isBuffer(payload) ? { 'content-type': 'application/octet-stream' } : {}) }, options.timeoutMs ?? 60_000, options.signal)
    const parsed = safeJson(res.body)
    const keyId = String(res.headers[RESPONSE_SIGNATURE_HEADERS.keyId] ?? '')
    const signature = String(res.headers[RESPONSE_SIGNATURE_HEADERS.signature] ?? '')
    const trusted = id.cloudKeys.find((k) => k.id === keyId)
    const verified = Boolean(trusted && signature && verifyBytes(trusted.publicKey, canonicalResponse({ status: res.status, requestNonce: signed[REQUEST_SIGNATURE_HEADERS.nonce], bodySha256: sha256Hex(res.body) }), signature))
    if (!verified) {
      // Unsigned answers are only believable as refusals of the request itself (401 / 403 / 503 before any work).
      if (res.status >= 400) throw new CloudError(parsed?.error ?? `Cloud refused the request (${res.status})`, res.status, parsed?.code ?? 'cloud_error')
      throw new CloudError('The cloud answer has no valid signature (wrong address, or a proxy altered it); ignored', res.status, 'bad_cloud_signature')
    }
    if (res.status < 200 || res.status >= 300) throw new CloudError(parsed?.error ?? `Cloud error ${res.status}`, res.status, parsed?.code ?? 'cloud_error')
    return { status: res.status, body: parsed as T }
  }

  close(): void {
    this.agent.destroy()
  }
}

function safeJson(buf: Buffer): any {
  try { return JSON.parse(buf.toString('utf8')) } catch { return null }
}
