import { NextResponse, type NextRequest } from 'next/server'
import { fromSession, isServiceError } from '@/lib/services/context'
import { SSE_HEADERS } from '@/lib/log-export/sse'
import { authorizeSubscriptions, loadAudience, MAX_SUBSCRIPTIONS } from '@/lib/realtime/authorize'
import { getRealtimeHub } from '@/lib/realtime/hub'
import { createRealtimeStream } from '@/lib/realtime/stream'

/**
 * Realtime change notifications for the SSE realtime provider
 * (REALTIME_PROVIDER=sse; lib/providers/realtime/sse.ts).
 *
 *   GET /api/internal/realtime?s=<subscription key>&s=…
 *
 * Session cookie auth. One connection per browser tab carries every
 * subscription the tab's hooks hold (keys from lib/realtime/topics). Events
 * carry ids only, filtered per subscriber by the same tenant/user rules as
 * the tables' SELECT policies; the client refetches through the normal read
 * APIs. Resume with Last-Event-ID (or `after`). See lib/realtime/stream.ts
 * for the message format.
 */

// Long-lived response: the stream ends itself (`event: reconnect`) before the
// limit and EventSource reconnects with Last-Event-ID.
export const maxDuration = 300
export const dynamic = 'force-dynamic'

const STREAM_END_MARGIN_MS = 10_000
/** Open streams per user on this instance (each tab holds one). */
const MAX_STREAMS_PER_USER = 12
const openStreams = new Map<string, number>()

const NO_STORE = { 'Cache-Control': 'no-store' }

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE })
}

export async function GET(request: NextRequest) {
  const keys = request.nextUrl.searchParams.getAll('s')
  if (keys.length === 0) return fail(400, 'No subscriptions')
  if (keys.length > MAX_SUBSCRIPTIONS) return fail(400, `At most ${MAX_SUBSCRIPTIONS} subscriptions`)

  const resume = request.headers.get('last-event-id')?.trim() || request.nextUrl.searchParams.get('after')?.trim() || ''
  if (resume && !/^\d{1,16}$/.test(resume)) return fail(400, 'Last-Event-ID must be a timestamp')

  let ctx
  try {
    ctx = await fromSession()
  } catch (error) {
    if (isServiceError(error)) return fail(error.status, error.message)
    throw error
  }
  const userId = ctx.actorId
  if (!userId) return fail(401, 'Not authenticated')
  const db = ctx.db ?? ctx.supabase

  if ((openStreams.get(userId) ?? 0) >= MAX_STREAMS_PER_USER) return fail(429, 'Too many realtime connections')

  const { accepted, rejected } = await authorizeSubscriptions({ userId, permissions: ctx.permissions, db }, keys)
  const audience = await loadAudience(db, userId)

  openStreams.set(userId, (openStreams.get(userId) ?? 0) + 1)
  const stream = createRealtimeStream({
    hub: getRealtimeHub(),
    subscriptions: accepted,
    rejected,
    audience,
    refreshAudience: () => loadAudience(db, userId),
    lastEventId: resume ? Number(resume) : null,
    signal: request.signal,
    maxMs: maxDuration * 1000 - STREAM_END_MARGIN_MS,
    onClose: () => {
      const n = (openStreams.get(userId) ?? 1) - 1
      if (n <= 0) openStreams.delete(userId)
      else openStreams.set(userId, n)
    },
  })
  return new NextResponse(stream, { status: 200, headers: SSE_HEADERS })
}
