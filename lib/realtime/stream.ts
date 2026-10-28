import { formatSseMessage } from '@/lib/log-export/sse'
import { deliveriesFor, type Audience, type ChangeEvent } from './events'
import type { HubMessage, RealtimeHub } from './hub'
import type { ParsedSubscription, RealtimeOp } from './topics'

/**
 * SSE body for GET /api/internal/realtime (one browser tab's multiplexed
 * realtime connection).
 *
 * Messages (all `event:` names avoid "error", which EventSource reserves):
 *   ready      {subscriptions, rejected, mode}   once, first
 *   change     {changes: [{key, ops, ids|null}]} batched every `flushMs`
 *   resync     {}  changes may have been missed: refetch everything
 *   ping       {}  heartbeat; carries the current watermark as its id
 *   reconnect  {}  the stream is about to end (function time limit)
 *   fatal      {reason}  the session ended; the stream closes
 *
 * `id:` is a database-clock ms timestamp; EventSource sends it back as
 * Last-Event-ID when it reconnects and the hub replays from there (or the
 * stream starts with a resync when it can't).
 *
 * Backpressure: the stream's queue holds `maxQueued` messages. When a slow
 * client lets it fill, pending changes are dropped and a single resync goes
 * out once there is room again. Ids per subscription per batch are capped
 * (beyond that the change is sent without ids).
 */

export interface RealtimeStreamOptions {
  hub: Pick<RealtimeHub, 'subscribe' | 'replaySince' | 'watermark' | 'mode'>
  subscriptions: readonly ParsedSubscription[]
  rejected?: ReadonlyArray<{ key: string; reason: string }>
  audience: Audience
  /** Re-reads the audience (tenant switch, membership change); throws when the session ended. */
  refreshAudience?: () => Promise<Audience>
  /** Resume point (Last-Event-ID), database-clock ms. */
  lastEventId?: number | null
  signal?: AbortSignal
  /** End with `event: reconnect` after this long. */
  maxMs: number
  heartbeatMs?: number
  audienceRefreshMs?: number
  flushMs?: number
  retryMs?: number
  maxQueued?: number
  maxIdsPerChange?: number
  now?: () => number
  onClose?: () => void
}

const encoder = new TextEncoder()

interface PendingChange {
  ops: Set<RealtimeOp>
  ids: Set<string> | null
}

export function createRealtimeStream(options: RealtimeStreamOptions): ReadableStream<Uint8Array> {
  const heartbeatMs = options.heartbeatMs ?? 15_000
  const audienceRefreshMs = options.audienceRefreshMs ?? 30_000
  const flushMs = options.flushMs ?? 100
  const retryMs = options.retryMs ?? 2_000
  const maxIdsPerChange = options.maxIdsPerChange ?? 100
  const now = options.now ?? Date.now
  const stop = new AbortController()
  if (options.signal) {
    if (options.signal.aborted) stop.abort()
    else options.signal.addEventListener('abort', () => stop.abort(), { once: true })
  }

  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
  let audience = options.audience
  let lastId = 0
  let lastWrite = now()
  let pending = new Map<string, PendingChange>()
  let pendingTs = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let overflowed = false
  const timers: Array<ReturnType<typeof setInterval>> = []
  let unsubscribe: (() => void) | null = null
  let closed = false

  const cleanup = () => {
    if (closed) return
    closed = true
    stop.abort()
    unsubscribe?.()
    unsubscribe = null
    if (flushTimer) clearTimeout(flushTimer)
    for (const t of timers) clearInterval(t)
    options.onClose?.()
  }

  const hasRoom = () => (controllerRef?.desiredSize ?? 0) > 0

  const write = (text: string): boolean => {
    if (stop.signal.aborted || !controllerRef) return false
    try {
      controllerRef.enqueue(encoder.encode(text))
      lastWrite = now()
      return true
    } catch {
      cleanup()
      return false
    }
  }

  const send = (event: string, data: unknown, id?: number) => {
    if (id !== undefined && id > lastId) lastId = id
    return write(formatSseMessage({ ...(id !== undefined && lastId > 0 ? { id: lastId } : {}), event, data }))
  }

  const close = () => {
    const controller = controllerRef
    cleanup()
    try { controller?.close() } catch { /* already closed */ }
  }

  const flush = () => {
    flushTimer = null
    if (pending.size === 0) return
    const batch = pending
    const batchTs = pendingTs
    pending = new Map()
    pendingTs = 0
    if (!hasRoom()) {
      overflowed = true
      return
    }
    if (overflowed) {
      overflowed = false
      send('resync', {}, batchTs || undefined)
      return
    }
    const changes = [...batch].map(([key, c]) => ({ key, ops: [...c.ops], ids: c.ids ? [...c.ids] : null }))
    send('change', { changes }, batchTs || undefined)
  }

  const accept = (event: ChangeEvent) => {
    const deliveries = deliveriesFor(event, options.subscriptions, audience)
    if (deliveries.length === 0) return
    for (const d of deliveries) {
      let entry = pending.get(d.key)
      if (!entry) {
        entry = { ops: new Set(), ids: new Set() }
        pending.set(d.key, entry)
      }
      entry.ops.add(d.op)
      if (d.ids === null || entry.ids === null) entry.ids = null
      else {
        for (const id of d.ids) entry.ids.add(id)
        if (entry.ids.size > maxIdsPerChange) entry.ids = null
      }
    }
    if (event.ts > pendingTs) pendingTs = event.ts
    if (!flushTimer) flushTimer = setTimeout(flush, flushMs)
  }

  const onHub = (message: HubMessage) => {
    if (stop.signal.aborted) return
    if (message.kind === 'resync') {
      pending = new Map()
      if (hasRoom()) send('resync', {})
      else overflowed = true
      return
    }
    accept(message.event)
  }

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controllerRef = controller
        const startedAt = now()
        write(`retry: ${retryMs}\n\n`)
        send('ready', {
          subscriptions: options.subscriptions.map((s) => s.key),
          rejected: options.rejected ?? [],
          mode: options.hub.mode,
        })

        unsubscribe = options.hub.subscribe(onHub)
        if (options.lastEventId) {
          const replay = options.hub.replaySince(options.lastEventId)
          if (replay === null) send('resync', {})
          else for (const event of replay) accept(event)
        }

        timers.push(setInterval(() => {
          if (stop.signal.aborted) return
          if (now() - startedAt >= options.maxMs) {
            flush()
            send('reconnect', {}, options.hub.watermark() ?? undefined)
            close()
            return
          }
          if (overflowed && hasRoom()) {
            overflowed = false
            send('resync', {})
          }
          if (now() - lastWrite >= heartbeatMs && hasRoom()) {
            // Advance the client's resume point only when nothing is pending.
            send('ping', {}, pending.size === 0 ? options.hub.watermark() ?? undefined : undefined)
          }
        }, Math.min(1_000, heartbeatMs)))

        if (options.refreshAudience) {
          const refresh = options.refreshAudience
          timers.push(setInterval(() => {
            refresh().then((next) => { audience = next }).catch(() => {
              if (stop.signal.aborted) return
              send('fatal', { reason: 'session' })
              close()
            })
          }, audienceRefreshMs))
        }
        stop.signal.addEventListener('abort', () => close(), { once: true })
      },
      cancel() {
        cleanup()
      },
    },
    new CountQueuingStrategy({ highWaterMark: options.maxQueued ?? 256 }),
  )
}
