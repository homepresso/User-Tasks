/**
 * instanceAdminRoute(): the pipeline of the instance-level /api/v1/admin/*
 * endpoints (auth: 'instance_admin'). Like apiRoute, but the only accepted
 * credential is the instance admin token (lib/admin/instance-admin-token):
 *
 *   token configured? (no → 404, the endpoints don't exist)
 *   → per-IP rate limit (429)
 *   → Authorization: Bearer <INSTANCE_ADMIN_TOKEN> (none → 401; anything
 *     else, including a valid workspace API key or OAuth token → 403;
 *     failures are rate limited per IP separately)
 *   → zod parse of params / query / body → handler → `{ success: true, data }`
 *
 * No workspace context is built from the request: the handler gets the
 * service database client and acts at the instance level.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { z } from 'zod'
import { isInstanceAdminToken, instanceAdminToken } from '@/lib/admin/instance-admin-token'
import type { EndpointDef } from '@/lib/api-schemas/registry'
import { rateLimit } from '@/lib/rate-limit'
import { clientIp } from '@/lib/scim/tokens'
import { isServiceError } from '@/lib/services/context'
import { apiError, searchParamsToObject, validationError } from './route'

type Parsed<S> = S extends z.ZodType ? z.output<S> : Record<string, never>
type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> }

export interface InstanceAdminRouteInput<P, B, Q = undefined> {
  request: NextRequest
  params: Parsed<P>
  query: Parsed<Q>
  body: Parsed<B>
  /** The caller's IP as the rate limiter saw it (for the audit trail). */
  ip: string
}

/** Requests per IP per minute, and failed authentications per IP per 10 minutes. */
export const INSTANCE_ADMIN_LIMITS = { requestsPerMinute: 30, failuresPer10Minutes: 10 }

function retryAfter(ms: number): Record<string, string> {
  return { 'Retry-After': String(Math.max(1, Math.ceil(ms / 1000))) }
}

function tooMany(ms: number) {
  const res = apiError('Too many requests', 429, 'rate_limited')
  for (const [k, v] of Object.entries(retryAfter(ms))) res.headers.set(k, v)
  return res
}

export function instanceAdminRoute<
  P extends z.ZodType | undefined,
  Q extends z.ZodType | undefined,
  B extends z.ZodType | undefined,
  R extends z.ZodType | undefined,
>(
  endpoint: EndpointDef<P, Q, B, R>,
  handler: (input: InstanceAdminRouteInput<P, B, Q>) => Promise<unknown>,
) {
  if (endpoint.auth !== 'instance_admin') throw new Error(`${endpoint.operationId}: instanceAdminRoute needs auth: 'instance_admin'`)

  return async function route(request: NextRequest, context?: RouteContext): Promise<NextResponse> {
    // Off unless the operator configured a token: indistinguishable from a missing route.
    if (!instanceAdminToken()) return apiError('Not found', 404, 'not_found')

    const ip = clientIp(request)
    const limited = await rateLimit(`instance-admin:req:${ip}`, { max: INSTANCE_ADMIN_LIMITS.requestsPerMinute, windowMs: 60_000 })
    if (!limited.ok) return tooMany(limited.retryAfterMs)

    const header = request.headers.get('authorization') ?? ''
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
    if (!match || !isInstanceAdminToken(match[1])) {
      const failures = await rateLimit(`instance-admin:fail:${ip}`, { max: INSTANCE_ADMIN_LIMITS.failuresPer10Minutes, windowMs: 10 * 60_000 })
      if (!failures.ok) return tooMany(failures.retryAfterMs)
      console.warn(`[instance-admin] rejected ${endpoint.method} /api/v1${endpoint.path} from ${ip}: ${match ? 'not the instance admin token' : 'no bearer token'}`)
      if (!match) {
        const res = apiError('The instance admin token is required (Authorization: Bearer <INSTANCE_ADMIN_TOKEN>)', 401, 'unauthorized')
        res.headers.set('WWW-Authenticate', 'Bearer realm="usertasks-instance-admin"')
        return res
      }
      return apiError('Forbidden: this operation needs the instance admin token; workspace API keys and OAuth tokens cannot use it', 403, 'forbidden')
    }

    try {
      let params: unknown = {}
      if (endpoint.params) {
        const parsed = endpoint.params.safeParse((await context?.params) ?? {})
        if (!parsed.success) return validationError('params', parsed.error)
        params = parsed.data
      }
      let query: unknown = {}
      if (endpoint.query) {
        const parsed = endpoint.query.safeParse(searchParamsToObject(request.nextUrl.searchParams))
        if (!parsed.success) return validationError('query', parsed.error)
        query = parsed.data
      }
      let body: unknown = {}
      if (endpoint.body) {
        const text = await request.text()
        let raw: unknown = {}
        if (text.trim()) {
          try {
            raw = JSON.parse(text)
          } catch {
            return apiError('Invalid JSON body', 400, 'invalid_json')
          }
        }
        const parsed = endpoint.body.safeParse(raw)
        if (!parsed.success) return validationError('body', parsed.error)
        body = parsed.data
      }
      const result = await handler({ request, params: params as Parsed<P>, query: query as Parsed<Q>, body: body as Parsed<B>, ip })
      if (result instanceof NextResponse) return result
      return NextResponse.json({ success: true, data: result ?? null }, { status: endpoint.successStatus ?? 200 })
    } catch (error) {
      if (isServiceError(error)) return apiError(error.message, error.status, error.code, error.details)
      console.error(`[instance-admin] ${endpoint.method} ${endpoint.path} failed:`, error)
      return apiError('Internal server error', 500, 'internal')
    }
  }
}
