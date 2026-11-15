/**
 * The core `gateway` connector transport (lib/integrations/transports.ts):
 * a connection whose `auth_config._transport` is `gateway` sends every
 * request through one of the workspace's on-premises gateways instead of the
 * server's own network.
 *
 *   auth_config = {
 *     _transport:     'gateway',
 *     gateway_id:     '<gateway uuid of this workspace>',
 *     gateway_target: '<target id configured on the gateway>'   (optional:
 *                     the target is found by the request's origin among
 *                     the targets the gateway advertises),
 *     …               connector-specific, non-secret settings
 *   }
 *
 * What the cloud sends is a target id + an absolute path — never a URL: the
 * request's origin must be one the gateway itself advertised (from its local
 * configuration); anything else is refused here, and the gateway refuses it
 * again against its own copy. Credentials for the target live on the
 * gateway (the customer's network); the connection holds none. `anonymous`
 * requests (discovery probes) and requests that a redirect took to another
 * origin are run without the target's credentials.
 *
 * The server's egress guard does not apply (the server never dials these
 * URLs; the transport is marked remote): the gateway's allowlist does.
 *
 * Server-only.
 */
import { getServiceDb } from '@/lib/providers/db'
import { markRemoteTransport, TransportUnavailableError, type TransportContext } from '@/lib/integrations/transports'
import {
  DEFAULT_JOB_TIMEOUT_MS,
  INSTANCE_OFFLINE_AFTER_MS,
  JOB_METHODS,
  MAX_JOB_TIMEOUT_MS,
  MAX_REQUEST_BODY_BYTES,
  MAX_RESPONSE_BODY_BYTES,
  normaliseOrigin,
  sanitizeHeaders,
  validateJobPath,
  type GatewayTargetAdvert,
  type JobMethod,
} from './protocol'
import { awaitJob, enqueueJob, GatewayQueueError, isMissingTableError } from './queue'

/* eslint-disable @typescript-eslint/no-explicit-any -- service-role client, untyped tables */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A gateway problem that retrying right away would not fix (offline, revoked, refused). */
export class GatewayUnavailableError extends TransportUnavailableError {
  readonly retryable = false
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'GatewayUnavailableError'
  }
}

export interface GatewayConnectionSettings {
  gatewayId: string
  target: string | null
}

export function gatewaySettingsOf(integrationConfig: Record<string, unknown> | null | undefined): GatewayConnectionSettings | null {
  const auth = (integrationConfig?.auth_config ?? {}) as Record<string, unknown>
  if (auth._transport !== 'gateway') return null
  const gatewayId = typeof auth.gateway_id === 'string' ? auth.gateway_id.trim() : ''
  const target = typeof auth.gateway_target === 'string' && auth.gateway_target.trim() ? auth.gateway_target.trim() : null
  return { gatewayId, target }
}

export interface GatewayState {
  id: string
  name: string
  status: string
  targets: GatewayTargetAdvert[]
  online: boolean
  lastSeenAt: string | null
}

/** A workspace's gateway with its advertised targets and whether any instance is online. */
export async function loadGatewayState(tenantId: string, gatewayId: string): Promise<GatewayState | null> {
  if (!UUID_RE.test(gatewayId)) return null
  const db = getServiceDb() as any
  const { data, error } = await db.from('gateways').select('id, name, status, targets, last_seen_at').eq('id', gatewayId).eq('tenant_id', tenantId).maybeSingle()
  if (error) {
    if (isMissingTableError(error)) throw new GatewayUnavailableError('On-premises gateways are not set up in this database (apply migration 20270114200000_onprem_gateways)', 'gateway_not_installed')
    throw new Error(`Could not load the gateway: ${error.message}`)
  }
  if (!data) return null
  const since = new Date(Date.now() - INSTANCE_OFFLINE_AFTER_MS).toISOString()
  const { data: live } = await db.from('gateway_keys').select('id').eq('gateway_id', gatewayId).eq('status', 'active').gte('last_seen_at', since).limit(1)
  return {
    id: data.id,
    name: data.name,
    status: data.status,
    targets: Array.isArray(data.targets) ? data.targets : [],
    online: (live ?? []).length > 0,
    lastSeenAt: data.last_seen_at ?? null,
  }
}

async function bodyToBuffer(body: BodyInit | null | undefined): Promise<Buffer | null> {
  if (body === null || body === undefined) return null
  let buf: Buffer
  if (typeof body === 'string') buf = Buffer.from(body, 'utf8')
  else if (body instanceof URLSearchParams) buf = Buffer.from(body.toString(), 'utf8')
  else if (body instanceof ArrayBuffer) buf = Buffer.from(body)
  else if (ArrayBuffer.isView(body)) buf = Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  else if (typeof Blob !== 'undefined' && body instanceof Blob) buf = Buffer.from(await body.arrayBuffer())
  else buf = Buffer.from(await new Response(body as BodyInit).arrayBuffer())
  if (buf.length > MAX_REQUEST_BODY_BYTES) throw new GatewayUnavailableError(`Request bodies through a gateway are limited to ${MAX_REQUEST_BODY_BYTES / 1048576} MB`, 'payload_too_large')
  return buf
}

function headersOf(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!init) return out
  new Headers(init).forEach((v, k) => { out[k] = v })
  return out
}

/** Statuses that must not carry a body in a Response. */
const NULL_BODY = new Set([101, 103, 204, 205, 304])

export async function gatewayTransportFactory(ctx: TransportContext): Promise<typeof fetch> {
  const settings = gatewaySettingsOf(ctx.integrationConfig)
  if (!settings || !UUID_RE.test(settings.gatewayId)) throw new GatewayUnavailableError('The connection names no gateway (auth_config.gateway_id)', 'gateway_not_configured')
  if (!ctx.tenantId) throw new GatewayUnavailableError('Gateway connections are used within a workspace', 'gateway_no_workspace')
  const tenantId = ctx.tenantId
  const baseOrigin = normaliseOrigin(String(ctx.integrationConfig.base_url ?? ''))
  if (!baseOrigin) throw new GatewayUnavailableError('The connection has no valid base URL', 'invalid_url')
  const state = await loadGatewayState(tenantId, settings.gatewayId)
  if (!state) throw new GatewayUnavailableError('The connection\'s gateway does not exist in this workspace', 'gateway_not_found')
  if (state.status !== 'active') throw new GatewayUnavailableError(`Gateway "${state.name}" has been revoked`, 'gateway_revoked')
  const integrationId = ctx.integrationId ?? null

  const transport = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const origin = normaliseOrigin(url.href)
    const target = state.targets.find((t) => t.origin === origin && (origin !== baseOrigin || !settings.target || t.id === settings.target))
    if (!target) {
      const known = state.targets.map((t) => `${t.id} (${t.origin})`).join(', ') || 'none yet — is it connected?'
      throw new GatewayUnavailableError(`Gateway "${state.name}" does not serve ${origin ?? 'that address'}${settings.target && origin === baseOrigin ? ` as target "${settings.target}"` : ''}. Its targets: ${known}. Add the address to the gateway's configuration.`, 'gateway_target_unknown')
    }
    if (!state.online) throw new GatewayUnavailableError(`Gateway "${state.name}" is offline (no instance connected${state.lastSeenAt ? ` since ${state.lastSeenAt}` : ''})`, 'gateway_offline')
    const method = String(init.method ?? 'GET').toUpperCase() as JobMethod
    if (!(JOB_METHODS as readonly string[]).includes(method)) throw new GatewayUnavailableError(`Method ${method} is not supported through a gateway`, 'method_not_allowed')
    const path = `${url.pathname}${url.search}`
    const problem = validateJobPath(path)
    if (problem) throw new GatewayUnavailableError(`Invalid request path: ${problem}`, 'invalid_url')
    const body = await bodyToBuffer(init.body ?? null)
    const timeoutMs = Math.min(MAX_JOB_TIMEOUT_MS, Math.max(5_000, Number(process.env.GATEWAY_JOB_TIMEOUT_MS) || DEFAULT_JOB_TIMEOUT_MS * 2))
    const jobId = await enqueueJob({
      tenantId,
      gatewayId: state.id,
      target: target.id,
      method,
      path,
      headers: sanitizeHeaders(headersOf(init.headers), { allowAuthorization: true }),
      body,
      anonymous: ctx.anonymous === true || origin !== baseOrigin,
      timeoutMs,
      integrationId,
      source: 'connection',
    })
    try {
      const outcome = await awaitJob(jobId, state.id, Date.now() + timeoutMs, { signal: init.signal ?? undefined, maxResponseBytes: MAX_RESPONSE_BODY_BYTES })
      const headers = new Headers()
      for (const [k, v] of Object.entries(outcome.headers)) { try { headers.set(k, v) } catch { /* invalid header from the target: dropped */ } }
      headers.set('x-usertasks-gateway-job', outcome.jobId)
      const noBody = NULL_BODY.has(outcome.status) || method === 'HEAD'
      return new Response(noBody ? null : new Uint8Array(outcome.body), { status: outcome.status, headers })
    } catch (error) {
      if (error instanceof GatewayQueueError) {
        if (error.code === 'cancelled' && init.signal?.aborted) throw init.signal.reason ?? error
        throw new GatewayUnavailableError(`Gateway "${state.name}": ${error.message}`, error.code)
      }
      throw error
    }
  }
  return markRemoteTransport(transport as typeof fetch)
}
