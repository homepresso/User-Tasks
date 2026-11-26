import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { isCloud } from '@/lib/deployment'
import { clientIp } from '@/lib/client-ip'

/**
 * POST /api/public/pdf/analyze — the marketing site's "Try a PDF form"
 * preview. Anonymous, analyze-only, like /api/public/infopath/analyze:
 *
 *  - cloud edition only (404 elsewhere);
 *  - per-IP limits (6 a minute, 30 an hour) and an instance-wide hourly cap;
 *  - multipart `file` up to 4 MB (Content-Length checked before the body is
 *    read), 20 pages, a 12 s budget; scripts in the PDF are never run;
 *  - a honeypot field (`website`) that must stay empty;
 *  - nothing is stored, no AI is used, and only a derived summary is returned
 *    (lib/importers/pdf/public-summary.ts) — with the styling preview's small
 *    inline images (size-capped, never stored); the log line holds counts only.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const NO_STORE = { 'Cache-Control': 'no-store' }
const deny = (error: string, status: number, headers: Record<string, string> = {}) => NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...headers } })

export async function POST(request: NextRequest) {
  if (!isCloud()) return deny('Not found', 404)
  const ip = clientIp(request) ?? 'unknown'
  for (const [key, max, windowMs] of [[`pdf-preview:m:${ip}`, 6, 60_000], [`pdf-preview:h:${ip}`, 30, 3_600_000], ['pdf-preview:all', 600, 3_600_000]] as const) {
    const hit = await rateLimit(key, { max, windowMs })
    if (!hit.ok) return deny('Too many previews from here. Please wait a few minutes and try again.', 429, { 'Retry-After': String(Math.max(1, Math.ceil(hit.retryAfterMs / 1000))) })
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) return deny('Upload the PDF as multipart/form-data', 415)
  const { PUBLIC_PDF_LIMITS, PdfImportError } = await import('@/lib/importers/pdf/load')
  const length = Number(request.headers.get('content-length') ?? 0)
  if (!length || length > PUBLIC_PDF_LIMITS.maxInputBytes + 32 * 1024) return deny('The PDF must be 4 MB or smaller.', 413)

  let form: FormData
  try { form = await request.formData() } catch { return deny('The upload could not be read', 400) }
  const honeypot = form.get('website')
  if (typeof honeypot === 'string' && honeypot.trim()) return deny('The upload could not be read', 400)
  const file = form.get('file')
  if (!file || typeof file === 'string') return deny('Choose a PDF file', 400)
  if (file.size > PUBLIC_PDF_LIMITS.maxInputBytes) return deny('The PDF must be 4 MB or smaller', 413)

  const started = Date.now()
  try {
    const { analyzePdf } = await import('@/lib/importers/pdf/analyze')
    const { publicPdfSummary } = await import('@/lib/importers/pdf/public-summary')
    // Styling in 'public' mode: small inline images in the answer only — nothing is stored.
    const analysis = await analyzePdf(new Uint8Array(await file.arrayBuffer()), (file.name || 'form.pdf').replace(/[\\/]/g, '_').slice(0, 120), PUBLIC_PDF_LIMITS, { styling: { images: 'public' } })
    const summary = publicPdfSummary(analysis)
    console.info('[pdf.public] analysed', { bytes: file.size, kind: summary.kind, pages: summary.pages, fields: summary.counts.fields, rules: summary.counts.rules, ms: Date.now() - started })
    return NextResponse.json({ summary }, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof PdfImportError) {
      console.info('[pdf.public] refused', { bytes: file.size, code: error.code, ms: Date.now() - started })
      return deny(error.message, error.code === 'limit' ? 413 : 422)
    }
    console.error('[pdf.public] failed', { bytes: file.size, ms: Date.now() - started })
    return deny('This PDF could not be analysed', 422)
  }
}
