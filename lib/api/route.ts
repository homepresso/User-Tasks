/**
 * apiRoute(): the standard pipeline for /api/v1 route handlers.
 *
 *   validateApiKey → endpoint permission → ServiceContext → zod parse of
 *   params / query / body → handler → `{ success: true, data }` envelope
 *
 * Errors keep the legacy `{ success: false, error }` shape and add an optional
 * machine-readable `code` and structured `details` (zod issues for 400s).
 * Handlers throw ServiceError for expected failures; anything else is logged
 * and returned as a generic 500.
 *
 *   export const GET = apiRoute(getWorkflowEndpoint, async ({ ctx, params }) => ...)
 */

import { NextRequest, NextResponse } from 'next/server'
import type { z } from 'zod'
import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { prepareRoundTripBody, type EndpointDef, type MultipartOptions } from '@/lib/api-schemas/registry'
import { fromApiAuth, isServiceError, requirePerm, type ServiceContext } from '@/lib/services/context'
import { apiMaxBodyBytes, apiMaxPackageBodyBytes, bodyTooLargeMessage, readCappedBody } from '@/lib/api/body-limit'

type Parsed<S> = S extends z.ZodType ? z.output<S> : Record<string, never>

export interface ApiRouteInput<P, Q, B> {
  request: NextRequest
  auth: ApiKeySuccessResult
  ctx: ServiceContext
  params: Parsed<P>
  query: Parsed<Q>
  body: Parsed<B>
}

type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> }

/** Postgres "invalid input syntax for type uuid" (22P02), thrown or wrapped by dbError. */
export function isMalformedUuidError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null
  const message = typeof e?.message === 'string' ? e.message : ''
  return /invalid input syntax for type uuid/i.test(message) && (e?.code === undefined || e.code === '22P02')
}

export function apiError(message: string, status: number, code?: string, details?: unknown) {
  // A busy / timed-out answer (e.g. lib/services/data-table-guard) tells the client when to retry.
  const retryAfter = details && typeof details === 'object' ? Number((details as { retry_after?: unknown }).retry_after) : NaN
  return NextResponse.json(
    {
      success: false,
      error: message,
      ...(code ? { code } : {}),
      ...(details !== undefined ? { details } : {}),
    },
    { status, ...((status === 429 || status === 503) && Number.isFinite(retryAfter) && retryAfter > 0 ? { headers: { 'Retry-After': String(Math.ceil(retryAfter)) } } : {}) },
  )
}

export function validationError(where: string, error: z.ZodError) {
  const details = error.issues.map((issue) => ({
    path: [where, ...issue.path.map(String)].join('.'),
    message: issue.message,
    code: issue.code,
  }))
  const summary = error.issues.map((issue) => `${issue.path.join('.') || where}: ${issue.message}`).join(', ')
  return apiError(`Validation failed: ${summary}`, 400, 'validation_error', details)
}

/** URLSearchParams → plain object; repeated keys become arrays. */
export function searchParamsToObject(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [key, value] of params) {
    const existing = out[key]
    if (existing === undefined) out[key] = value
    else out[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
  }
  return out
}

/** The JSON body cap of an endpoint (EndpointDef.bodyLimit, lib/api/body-limit.ts). */
function bodyLimitOf(endpoint: Pick<EndpointDef, 'bodyLimit'>): number {
  return endpoint.bodyLimit === 'package' ? apiMaxPackageBodyBytes() : apiMaxBodyBytes()
}

/** A JSON body of at most `maxBytes`; `tooLarge` → 413. */
async function readJsonBody(request: NextRequest, maxBytes: number): Promise<{ ok: true; value: unknown } | { ok: false; tooLarge?: boolean }> {
  const body = await readCappedBody(request, maxBytes)
  if (!body.ok) return { ok: false, tooLarge: body.reason === 'too_large' }
  const text = body.text
  if (!text.trim()) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

/** multipart/form-data → the JSON body shape (see EndpointDef.multipart). */
async function readMultipartBody(request: NextRequest, options: MultipartOptions): Promise<{ ok: true; value: unknown } | { ok: false }> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return { ok: false }
  }
  const value: Record<string, unknown> = {}
  for (const [key, entry] of form.entries()) {
    const target = options.files[key]
    if (typeof entry === 'string') {
      if (!target) value[key] = entry
      continue
    }
    if (!target) continue
    value[target.name] = entry.name
    value[target.content] = Buffer.from(await entry.arrayBuffer()).toString('base64')
  }
  return { ok: true, value }
}

/**
 * Does the request ask for the async variant? `?async=true` or
 * `Prefer: respond-async` (RFC 7240).
 */
export function wantsAsync(request: Request): boolean {
  const url = new URL(request.url)
  const flag = url.searchParams.get('async')
  if (flag === 'true' || flag === '1') return true
  return (request.headers.get('prefer') ?? '').split(',').some((token) => token.trim().toLowerCase() === 'respond-async')
}

async function enqueueApiJob(request: NextRequest, endpoint: EndpointDef, ctx: ServiceContext, input: { params: unknown; query: unknown; body: unknown }) {
  const [{ enqueueUserJob }, { apiJobKind, INLINE_BODY_BYTES }] = await Promise.all([
    import('@/lib/user-jobs/runner'),
    import('@/lib/user-jobs/kinds/api'),
  ])
  const query = { ...(input.query as Record<string, unknown>) }
  delete query.async
  const bodyJson = endpoint.body ? JSON.stringify(input.body ?? {}) : ''
  const large = bodyJson.length > INLINE_BODY_BYTES
  const job = await enqueueUserJob(ctx, apiJobKind(endpoint.operationId), {
    params: input.params, query, ...(!endpoint.body ? {} : large ? { body_in_input: true } : { body: input.body }),
  }, {
    ...(large ? { input: new TextEncoder().encode(bodyJson) } : {}),
    idempotencyKey: request.headers.get('idempotency-key'),
  })
  return NextResponse.json({ success: true, data: { job } }, {
    status: 202,
    headers: { Location: `/api/v1/jobs/${job.id}`, 'Preference-Applied': 'respond-async', 'Retry-After': '2' },
  })
}

export function apiRoute<
  P extends z.ZodType | undefined,
  Q extends z.ZodType | undefined,
  B extends z.ZodType | undefined,
  R extends z.ZodType | undefined,
>(
  endpoint: EndpointDef<P, Q, B, R>,
  handler: (input: ApiRouteInput<P, Q, B>) => Promise<unknown>,
) {
  return async function route(request: NextRequest, context?: RouteContext): Promise<NextResponse> {
    const auth = await validateApiKey(request)
    if (!auth.success) return auth.response

    const ctx = fromApiAuth(auth)
    try {
      if (endpoint.permission) requirePerm(ctx, endpoint.permission)

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
        const multipart = endpoint.multipart && /^multipart\/form-data/i.test(request.headers.get('content-type') ?? '')
        const maxBytes = bodyLimitOf(endpoint)
        const raw = multipart ? await readMultipartBody(request, endpoint.multipart!) : await readJsonBody(request, maxBytes)
        if (!raw.ok && 'tooLarge' in raw && raw.tooLarge) {
          return apiError(bodyTooLargeMessage(maxBytes, { tier: endpoint.bodyLimit ?? 'default', multipart: Boolean(endpoint.multipart) }), 413, 'payload_too_large', { max_bytes: maxBytes })
        }
        if (!raw.ok) return apiError(multipart ? 'Invalid multipart body' : 'Invalid JSON body', 400, multipart ? 'invalid_body' : 'invalid_json')
        const input = endpoint.roundTrip ? prepareRoundTripBody(endpoint.body, endpoint.roundTrip, raw.value) : raw.value
        const parsed = endpoint.body.safeParse(input)
        if (!parsed.success) return validationError('body', parsed.error)
        body = parsed.data
      }

      // Endpoints with an async variant (endpoint.async): the validated input
      // becomes a background job (`api.<operationId>`,
      // lib/user-jobs/kinds/api.ts, which holds the same handler) → 202.
      if (endpoint.async && wantsAsync(request)) {
        return await enqueueApiJob(request, endpoint as EndpointDef, ctx, { params, query, body })
      }

      const result = await handler({
        request,
        auth,
        ctx,
        params: params as Parsed<P>,
        query: query as Parsed<Q>,
        body: body as Parsed<B>,
      })
      if (result instanceof NextResponse) return result
      return NextResponse.json({ success: true, data: result ?? null }, { status: endpoint.successStatus ?? 200 })
    } catch (error) {
      if (isServiceError(error)) return apiError(error.message, error.status, error.code, error.details)
      // A malformed id in the path or body (Postgres 22P02 on a uuid column)
      // can't match anything: 404, not a 500 with a stack trace in the logs.
      if (isMalformedUuidError(error)) return apiError('Not found (malformed id)', 404, 'not_found')
      console.error(`[api] ${endpoint.method} ${endpoint.path} failed:`, error)
      return apiError('Internal server error', 500, 'internal')
    }
  }
}
