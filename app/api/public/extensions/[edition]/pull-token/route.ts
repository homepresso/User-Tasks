import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { isCloud } from '@/lib/deployment'
import { editionById } from '@/lib/editions/catalog'
import { issuePullToken } from '@/lib/editions/pull-service'
import { defaultPullServiceDeps, requestIpHash } from '@/lib/editions/server'

/**
 * Licence-gated edition downloads (usertasks.com):
 *   POST /api/public/extensions/sharepoint/pull-token
 *   { licence, version?, purpose?, instance_id? } → a 30-minute, read-only
 *   credential for the usertasks.com registry front and the signed edition
 *   manifest (lib/editions/pull-service.ts has the full contract).
 *
 * Called by the one-line installers (install.sh / install.ps1), `usertasks
 * upgrade` and `usertasks bundle-download`. Cloud edition only (404
 * elsewhere). Anonymous: per-IP (20 an hour, 100 a day) and per-licence (30
 * an hour) limits and an hourly cap for everyone; a 64 KB body cap. Every
 * request is recorded in edition_pull_log (never the token or the licence).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const NO_STORE = { 'Cache-Control': 'no-store' }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } })
const MAX_BODY = 65_536

async function limited(keys: Array<readonly [string, number, number]>) {
  for (const [key, max, windowMs] of keys) {
    const hit = await rateLimit(key, { max, windowMs })
    if (!hit.ok) return json({ error: 'Too many download requests. Please try again later.', code: 'rate_limited' }, 429, { 'Retry-After': String(Math.max(1, Math.ceil(hit.retryAfterMs / 1000))) })
  }
  return null
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ edition: string }> }) {
  if (!isCloud()) return json({ error: 'Not found' }, 404)
  const edition = editionById((await ctx.params).edition)
  if (!edition) return json({ error: 'Unknown edition', code: 'not_found' }, 404)

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  const ipLimit = await limited([[`edition-token:h:${ip}`, 20, 3_600_000], [`edition-token:d:${ip}`, 100, 86_400_000], ['edition-token:all', 2_000, 3_600_000]])
  if (ipLimit) return ipLimit

  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return json({ error: 'Send the request as JSON', code: 'validation_error' }, 415)
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return json({ error: 'The request is too large', code: 'validation_error' }, 413)
  let body: Record<string, unknown>
  let raw: string
  try {
    raw = await request.text()
    if (raw.length > MAX_BODY) return json({ error: 'The request is too large', code: 'validation_error' }, 413)
    body = JSON.parse(raw) as Record<string, unknown>
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object')
  } catch {
    return json({ error: 'The request could not be read', code: 'validation_error' }, 400)
  }

  // Per licence: keyed by a hash of what was sent (the licence id is only trusted after verification).
  const licenceKey = createHash('sha256').update(typeof body.licence === 'string' ? body.licence.replace(/\s+/g, '') : JSON.stringify(body.licence ?? null)).digest('hex').slice(0, 32)
  const licenceLimit = await limited([[`edition-token:lic:${licenceKey}`, 30, 3_600_000]])
  if (licenceLimit) return licenceLimit

  try {
    const outcome = await issuePullToken(edition, body, { ipHash: requestIpHash(request.headers), userAgent: request.headers.get('user-agent') }, defaultPullServiceDeps(edition))
    return json(outcome.body, outcome.status)
  } catch (error) {
    console.error('[editions] pull-token failed', error instanceof Error ? error.message : error)
    return json({ error: 'The download could not be prepared. Please try again, or contact us.', code: 'internal' }, 500)
  }
}
