/**
 * Event stream helpers: cursor reads of GET /events and a live
 * `streamEvents()` iterator over the Server-Sent Events endpoint
 * GET /events/stream that reconnects on its own.
 *
 *   for await (const event of client.events.stream({ category: 'workflow' })) {
 *     console.log(event.id, event.type, event.message)
 *   }
 *
 * Reconnects resume from the last received id (Last-Event-ID), so a dropped
 * connection or the server's planned `event: reconnect` loses nothing.
 * Delivery is at-least-once; ids are monotonic, and events at or below the
 * last seen id are skipped.
 */

import type { UsertasksClient } from './client'
import { UsertasksApiError } from './errors'
import type { components, operations } from './generated/schema'

export type UsertasksEvent = components['schemas']['Event']
export type ListEventsQuery = NonNullable<operations['listEvents']['parameters']['query']>
export type StreamEventsQuery = NonNullable<operations['streamEvents']['parameters']['query']>

export interface ListEventsResult {
  events: UsertasksEvent[]
  next_cursor: string | null
  has_more: boolean
}

// ─── SSE parsing ───

export interface SseMessage {
  /** `id:` of the message (also the stream's last event id from then on). */
  id?: string
  /** `event:` name; undefined means the default `message`. */
  event?: string
  data: string
  /** `retry:` reconnection delay in ms, when the message carried one. */
  retry?: number
}

/**
 * Parse a `text/event-stream` body into messages (WHATWG rules: `data` lines
 * joined with `\n`, comments ignored, a blank line dispatches; a block with
 * only `retry:` is yielded with empty data so callers can honour it).
 */
export async function* parseSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseMessage, void, undefined> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  let event: string | undefined
  let id: string | undefined
  let retry: number | undefined
  let sawField = false

  const take = (): SseMessage | null => {
    const hasData = data.length > 0
    const message: SseMessage | null = hasData || retry !== undefined || (sawField && id !== undefined)
      ? { ...(id !== undefined ? { id } : {}), ...(event ? { event } : {}), data: data.join('\n'), ...(retry !== undefined ? { retry } : {}) }
      : null
    data = []
    event = undefined
    id = undefined
    retry = undefined
    sawField = false
    return message
  }

  const onAbort = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      if (signal?.aborted) return
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index: number
      while ((index = buffer.search(/\r\n|\r|\n/)) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + (buffer.startsWith('\r\n', index) ? 2 : 1))
        if (line === '') {
          const message = take()
          if (message) yield message
          continue
        }
        if (line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        let fieldValue = colon < 0 ? '' : line.slice(colon + 1)
        if (fieldValue.startsWith(' ')) fieldValue = fieldValue.slice(1)
        sawField = true
        if (field === 'data') data.push(fieldValue)
        else if (field === 'event') event = fieldValue
        else if (field === 'id' && !fieldValue.includes('\0')) id = fieldValue
        else if (field === 'retry' && /^\d+$/.test(fieldValue)) retry = Number(fieldValue)
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    // Consumer stopped early (break / return): close the connection.
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

// ─── Live stream with reconnect ───

export interface StreamEventsOptions extends Omit<StreamEventsQuery, 'after'> {
  /** Resume after this event id (default: from now, or from `since`). */
  after?: string | number
  signal?: AbortSignal
  /** Reconnect after the server ends the stream or the connection drops (default true). */
  reconnect?: boolean
  /** First retry delay after a failure in ms (default 1000; doubles, capped by maxReconnectDelayMs). */
  reconnectDelayMs?: number
  /** Upper bound for the retry delay (default 30 000). */
  maxReconnectDelayMs?: number
  /** Called before each reconnect with the resume cursor and the reason. */
  onReconnect?: (info: { after: string | null; reason: 'server' | 'ended' | 'error'; error?: unknown; delayMs: number }) => void
}

/** 4xx responses (bad filter, auth, permission) are not retried. */
function isFatal(error: unknown): boolean {
  return error instanceof UsertasksApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429
}

/** Always yields to the timer queue (even for 0 ms) so a reconnect loop can't starve the event loop. */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, Math.max(0, ms))
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })

/**
 * Iterate events from GET /events/stream until `signal` aborts (or, with
 * `reconnect: false`, until the first stream ends).
 */
export async function* streamEvents(client: UsertasksClient, options: StreamEventsOptions = {}): AsyncGenerator<UsertasksEvent, void, undefined> {
  const { signal, reconnect = true, reconnectDelayMs = 1_000, maxReconnectDelayMs = 30_000, onReconnect, after: start, since, ...filters } = options
  let lastId: string | null = start !== undefined && start !== null && start !== '' ? String(start) : null
  let failures = 0
  let serverRetryMs: number | undefined

  while (!signal?.aborted) {
    let reason: 'server' | 'ended' | 'error' = 'ended'
    let failure: unknown
    try {
      const query: Record<string, string | undefined> = { ...(filters as Record<string, string | undefined>) }
      if (lastId) query.after = lastId
      else if (since) query.since = since
      const response = await client.openStream('/events/stream', {
        query,
        headers: lastId ? { 'Last-Event-ID': lastId } : undefined,
        signal,
      })
      failures = 0
      for await (const message of parseSse(response.body!, signal)) {
        if (message.retry !== undefined) serverRetryMs = message.retry
        if (message.event === 'reconnect') {
          if (message.id) lastId = message.id
          reason = 'server'
          break
        }
        if (message.event === 'error') {
          reason = 'error'
          failure = new Error(message.data || 'event stream error')
          break
        }
        if (!message.data || message.id === undefined) continue
        if (lastId && BigInt(message.id) <= BigInt(lastId)) continue
        const event = JSON.parse(message.data) as UsertasksEvent
        lastId = message.id
        yield event
      }
    } catch (error) {
      if (signal?.aborted) return
      if (isFatal(error) || !reconnect) throw error
      reason = 'error'
      failure = error
    }
    if (signal?.aborted || !reconnect) return
    let delayMs = 0
    if (reason === 'error') {
      failures++
      delayMs = Math.min(maxReconnectDelayMs, Math.max(serverRetryMs ?? 0, reconnectDelayMs * 2 ** (failures - 1)))
    } else if (reason === 'ended') {
      delayMs = serverRetryMs ?? reconnectDelayMs
    }
    onReconnect?.({ after: lastId, reason, ...(failure !== undefined ? { error: failure } : {}), delayMs })
    await sleep(delayMs, signal)
  }
}

// ─── `client.events` ───

export class EventsApi {
  constructor(private readonly client: UsertasksClient) {}

  /** One page of events (oldest first). Pass `next_cursor` as `after` for the next page. */
  list(query: ListEventsQuery = {}, options: { signal?: AbortSignal } = {}): Promise<ListEventsResult> {
    return this.client.request<ListEventsResult>('GET', '/events', { query: query as Record<string, string | number | undefined>, signal: options.signal })
  }

  /** Every event matching `query`, following the cursor until has_more is false. */
  async *iterate(query: ListEventsQuery = {}, options: { signal?: AbortSignal } = {}): AsyncGenerator<UsertasksEvent, void, undefined> {
    let after = query.after
    for (;;) {
      const page = await this.list({ ...query, ...(after ? { after } : {}) }, options)
      for (const event of page.events) yield event
      if (!page.has_more || !page.next_cursor || page.next_cursor === after) return
      after = page.next_cursor
    }
  }

  /** Live events over Server-Sent Events, reconnecting with Last-Event-ID. */
  stream(options: StreamEventsOptions = {}): AsyncGenerator<UsertasksEvent, void, undefined> {
    return streamEvents(this.client, options)
  }
}
