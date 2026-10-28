/**
 * Server-Sent Events body for GET /api/v1/events/stream.
 *
 * The stream polls event_stream (via listEvents) every `pollMs` and writes each
 * new event as
 *
 *   id: <event id>
 *   event: <event type>
 *   data: <event JSON>
 *
 * A `: heartbeat` comment goes out after `heartbeatMs` without other output, so
 * proxies keep the connection open. Shortly before the function's time limit
 * (`maxMs`) the stream sends `event: reconnect` with the cursor and closes
 * cleanly; clients reconnect with Last-Event-ID (EventSource does this itself).
 * Client disconnects (request abort / stream cancel) stop the loop.
 */

import type { ListEventsResult } from '@/lib/services/events'

export interface EventStreamOptions {
  /** Read the next page after `after` (null = from the start of the filter window). */
  fetchPage: (after: string | null) => Promise<ListEventsResult>
  /** Starting cursor (resume point). */
  after: string | null
  signal?: AbortSignal
  /** Poll interval when caught up (default 1 s). */
  pollMs?: number
  /** Idle time before a heartbeat comment (default 15 s). */
  heartbeatMs?: number
  /** End the stream (with a reconnect hint) after this long. */
  maxMs: number
  /** Client reconnect delay advertised with `retry:` (default 2 s). */
  retryMs?: number
  /** Consecutive read failures before the stream gives up (default 5). */
  maxFailures?: number
  now?: () => number
  onError?: (error: unknown) => void
}

const encoder = new TextEncoder()

/** One SSE message. Multi-line data is split into several `data:` lines. */
export function formatSseMessage(message: { id?: string | number; event?: string; data: unknown }): string {
  const lines: string[] = []
  if (message.id !== undefined) lines.push(`id: ${message.id}`)
  if (message.event) lines.push(`event: ${message.event.replace(/[\r\n]/g, ' ')}`)
  const data = typeof message.data === 'string' ? message.data : JSON.stringify(message.data)
  for (const line of data.split(/\r?\n/)) lines.push(`data: ${line}`)
  return `${lines.join('\n')}\n\n`
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

export function createEventStream(options: EventStreamOptions): ReadableStream<Uint8Array> {
  const pollMs = options.pollMs ?? 1_000
  const heartbeatMs = options.heartbeatMs ?? 15_000
  const retryMs = options.retryMs ?? 2_000
  const maxFailures = options.maxFailures ?? 5
  const now = options.now ?? Date.now
  // Stop on either a request abort or the consumer cancelling the stream.
  const stop = new AbortController()
  if (options.signal) {
    if (options.signal.aborted) stop.abort()
    else options.signal.addEventListener('abort', () => stop.abort(), { once: true })
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const startedAt = now()
      let lastWrite = startedAt
      let cursor = options.after
      let failures = 0

      const write = (text: string) => {
        if (stop.signal.aborted) return
        try {
          controller.enqueue(encoder.encode(text))
          lastWrite = now()
        } catch {
          stop.abort()
        }
      }
      const close = () => {
        stop.abort()
        try { controller.close() } catch { /* already closed */ }
      }

      const loop = async () => {
        write(`retry: ${retryMs}\n: connected\n\n`)
        while (!stop.signal.aborted) {
          if (now() - startedAt >= options.maxMs) {
            write(formatSseMessage({ ...(cursor ? { id: cursor } : {}), event: 'reconnect', data: { after: cursor } }))
            break
          }
          let page: ListEventsResult | null = null
          try {
            page = await options.fetchPage(cursor)
            failures = 0
          } catch (error) {
            options.onError?.(error)
            if (++failures >= maxFailures) {
              write(formatSseMessage({ event: 'error', data: { message: 'Event stream read failed; reconnect to resume', after: cursor } }))
              break
            }
          }
          if (stop.signal.aborted) break
          if (page) {
            for (const event of page.events) write(formatSseMessage({ id: event.id, event: event.type, data: event }))
            cursor = page.next_cursor ?? cursor
            if (page.has_more) continue
          }
          if (now() - lastWrite >= heartbeatMs) write(': heartbeat\n\n')
          await sleep(pollMs, stop.signal)
        }
        close()
      }
      void loop()
    },
    cancel() {
      stop.abort()
    },
  })
}

export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
}
