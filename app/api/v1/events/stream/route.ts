import { NextResponse } from 'next/server'
import { apiRoute } from '@/lib/api/route'
import { streamEventsEndpoint } from '@/lib/api-schemas/events'
import { createEventStream, SSE_HEADERS } from '@/lib/log-export/sse'
import { eventsClient, latestEventId, listEvents, resolveEventFilters, resolveTimestamp, splitList, type EventFilters } from '@/lib/services/events'
import { ServiceError } from '@/lib/services/context'

// Long-lived response: the stream ends itself (with an `event: reconnect`
// hint) STREAM_END_MARGIN_MS before this limit so clients resume cleanly.
export const maxDuration = 300
export const dynamic = 'force-dynamic'

const STREAM_END_MARGIN_MS = 10_000
const PAGE_SIZE = 500

/** GET /api/v1/events/stream (Server-Sent Events) */
export const GET = apiRoute(streamEventsEndpoint, async ({ request, ctx, query }) => {
  const filters: EventFilters = {
    categories: splitList(query.category),
    types: splitList(query.type),
    min_severity: query.severity,
    workflow_id: query.workflow_id,
    run_id: query.run_id,
    task_id: query.task_id,
    trace_id: query.trace_id,
  }
  // Validate filters and permissions before the 200 goes out.
  resolveEventFilters(ctx, filters)
  // Resolved once: a relative `since` (15m) must not slide with each poll.
  const since = query.since ? resolveTimestamp(query.since, 'since') : undefined

  const lastEventId = request.headers.get('last-event-id')?.trim()
  if (lastEventId && !/^\d{1,19}$/.test(lastEventId)) throw ServiceError.validation('Last-Event-ID must be an event id')
  const resumeFrom = lastEventId || query.after || null
  const supabase = await eventsClient(ctx)
  // No resume point and no `since`: start live, from the newest event.
  const after = resumeFrom ?? (since ? null : String(await latestEventId(ctx, supabase)))

  const stream = createEventStream({
    after,
    signal: request.signal,
    maxMs: maxDuration * 1000 - STREAM_END_MARGIN_MS,
    fetchPage: (cursor) => listEvents(ctx, { ...filters, since, after: cursor, limit: PAGE_SIZE }),
    onError: (error) => console.error('[api] GET /events/stream read failed:', error),
  })
  return new NextResponse(stream, { status: 200, headers: SSE_HEADERS })
})
