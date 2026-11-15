/**
 * Runs one job against one configured target, with the target's own
 * credentials (core's Windows transport: NTLMv2 / Negotiate / Kerberos, CA
 * bundle, proxy, channel binding), and turns the answer into a result.
 *
 * Every check happens here again, whatever the cloud already checked: the
 * target must exist in this gateway's configuration; the path must stay on
 * the target's origin and under its allowed prefixes; the method must be
 * allowed; headers are sanitised (Authorization only where the target
 * allows the cloud's own); bodies are size-capped both ways; expired jobs
 * are not started. Redirects are returned to the cloud, never followed here.
 */
import { createWindowsTransport } from '../../../lib/integrations/windows-auth/transport'
import type { WindowsAuthConfig } from '../../../lib/integrations/windows-auth/config'
import { INLINE_BODY_MAX_BYTES, resolveTargetUrl, sanitizeHeaders, sha256Hex, splitParts, type GatewayJob, type GatewayJobResult, type JobBodyRef } from '../../../lib/gateway/protocol'
import type { GatewayConfig, TargetConfig } from './config'

export class JobRefused extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'JobRefused'
  }
}

type TransportPair = { auth: typeof fetch; anonymous: typeof fetch }
const transports = new Map<string, TransportPair>()

function windowsConfig(target: TargetConfig): WindowsAuthConfig {
  if (target.auth.type === 'windows') {
    return { mode: target.auth.mode, username: target.auth.username, password: target.auth.password, spn: target.auth.spn, ca_bundle: target.caBundle, proxy_url: target.proxy }
  }
  return { mode: 'ntlm', username: 'anonymous\\gateway', password: 'unused', spn: null, ca_bundle: target.caBundle, proxy_url: target.proxy }
}

function transportFor(target: TargetConfig): TransportPair {
  let pair = transports.get(target.id)
  if (!pair) {
    const config = windowsConfig(target)
    const anonymous = createWindowsTransport({ baseUrl: target.origin, auth: config, anonymous: true })
    const auth = target.auth.type === 'windows' ? createWindowsTransport({ baseUrl: target.origin, auth: config, maxConnections: 8 }) : anonymous
    pair = { auth, anonymous }
    transports.set(target.id, pair)
  }
  return pair
}

/** Drop cached transports (after a configuration reload). */
export function resetTransports(): void {
  transports.clear()
}

/** Validate a job against the configuration; returns the target and URL or throws JobRefused. */
export function checkJob(config: GatewayConfig, job: GatewayJob, now = Date.now()): { target: TargetConfig; url: URL } {
  if (job.v !== 1) throw new JobRefused(`Unsupported job version ${job.v}`, 'unsupported_job')
  if (job.expiresAt <= now) throw new JobRefused('The request expired before it could start', 'gateway_timeout')
  const target = config.targets.find((t) => t.id === job.target)
  if (!target) throw new JobRefused(`"${job.target}" is not a target of this gateway`, 'target_not_allowed')
  let url: URL
  try { url = resolveTargetUrl(target.origin, job.path) } catch (error) { throw new JobRefused(`Refused path: ${(error as Error).message}`, 'path_not_allowed') }
  const lowerPath = url.pathname.toLowerCase()
  if (!target.pathPrefixes.some((p) => lowerPath.startsWith(p) || `${lowerPath}/` === p)) throw new JobRefused(`Path ${url.pathname} is outside the target's allowed paths`, 'path_not_allowed')
  if (!target.methods.has(job.method)) throw new JobRefused(`Method ${job.method} is not allowed for target "${target.id}"`, 'method_not_allowed')
  if ((job.body?.size ?? 0) > config.maxRequestBytes) throw new JobRefused(`Request body over this gateway's limit (${config.maxRequestBytes} bytes)`, 'payload_too_large')
  return { target, url }
}

export interface ExecuteDeps {
  /** Fetch request-body part n of a job (large bodies). */
  requestPart(jobId: string, n: number): Promise<Buffer>
  /** Upload response-body part n of a job. */
  responsePart(jobId: string, n: number, data: Buffer): Promise<void>
  /** Override the transport (tests). */
  fetchFor?(target: TargetConfig, anonymous: boolean): typeof fetch
}

async function loadRequestBody(job: GatewayJob, deps: ExecuteDeps): Promise<Buffer | null> {
  const ref = job.body
  if (!ref) return null
  let body: Buffer
  if (typeof ref.inline === 'string') body = Buffer.from(ref.inline, 'base64')
  else {
    const parts: Buffer[] = []
    for (let i = 0; i < (ref.parts ?? 0); i++) parts.push(await deps.requestPart(job.id, i))
    body = Buffer.concat(parts)
  }
  if (body.length !== ref.size || sha256Hex(body) !== ref.sha256) throw new JobRefused('The request body does not match its checksum', 'corrupt_body')
  return body
}

async function readCapped(res: Response, max: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      throw new JobRefused(`The answer is larger than this gateway's limit (${max} bytes)`, 'payload_too_large')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

const DROP_RESPONSE_HEADERS = new Set(['set-cookie', 'connection', 'keep-alive', 'transfer-encoding', 'content-length', 'content-encoding', 'proxy-authenticate', 'trailer', 'upgrade'])

export async function executeJob(config: GatewayConfig, job: GatewayJob, deps: ExecuteDeps): Promise<{ result: GatewayJobResult; target: string }> {
  const started = Date.now()
  const { target, url } = checkJob(config, job)
  const body = await loadRequestBody(job, deps)
  const headers = sanitizeHeaders(job.headers, { allowAuthorization: target.forwardAuthorization })
  // Identity bodies only: the cloud rebuilds the answer as-is (no decompression on its side).
  delete headers['accept-encoding']
  const anonymous = job.anonymous || target.auth.type !== 'windows'
  const doFetch = deps.fetchFor ? deps.fetchFor(target, anonymous) : anonymous ? transportFor(target).anonymous : transportFor(target).auth
  const budget = Math.max(1000, Math.min(target.timeoutMs, job.expiresAt - Date.now()))
  const res = await doFetch(url.href, {
    method: job.method,
    headers,
    body: body && !['GET', 'HEAD'].includes(job.method) ? new Uint8Array(body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(budget),
  })
  const responseBody = await readCapped(res, config.maxResponseBytes)
  const outHeaders: Record<string, string> = {}
  res.headers.forEach((v, k) => { if (!DROP_RESPONSE_HEADERS.has(k.toLowerCase())) outHeaders[k.toLowerCase()] = v })
  let ref: JobBodyRef | null = null
  if (responseBody.length) {
    const sha256 = sha256Hex(responseBody)
    if (responseBody.length <= INLINE_BODY_MAX_BYTES) ref = { inline: responseBody.toString('base64'), size: responseBody.length, sha256 }
    else {
      const parts = splitParts(responseBody)
      for (const [i, part] of parts.entries()) await deps.responsePart(job.id, i, part)
      ref = { parts: parts.length, size: responseBody.length, sha256 }
    }
  }
  return { result: { status: res.status, headers: outHeaders, body: ref, durationMs: Date.now() - started }, target: target.id }
}
