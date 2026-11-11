import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { rateLimit as countHit } from '@/lib/rate-limit'
import { isCloud, publicBaseUrl } from '@/lib/deployment'
import { contactDeliveryConfigured, deliverChirp, escapeHtml } from '@/lib/contact/chirpme'

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  company: z.string().trim().min(2).max(160),
  comments: z.string().trim().min(10).max(5000),
  website: z.string().max(0).optional(),
})

export async function POST(request: NextRequest) {
  if (!isCloud()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  const rateLimit = await countHit(`public-contact:${ip}`, { max: 5, windowMs: 60 * 60 * 1000 })
  if (!rateLimit.ok) {
    return NextResponse.json({ error: 'Too many contact requests. Please try again later.' }, { status: 429 })
  }

  const parsed = contactSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please complete every field with valid information.' }, { status: 400 })
  }

  if (!contactDeliveryConfigured()) {
    console.error('[contact] CHIRPME_API_KEY / CHIRPME_CHANNEL_ID is not configured')
    return NextResponse.json({ error: 'Contact delivery is temporarily unavailable.' }, { status: 503 })
  }

  const { name, email, company, comments } = parsed.data
  const delivered = await deliverChirp({
    title: `New UserTasks contact — ${name}`,
    body: `${name} from ${company} (${email}) sent a website enquiry.`,
    url: `${publicBaseUrl()}/contact`,
    detail: `<h2>New website enquiry</h2><p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${escapeHtml(email)}</p><p><strong>Company:</strong> ${escapeHtml(company)}</p><h3>Comments</h3><p>${escapeHtml(comments).replace(/\n/g, '<br>')}</p>`,
  })
  if (!delivered.ok) {
    return NextResponse.json({ error: 'We could not deliver your message. Please try again.' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
