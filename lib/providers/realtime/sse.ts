import { subscriptionKey, type RealtimeChange, type RealtimeFilter, type RealtimeOp, type RealtimeStatus, type RealtimeTopic } from '@/lib/realtime/topics'
import type { RealtimeChangeHandler, RealtimeProvider, RealtimeStatusHandler } from './index'

/**
 * SSE realtime provider (browser): every subscription in the tab shares one
 * EventSource to /api/internal/realtime (browsers allow ~6 HTTP/1.1
 * connections per origin, so one per hook would starve the page). When the
 * set of subscriptions changes, the connection is replaced (debounced) and
 * resumes from the last event id, so nothing in between is lost.
 *
 * A tab that stays hidden (another tab in front, minimised) closes its
 * stream after `hiddenGraceMs` and reconnects — from the last event id, or
 * with a RESYNC when the server can't replay the gap — when it is shown
 * again. Without this every open tab (and framed page) held one of the
 * browser's ~6 connections to the origin for good; with five tabs open the
 * sixth connection carried every request of the visible page (saves,
 * reads, scripts) one after another.
 *
 * EventSource reconnects by itself after network errors and after the
 * server's planned end of stream (function time limit), sending
 * Last-Event-ID. An HTTP error (signed out, 429) closes it for good; then
 * this client retries with backoff. `resync` from the server (gap it can't
 * replay, backpressure) reaches every handler as a RESYNC change.
 */

export const REALTIME_SSE_PATH = '/api/internal/realtime'

interface Entry {
  topic: RealtimeTopic
  onChange: RealtimeChangeHandler
  onStatus?: RealtimeStatusHandler
}

interface EventSourceLike {
  readonly readyState: number
  onerror: ((ev: Event) => unknown) | null
  addEventListener(type: string, listener: (ev: MessageEvent) => void): void
  close(): void
}

/** The page's visibility (document in a browser). */
export interface VisibilityLike {
  readonly hidden: boolean
  addEventListener(type: 'visibilitychange', listener: () => void): void
}

export interface SseClientOptions {
  EventSource?: new (url: string, init?: EventSourceInit) => EventSourceLike
  /** Default: `document` in a browser; null: always connected. */
  visibility?: VisibilityLike | null
  /** How long a hidden tab keeps its stream before closing it (default 30 s). */
  hiddenGraceMs?: number
  path?: string
  /** Debounce before (re)connecting after the subscription set changes. */
  debounceMs?: number
  minBackoffMs?: number
  maxBackoffMs?: number
}

const CLOSED = 2

export class SseRealtimeClient {
  private readonly entries = new Map<string, Set<Entry>>()
  private source: EventSourceLike | null = null
  private connectedKeys = ''
  private lastEventId: string | null = null
  private status: RealtimeStatus = 'connecting'
  private rejected = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private backoffMs: number
  /** Hidden long enough: the stream is closed until the tab is shown. */
  private paused = false
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null
  private readonly visibility: VisibilityLike | null
  private readonly opts: Required<Omit<SseClientOptions, 'EventSource' | 'visibility'>> & Pick<SseClientOptions, 'EventSource'>

  constructor(options: SseClientOptions = {}) {
    this.opts = {
      EventSource: options.EventSource,
      path: options.path ?? REALTIME_SSE_PATH,
      hiddenGraceMs: options.hiddenGraceMs ?? 30_000,
      debounceMs: options.debounceMs ?? 50,
      minBackoffMs: options.minBackoffMs ?? 2_000,
      maxBackoffMs: options.maxBackoffMs ?? 60_000,
    }
    this.backoffMs = this.opts.minBackoffMs
    this.visibility = options.visibility !== undefined ? options.visibility : (typeof document !== 'undefined' ? document : null)
    if (this.visibility) {
      this.visibility.addEventListener('visibilitychange', () => this.onVisibility())
      if (this.visibility.hidden) this.onVisibility()
    }
  }

  /** Hidden: close the stream after the grace period. Shown: reconnect at once (resuming after the last event id). */
  private onVisibility(): void {
    if (this.visibility?.hidden) {
      if (!this.hiddenTimer && !this.paused) {
        this.hiddenTimer = setTimeout(() => {
          this.hiddenTimer = null
          if (!this.visibility?.hidden) return
          this.paused = true
          this.source?.close()
          this.source = null
          this.connectedKeys = ''
        }, this.opts.hiddenGraceMs)
      }
      return
    }
    if (this.hiddenTimer) clearTimeout(this.hiddenTimer)
    this.hiddenTimer = null
    if (!this.paused) return
    this.paused = false
    this.connect(true)
  }

  subscribe(topic: RealtimeTopic, filter: RealtimeFilter, onChange: RealtimeChangeHandler, onStatus?: RealtimeStatusHandler): () => void {
    const key = subscriptionKey(topic, filter)
    const entry: Entry = { topic, onChange, onStatus }
    let set = this.entries.get(key)
    if (!set) {
      set = new Set()
      this.entries.set(key, set)
    }
    set.add(entry)
    onStatus?.(this.rejected.has(key) ? 'error' : this.status)
    this.schedule(this.opts.debounceMs)
    return () => {
      const current = this.entries.get(key)
      if (!current) return
      current.delete(entry)
      if (current.size === 0) this.entries.delete(key)
      this.schedule(this.opts.debounceMs)
    }
  }

  /** Close the connection (tests, page teardown). */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.hiddenTimer) clearTimeout(this.hiddenTimer)
    this.hiddenTimer = null
    this.source?.close()
    this.source = null
    this.connectedKeys = ''
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, ms)
  }

  private setStatus(status: RealtimeStatus): void {
    this.status = status
    for (const [key, set] of this.entries) {
      const s = this.rejected.has(key) ? 'error' : status
      for (const entry of set) entry.onStatus?.(s)
    }
  }

  private connect(force = false): void {
    if (this.paused) return
    const keys = [...this.entries.keys()].sort()
    const joined = keys.join('\n')
    if (!force && this.source && this.source.readyState !== CLOSED && joined === this.connectedKeys) return
    this.source?.close()
    this.source = null
    this.connectedKeys = joined
    if (keys.length === 0) return
    const Impl = this.opts.EventSource ?? (typeof EventSource !== 'undefined' ? EventSource : undefined)
    if (!Impl) return

    const params = keys.map((k) => `s=${encodeURIComponent(k)}`)
    if (this.lastEventId) params.push(`after=${encodeURIComponent(this.lastEventId)}`)
    const source = new Impl(`${this.opts.path}?${params.join('&')}`, { withCredentials: true })
    this.source = source
    if (this.status !== 'live') this.setStatus('connecting')

    const track = (ev: MessageEvent) => {
      if (ev.lastEventId) this.lastEventId = ev.lastEventId
    }
    source.addEventListener('ready', (ev) => {
      if (this.source !== source) return
      track(ev)
      try {
        const data = JSON.parse(ev.data) as { rejected?: Array<{ key: string }> }
        this.rejected = new Set((data.rejected ?? []).map((r) => r.key))
        if (this.rejected.size > 0) console.warn('[realtime] subscriptions rejected:', [...this.rejected])
      } catch { /* keep the previous set */ }
      this.backoffMs = this.opts.minBackoffMs
      this.setStatus('live')
    })
    source.addEventListener('change', (ev) => {
      if (this.source !== source) return
      track(ev)
      let data: { changes?: Array<{ key: string; ops: RealtimeOp[]; ids: string[] | null }> }
      try { data = JSON.parse(ev.data) } catch { return }
      for (const change of data.changes ?? []) {
        const set = this.entries.get(change.key)
        if (!set) continue
        for (const op of change.ops) this.dispatch(set, { topic: [...set][0]?.topic, op, ids: change.ids })
      }
    })
    source.addEventListener('resync', (ev) => {
      if (this.source !== source) return
      track(ev)
      for (const set of this.entries.values()) this.dispatch(set, { topic: [...set][0]?.topic, op: 'RESYNC', ids: null })
    })
    source.addEventListener('ping', (ev) => { if (this.source === source) track(ev) })
    source.addEventListener('reconnect', (ev) => { if (this.source === source) track(ev) })
    source.addEventListener('fatal', () => {
      if (this.source !== source) return
      source.close()
      this.retryLater()
    })
    source.onerror = () => {
      if (this.source !== source) return
      // CONNECTING: EventSource retries by itself. CLOSED: an HTTP error.
      if (source.readyState === CLOSED) this.retryLater()
      else this.setStatus('connecting')
    }
  }

  private dispatch(set: Set<Entry>, change: Omit<RealtimeChange, 'topic'> & { topic: RealtimeTopic | undefined }): void {
    for (const entry of [...set]) {
      try {
        entry.onChange({ ...change, topic: entry.topic })
      } catch (error) {
        console.error('[realtime] handler failed:', error)
      }
    }
  }

  private retryLater(): void {
    if (this.paused) return
    this.source = null
    this.connectedKeys = ''
    this.setStatus('error')
    const delay = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 2, this.opts.maxBackoffMs)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect(true)
    }, delay)
  }
}

let shared: SseRealtimeClient | null = null

export const sseRealtimeProvider: RealtimeProvider = {
  id: 'sse',
  onPrem: true,
  subscribe(topic, filter, onChange, onStatus) {
    if (!shared) shared = new SseRealtimeClient()
    return shared.subscribe(topic, filter, onChange, onStatus)
  },
}
