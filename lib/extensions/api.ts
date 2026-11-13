/**
 * Extension HTTP surfaces.
 *
 *  - REST: /api/v1/ext/<id>/<path> (app/api/v1/ext/[ext]/[...path]) runs the
 *    extension's defineEndpoint handlers through the standard apiRoute
 *    pipeline (Bearer API key / OAuth token, endpoint permission, zod
 *    params / query / body, `{ success, data }` envelope), after the
 *    workspace access check: 404 not installed, 403 not enabled, 402 not
 *    licensed. The endpoints are namespaced (/ext/<id>/…, operationId
 *    ext_<id>_<op>) and merged into the served OpenAPI document, so the API
 *    explorer, SDKs and `usertasks api` see them.
 *  - Public: /ext-public/<id>/<path> (app/ext-public/[ext]/[...path]) for
 *    inbound callbacks (receivers, webhooks). Only routes the manifest
 *    declares in capabilities.inbound_public_routes exist; each chooses its
 *    authentication (none = its own proof, api_key, or an HMAC signature
 *    with a workspace secret). Rate limited per extension and client, body
 *    capped, calls with a known workspace audited.
 *
 * Server-only.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { apiError, apiRoute } from '@/lib/api/route'
import type { EndpointDef } from '@/lib/api-schemas/registry'
import { validateApiKey } from '@/lib/api-auth'
import { fromApiAuth, requirePerm, isServiceError } from '@/lib/services/context'
import { rateLimit } from '@/lib/rate-limit'
import { writeAudit } from '@/lib/audit-log'
import { getServiceDb } from '@/lib/providers/db'
import type { ExtensionEndpoint, PublicRoute } from '@/lib/extensions/sdk'
import { createExtensionContext, readExtensionSecret } from './host'
import { extensionToolPrefix } from './manifest'
import { getExtensionManifest } from './registry'
import { getServerExtension, getServerExtensions } from './server-registry'
import { extensionAccess } from './state'

/* eslint-disable @typescript-eslint/no-explicit-any -- extension payloads */

const PUBLIC_BODY_LIMIT = 1024 * 1024
const PUBLIC_RATE = { max: 120, windowMs: 60_000 }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `/greetings/{id}` vs `/greetings/123` → { id: '123' } (null = no match). */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean)
  const b = path.split('/').filter(Boolean)
  if (a.length !== b.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < a.length; i++) {
    const m = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(a[i])
    if (m) {
      try { params[m[1]] = decodeURIComponent(b[i]) } catch { return null }
    } else if (a[i] !== b[i]) return null
  }
  return params
}

function findEndpoint(extensionId: string, method: string, path: string): { endpoint: ExtensionEndpoint; params: Record<string, string> } | { methodNotAllowed: true } | null {
  const server = getServerExtension(extensionId)
  let pathMatched = false
  for (const endpoint of server?.endpoints ?? []) {
    const params = matchPath(endpoint.endpoint.path, path)
    if (!params) continue
    pathMatched = true
    if (endpoint.endpoint.method === method) return { endpoint, params }
  }
  return pathMatched ? { methodNotAllowed: true } : null
}

/** REST dispatch for /api/v1/ext/<id>/<path>. */
export async function dispatchExtensionApi(request: NextRequest, extensionId: string, segments: string[]): Promise<NextResponse> {
  const path = `/${segments.join('/')}`
  const found = getExtensionManifest(extensionId) ? findEndpoint(extensionId, request.method, path) : null
  if (!found) return apiError(`No extension endpoint ${request.method} /ext/${extensionId}${path}`, 404, 'not_found')
  if ('methodNotAllowed' in found) return apiError(`Method ${request.method} not allowed`, 405, 'method_not_allowed')
  const { endpoint, params } = found
  const route = apiRoute(endpoint.endpoint, async ({ ctx, params: parsedParams, query, body, request: req }) => {
    const access = await extensionAccess(ctx.tenantId, extensionId)
    if (!access.usable) return apiError(access.reason ?? 'Extension not available', access.status === 200 ? 403 : access.status, access.code ?? 'extension_disabled', { extension_id: extensionId, state: access.entitlement.state, retryable: access.code === 'extension_licence_expired' })
    const extCtx = createExtensionContext({ extensionId, tenantId: ctx.tenantId, actorId: ctx.actorId ?? ctx.credentialOwnerId ?? null, db: ctx.supabase })
    const result = await endpoint.handler({ ctx: extCtx, params: parsedParams, query, body, request: req })
    if (result instanceof Response && !(result instanceof NextResponse)) {
      return new NextResponse(result.body, { status: result.status, headers: result.headers })
    }
    return result
  })
  return route(request, { params: Promise.resolve(params) })
}

/** Endpoint definitions as served in OpenAPI: namespaced path, operationId and tag. */
export function extensionEndpointDefs(): EndpointDef[] {
  const out: EndpointDef[] = []
  for (const server of getServerExtensions()) {
    const manifest = getExtensionManifest(server.id)
    if (!manifest) continue
    const prefix = extensionToolPrefix(server.id)
    for (const { endpoint } of server.endpoints ?? []) {
      out.push({
        ...endpoint,
        path: `/ext/${server.id}${endpoint.path}`,
        operationId: `${prefix}${endpoint.operationId}`,
        tags: [`Extension: ${manifest.name}`],
        extension: server.id,
        ...(endpoint.cli ? { cli: { ...endpoint.cli, resource: `ext-${server.id}-${endpoint.cli.resource}` } } : {}),
      })
    }
  }
  return out
}

/* ── Public routes ─────────────────────────────────────────────────── */

function clientKey(request: Request): string {
  return (request.headers.get('x-forwarded-for')?.split(',')[0] ?? request.headers.get('x-real-ip') ?? 'unknown').trim()
}

function signatureMatches(secret: string, body: string, header: string | null): boolean {
  if (!header) return false
  const presented = header.replace(/^sha256=/i, '').trim().toLowerCase()
  const expected = createHmac('sha256', secret).update(body).digest('hex')
  if (presented.length !== expected.length || !/^[0-9a-f]+$/.test(presented)) return false
  return timingSafeEqual(Buffer.from(presented, 'hex'), Buffer.from(expected, 'hex'))
}

function json(status: number, error: string, code: string) {
  return NextResponse.json({ success: false, error, code }, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** Dispatch for /ext-public/<id>/<path>. */
export async function dispatchPublicRoute(request: NextRequest, extensionId: string, segments: string[]): Promise<Response> {
  const path = `/${segments.join('/')}`
  const server = getExtensionManifest(extensionId) ? getServerExtension(extensionId) : null
  let route: PublicRoute | null = null
  let params: Record<string, string> = {}
  let pathMatched = false
  for (const candidate of server?.publicRoutes ?? []) {
    const match = matchPath(candidate.path, path)
    if (!match) continue
    pathMatched = true
    if (candidate.methods.includes(request.method as PublicRoute['methods'][number])) {
      route = candidate
      params = match
      break
    }
  }
  if (!route) return pathMatched ? json(405, 'Method not allowed', 'method_not_allowed') : json(404, 'Not found', 'not_found')

  const limited = await rateLimit(`ext-public:${extensionId}:${clientKey(request)}`, PUBLIC_RATE)
  if (!limited.ok) return json(429, 'Too many requests', 'rate_limited')

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > PUBLIC_BODY_LIMIT) return json(413, 'Body too large', 'payload_too_large')
  const body = ['GET', 'HEAD'].includes(request.method) ? '' : await request.text()
  if (body.length > PUBLIC_BODY_LIMIT) return json(413, 'Body too large', 'payload_too_large')

  let tenantId: string | null = null
  let actorId: string | null = null
  let db: unknown = getServiceDb()
  const auth = route.auth
  try {
    if (auth.kind === 'api_key') {
      const result = await validateApiKey(request)
      if (!result.success) return result.response
      const ctx = fromApiAuth(result)
      if (auth.permission) requirePerm(ctx, auth.permission)
      tenantId = ctx.tenantId
      actorId = ctx.actorId ?? ctx.credentialOwnerId ?? null
      db = ctx.supabase
    } else if (auth.kind === 'signature') {
      const tenant = new URL(request.url).searchParams.get(auth.tenantParam) ?? ''
      if (!UUID_RE.test(tenant)) return json(400, `Missing or invalid ?${auth.tenantParam}=<workspace id>`, 'invalid_request')
      const secret = await readExtensionSecret(extensionId, tenant, auth.secretKey)
      if (!secret || !signatureMatches(secret, body, request.headers.get(auth.header))) return json(401, 'Invalid signature', 'invalid_signature')
      tenantId = tenant
    }
  } catch (error) {
    if (isServiceError(error)) return json(error.status, error.message, error.code)
    throw error
  }
  if (tenantId) {
    const access = await extensionAccess(tenantId, extensionId)
    if (!access.usable) return json(access.status === 200 ? 403 : access.status, access.reason ?? 'Extension not available', access.code ?? 'extension_disabled')
  } else {
    // No workspace (auth: none): an instance licence that expired more than
    // 24 hours ago still stops the route. (No grant at all — e.g. cloud
    // workspace entitlements only — keeps the route answering as before.)
    const access = await extensionAccess(null, extensionId)
    if (access.code === 'extension_licence_expired') return json(402, access.reason ?? 'Extension licence expired', 'extension_licence_expired')
  }

  const ctx = createExtensionContext({ extensionId, tenantId, actorId, db })
  let response: Response
  try {
    response = await route.handler({ ctx, request, params, body })
  } catch (error) {
    console.error(`[ext:${extensionId}] public route ${route.path} failed:`, error)
    response = json(500, 'Internal server error', 'internal')
  }
  if (tenantId) {
    void writeAudit({
      supabase: getServiceDb() as any, tenantId, actorId, objectType: 'extension', objectId: extensionId, action: 'execute',
      summary: `Public route ${request.method} /ext-public/${extensionId}${path} → ${response.status}`,
      metadata: { extension: extensionId, route: route.path, auth: auth.kind, status: response.status },
    })
  }
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(response.body, { status: response.status, headers })
}
