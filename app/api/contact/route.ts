import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { rateLimit as countHit } from '@/lib/rate-limit'
import { isCloud, publicBaseUrl } from '@/lib/deployment'

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  company: z.string().trim().min(2).max(160),
  comments: z.string().trim().min(10).max(5000),
  website: z.string().max(0).optional(),
})

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]!)
}

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

  const apiKey = process.env.CHIRPME_API_KEY?.trim()
  const channelId = process.env.CHIRPME_CHANNEL_ID?.trim()
  if (!apiKey || !channelId) {
    console.error('[contact] CHIRPME_API_KEY / CHIRPME_CHANNEL_ID is not configured')
    return NextResponse.json({ error: 'Contact delivery is temporarily unavailable.' }, { status: 503 })
  }

  const { name, email, company, comments } = parsed.data
  const appUrl = publicBaseUrl()
  const response = await fetch('https://chirpme.app/api/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channelId,
      title: `New UserTasks contact — ${name}`,
      body: `${name} from ${company} (${email}) sent a website enquiry.`,
      url: `${appUrl}/contact`,
      detail: `<h2>New website enquiry</h2><p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${escapeHtml(email)}</p><p><strong>Company:</strong> ${escapeHtml(company)}</p><h3>Comments</h3><p>${escapeHtml(comments).replace(/\n/g, '<br>')}</p>`,
      badge: 1,
      sound: 'default',
      priority: 'high',
      notificationIcon: 'contact_mail',
      notificationIconType: 'material',
      suggestedSubTab: 'Leads',
      suggestedSubTabColor: '#22D3EE',
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch((error) => {
    console.error('[contact] ChirpMe request failed', error)
    return null
  })

  if (!response?.ok) {
    console.error('[contact] ChirpMe rejected request', response?.status)
    return NextResponse.json({ error: 'We could not deliver your message. Please try again.' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
