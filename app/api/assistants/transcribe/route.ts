import { NextRequest, NextResponse } from 'next/server'
import { getCachedUser } from '@/lib/supabase/server'
import { fromSession, isServiceError } from '@/lib/services/context'
import { rateLimit } from '@/lib/rate-limit'
import { DICTATION_LIMITS, isDictationAudioType, normalizeLanguage } from '@/lib/assistants/dictation'

export const maxDuration = 60

/**
 * The Agent's dictation with the workspace's transcription provider: POST the
 * recording as the raw body (Content-Type: the recorder's audio type, e.g.
 * audio/webm;codecs=opus or audio/mp4) and an optional `language` query
 * parameter (the person's browser language; the admin's setting wins).
 * Answers { text }. Only for people the Agent is available to, when dictation
 * uses a provider; at most DICTATION_LIMITS.maxBytes, a few recordings a
 * minute per person. The audio is held in memory for the provider call only —
 * never stored, never logged.
 */
export async function POST(request: NextRequest) {
  const user = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tooLarge = () => NextResponse.json({ error: `Recordings are limited to ${DICTATION_LIMITS.maxBytes / 1024 / 1024} MB (about ${DICTATION_LIMITS.maxSeconds / 60} minutes)` }, { status: 413 })
  if (Number(request.headers.get('content-length') ?? 0) > DICTATION_LIMITS.maxBytes) return tooLarge()
  const type = request.headers.get('content-type') ?? ''
  if (!isDictationAudioType(type)) return NextResponse.json({ error: 'Send the recording as audio (webm, mp4, ogg, mpeg or wav)' }, { status: 415 })
  try {
    const ctx = await fromSession()
    const limited = await rateLimit(`assistant:transcribe:${ctx.tenantId}:${ctx.actorId}`, { max: DICTATION_LIMITS.perMinute, windowMs: 60_000 })
    if (!limited.ok) return NextResponse.json({ error: 'Too many recordings — wait a moment' }, { status: 429 })
    const bytes = await readCapped(request, DICTATION_LIMITS.maxBytes)
    if (bytes === 'too_large') return tooLarge()
    if (!bytes.byteLength) return NextResponse.json({ error: 'The recording is empty' }, { status: 400 })
    const language = normalizeLanguage(request.nextUrl.searchParams.get('language'))
    const { transcribeDictation } = await import('@/lib/services/assistants')
    const result = await transcribeDictation(ctx, { bytes, mime_type: type }, language)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[assistants] transcription failed', (error as Error)?.name)
    return NextResponse.json({ error: 'The recording could not be transcribed' }, { status: 500 })
  }
}

/** The body, stopping as soon as it passes `max` bytes (a missing / wrong Content-Length can't get around the cap). */
async function readCapped(request: Request, max: number): Promise<Uint8Array | 'too_large'> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) { await reader.cancel().catch(() => undefined); return 'too_large' }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength }
  return out
}
