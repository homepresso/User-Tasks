import { NextRequest, NextResponse, after } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { isCloud } from '@/lib/deployment'
import { defaultTrialDeps, requestTrial, trialsAvailable } from '@/lib/licensing/trial-service'
import { TRIALS_UNAVAILABLE_MESSAGE } from '@/lib/licensing/trial-issuer'

/**
 * Self-serve 30-day trials of UserTasks for SharePoint Server (usertasks.com).
 *
 *   GET  → { available } — the site and installations check before showing the form.
 *   POST → JSON { name, email, company, farm_id | request_code, accept_terms,
 *          source?, website (honeypot) } → { licence, licence_id, farm_id,
 *          expires_at, existing, message } (lib/licensing/trial-service.ts).
 *
 * Cloud edition only (404 elsewhere). Anonymous: per-IP limits (5 an hour,
 * 20 a day) and an hourly cap for everyone, a honeypot field that must stay
 * empty, a 16 KB body cap. Called by the website's form and, server to
 * server, by self-hosted installations starting a trial online. Until the
 * trial key and migration are in place: 503 trials_unavailable.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const NO_STORE = { 'Cache-Control': 'no-store' }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } })

export async function GET() {
  if (!isCloud()) return json({ error: 'Not found' }, 404)
  const available = await defaultTrialDeps(() => undefined).then(trialsAvailable).catch(() => ({ available: false }))
  return json({ available: available.available, ...(available.available ? {} : { message: TRIALS_UNAVAILABLE_MESSAGE }) })
}

export async function POST(request: NextRequest) {
  if (!isCloud()) return json({ error: 'Not found' }, 404)
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  for (const [key, max, windowMs] of [[`trial:h:${ip}`, 5, 3_600_000], [`trial:d:${ip}`, 20, 86_400_000], ['trial:all', 300, 3_600_000]] as const) {
    const hit = await rateLimit(key, { max, windowMs })
    if (!hit.ok) return json({ error: 'Too many trial requests from here. Please try again later.', code: 'rate_limited' }, 429, { 'Retry-After': String(Math.max(1, Math.ceil(hit.retryAfterMs / 1000))) })
  }
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return json({ error: 'Send the form as JSON', code: 'validation_error' }, 415)
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > 16_384) return json({ error: 'The request is too large', code: 'validation_error' }, 413)
  let body: Record<string, unknown>
  try {
    const raw = await request.text()
    if (raw.length > 16_384) return json({ error: 'The request is too large', code: 'validation_error' }, 413)
    body = JSON.parse(raw) as Record<string, unknown>
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object')
  } catch {
    return json({ error: 'The request could not be read', code: 'validation_error' }, 400)
  }
  // Honeypot: bots fill it, people never see it. Look like a refusal, never issue.
  if (typeof body.website === 'string' && body.website.trim()) return json({ error: 'The request could not be read', code: 'validation_error' }, 400)

  try {
    const outcome = await requestTrial({ ...body, ip }, await defaultTrialDeps((fn) => after(fn)))
    return json(outcome.body, outcome.status)
  } catch (error) {
    console.error('[trials] request failed', error instanceof Error ? error.message : error)
    return json({ error: 'The trial could not be started. Please try again, or contact us.', code: 'internal' }, 500)
  }
}
