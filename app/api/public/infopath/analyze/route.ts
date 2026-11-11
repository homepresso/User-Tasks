import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { isCloud } from '@/lib/deployment'
import { InfoPathFileError } from '@/lib/infopath/archive'
import { PUBLIC_INFOPATH_LIMITS, publicInfoPathSummary } from '@/lib/infopath/public-summary'

/**
 * POST /api/public/infopath/analyze — the marketing site's "Migrate from
 * InfoPath" preview. Anonymous, analyze-only:
 *
 *  - cloud edition only (404 elsewhere, like the rest of the public site);
 *  - per-IP limits (6 a minute, 30 an hour) and an instance-wide hourly cap;
 *  - multipart `file` up to 4 MB (checked from Content-Length before the body
 *    is read, then from the file), the analyzer's zip-bomb caps lowered for
 *    anonymous use, safe XML only, an 8 s budget;
 *  - a honeypot field (`website`) that must stay empty;
 *  - nothing is stored and only a derived summary is returned
 *    (lib/infopath/public-summary.ts); the log line holds counts, never
 *    names or content.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const NO_STORE = { 'Cache-Control': 'no-store' }
const deny = (error: string, status: number, headers: Record<string, string> = {}) => NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...headers } })

export async function POST(request: NextRequest) {
  if (!isCloud()) return deny('Not found', 404)
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  for (const [key, max, windowMs] of [[`infopath-preview:m:${ip}`, 6, 60_000], [`infopath-preview:h:${ip}`, 30, 3_600_000], ['infopath-preview:all', 600, 3_600_000]] as const) {
    const hit = await rateLimit(key, { max, windowMs })
    if (!hit.ok) return deny('Too many previews from here. Please wait a few minutes and try again.', 429, { 'Retry-After': String(Math.max(1, Math.ceil(hit.retryAfterMs / 1000))) })
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) return deny('Upload the .xsn file as multipart/form-data', 415)
  const length = Number(request.headers.get('content-length') ?? 0)
  if (!length || length > PUBLIC_INFOPATH_LIMITS.maxInputBytes + 32 * 1024) return deny('The file must be 4 MB or smaller. Zip only the form\'s source files and try the .zip.', 413)

  let form: FormData
  try { form = await request.formData() } catch { return deny('The upload could not be read', 400) }
  const honeypot = form.get('website')
  if (typeof honeypot === 'string' && honeypot.trim()) return deny('The upload could not be read', 400)
  const file = form.get('file')
  if (!file || typeof file === 'string') return deny('Choose an .xsn file', 400)
  if (file.size > PUBLIC_INFOPATH_LIMITS.maxInputBytes) return deny('The file must be 4 MB or smaller', 413)

  const started = Date.now()
  try {
    const summary = publicInfoPathSummary(new Uint8Array(await file.arrayBuffer()), (file.name || 'form.xsn').slice(0, 120))
    console.info('[infopath.public] analysed', { bytes: file.size, views: summary.counts.views, fields: summary.counts.fields, rules: summary.counts.rules.total, ms: Date.now() - started })
    return NextResponse.json({ summary }, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof InfoPathFileError) {
      console.info('[infopath.public] refused', { bytes: file.size, code: error.code, ms: Date.now() - started })
      return deny(error.message, error.code === 'limit' ? 413 : 422)
    }
    console.error('[infopath.public] failed', { bytes: file.size, ms: Date.now() - started })
    return deny('This file could not be analysed', 422)
  }
}
