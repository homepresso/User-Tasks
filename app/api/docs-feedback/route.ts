import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { rateLimit as countHit } from '@/lib/rate-limit'
import { isCloud, publicBaseUrl } from '@/lib/deployment'
import { contactDeliveryConfigured, deliverChirp, escapeHtml } from '@/lib/contact/chirpme'
import { getDocPage } from '@/lib/docs/registry'

/**
 * POST /api/docs-feedback — "Was this page helpful?" on the public docs
 * (components/docs/article-client.tsx). Deliberately open (signed-out
 * readers), cloud only, rate-limited per IP. Nothing is stored: the vote, the
 * page and an optional short comment go to the team's ChirpMe channel. No
 * name, email or IP is forwarded.
 */
const feedbackSchema = z.object({
  path: z.string().max(300).regex(/^\/docs(\/[a-z0-9/-]*)?$/),
  helpful: z.boolean(),
  comment: z.string().trim().max(500).optional(),
})

function isDocsPath(path: string): boolean {
  if (path === '/docs' || path === '/docs/api-explorer') return true
  return Boolean(getDocPage(path.replace(/^\/docs\//, '')))
}

export async function POST(request: NextRequest) {
  if (!isCloud()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  const limit = await countHit(`docs-feedback:${ip}`, { max: 20, windowMs: 60 * 60 * 1000 })
  if (!limit.ok) return NextResponse.json({ error: 'Too many feedback requests. Please try again later.' }, { status: 429 })

  const parsed = feedbackSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || !isDocsPath(parsed.data.path)) {
    return NextResponse.json({ error: 'Invalid feedback.' }, { status: 400 })
  }
  if (!contactDeliveryConfigured()) {
    // Readers still see their thanks; the vote is simply not forwarded.
    return NextResponse.json({ ok: true, delivered: false })
  }

  const { path, helpful, comment } = parsed.data
  const verdict = helpful ? 'helpful' : 'not helpful'
  const delivered = await deliverChirp({
    title: `Docs feedback: ${verdict}`,
    body: `${path} was marked ${verdict}${comment ? ' with a comment' : ''}.`,
    url: `${publicBaseUrl()}${path}`,
    detail: `<h2>Docs feedback</h2><p><strong>Page:</strong> ${escapeHtml(path)}</p><p><strong>Helpful:</strong> ${helpful ? 'Yes' : 'No'}</p>${comment ? `<h3>Comment</h3><p>${escapeHtml(comment).replace(/\n/g, '<br>')}</p>` : ''}`,
    notificationIcon: helpful ? 'thumb_up' : 'thumb_down',
    subTab: 'Docs feedback',
    subTabColor: '#B08A54',
  }, 'docs-feedback')
  return NextResponse.json({ ok: true, delivered: delivered.ok })
}
