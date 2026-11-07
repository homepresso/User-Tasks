import { NextResponse, type NextRequest } from 'next/server'
import { isServiceError, ServiceError, type ServiceContext } from '@/lib/services/context'
import type { ResolvedAnonymousForm } from '@/lib/services/anonymous-forms'

/**
 * The public form endpoints (app/api/public/forms/[token]/*): the ONLY
 * server surface an anonymous visitor of /p/<token> reaches. Each one
 * resolves the token first (every failure is the same 404), builds the
 * anonymous context (lib/services/anonymous-forms.ts), counts the request
 * against the per-IP limit, and calls one service with the form id the
 * TOKEN resolved to — never one from the request. No cookies are read.
 */

export const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' }

/** The visitor's IP as the platform's proxy reports it (Vercel / the reverse proxy sets x-forwarded-for). */
export function visitorIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  return (forwarded?.split(',')[0] ?? request.headers.get('x-real-ip') ?? 'unknown').trim() || 'unknown'
}

export function publicError(error: unknown, fallback: string, label: string) {
  if (isServiceError(error)) {
    const details = error.details as { fields?: Record<string, string>; retry_after_ms?: number; captcha?: boolean } | undefined
    const headers: Record<string, string> = { ...NO_STORE }
    if (error.code === 'rate_limited' && details?.retry_after_ms) headers['Retry-After'] = String(Math.max(1, Math.ceil(details.retry_after_ms / 1000)))
    return NextResponse.json({
      error: error.message, code: error.code,
      ...(details?.fields ? { fields: details.fields } : {}),
      ...(details?.captcha ? { captcha: true } : {}),
    }, { status: error.status, headers })
  }
  console.error(`[public-forms.${label}]`, error)
  return NextResponse.json({ error: fallback }, { status: 500, headers: NO_STORE })
}

/** Read a JSON body of at most `maxBytes` (413 above, 415 for anything but JSON). */
export async function readJson(request: NextRequest, maxBytes: number): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new ServiceError('validation_error', 'Expected application/json', { status: 415 })
  }
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > maxBytes) throw new ServiceError('validation_error', 'Request too large', { status: 413 })
  const raw = await request.text().catch(() => '')
  if (raw.length > maxBytes) throw new ServiceError('validation_error', 'Request too large', { status: 413 })
  try { return JSON.parse(raw) } catch { throw ServiceError.validation('Invalid request') }
}

/** Resolve the link and build the visitor's context (404 for every unavailable link), then the per-IP read limit. */
export async function anonymousRequest(request: NextRequest, token: string): Promise<{ ctx: ServiceContext; resolved: ResolvedAnonymousForm }> {
  const svc = await import('@/lib/services/anonymous-forms')
  const resolved = await svc.resolveAnonymousForm(token)
  if (!resolved) throw ServiceError.notFound('This form is not available')
  const ctx = await svc.anonymousContext(resolved, { ip: visitorIp(request), uploadKey: request.headers.get('x-upload-key') })
  await svc.limitAnonymousReads(ctx)
  return { ctx, resolved }
}
