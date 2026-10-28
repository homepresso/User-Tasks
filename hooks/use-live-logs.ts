'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { serverQuery } from '@/lib/server-read'
import { useRealtime } from '@/hooks/use-realtime'
import type { RealtimeChange, RealtimeStatus } from '@/lib/realtime/topics'

/**
 * useLiveLogs — real-time log aggregator across every observability
 * table in the app (workflow_logs, object_audit_log, integration_call_logs,
 * agent_runs).
 *
 * Design notes:
 *   - The viewer only shows events that arrive AFTER the caller enables
 *     the hook (`enabled = true`). There is deliberately NO seed query
 *     fetching recent history — it's a live tail, not a log archive.
 *   - Subscribes through the realtime provider (hooks/use-realtime):
 *     one INSERT subscription per enabled source. With Supabase Realtime
 *     the change carries the new row; with the SSE provider it carries
 *     ids only, and the hook reads that source's newest rows server-side
 *     ('automations.liveLogs', the polling read).
 *   - Bursts are batched via requestAnimationFrame so 20 workflow node
 *     logs landing in the same millisecond produce 1 React render.
 *   - Pause HOLDS inflight events in a separate holding buffer; Resume
 *     flushes them in timestamp order. Nothing is dropped.
 *   - Tenant isolation is enforced by the existing RLS policies on
 *     each table — Supabase Realtime respects SELECT policies, and the
 *     SSE route applies the same tenant rules, so subscribers only hear
 *     about rows they can already read.
 *
 * Prerequisite (Supabase provider): the log tables must be part of the
 * supabase_realtime publication. See
 * supabase/migrations/20260411_realtime_log_tables.sql. Without that
 * migration, postgres_changes subscriptions silently receive zero events.
 * (SSE provider: the NOTIFY triggers of 20261105000000_realtime_notify.sql.)
 */

// ─── Types ────────────────────────────────────────────────────────

export type LogSource = 'workflow' | 'audit' | 'integration' | 'agent'
export type LogLevel = 'info' | 'warn' | 'error'

/**
 * Subscription status surfaced to the UI so it can render accurate
 * live/connecting/error state instead of a blind "Live" badge that
 * keeps pulsing even when the channel has failed.
 */
export type LiveLogsStatus = 'idle' | 'connecting' | 'live' | 'error' | 'closed'
export type LiveLogsTransport = 'realtime' | 'polling' | null

export interface LiveLogEntry {
  /** Unique key for React + de-dupe. Format: `<source>:<id>` */
  key: string
  source: LogSource
  level: LogLevel
  timestamp: string
  /** Short one-liner (usually the message or summary) */
  title: string
  /** Secondary context (e.g. node name, table, actor) */
  subtitle?: string
  /** User who caused the event, if resolvable. Optional because many
   *  events are system-driven (workflow engine, etc). */
  actor?: {
    id: string
    name: string
  }
  /** Raw row as a JSON blob for the expandable metadata panel */
  raw: Record<string, any>
  /** Optional deep-link to the detailed view of this entry */
  href?: string
  /** Pre-computed lowercase searchable string built once at normalization
   *  time so the view doesn't have to JSON.stringify on every keystroke. */
  searchable: string
}

// ─── Config ───────────────────────────────────────────────────────

const BUFFER_LIMIT = 500
const POLL_INTERVAL_MS = 2500
const REALTIME_CONNECT_TIMEOUT_MS = 5000

const SOURCE_TABLE = {
  workflow: 'workflow_logs',
  audit: 'object_audit_log',
  integration: 'integration_call_logs',
  agent: 'agent_runs',
} as const satisfies Record<LogSource, string>

// ─── Normalizers ──────────────────────────────────────────────────

/**
 * Build the pre-lowered searchable index for an entry. Serializing the
 * raw row only once (here) avoids re-stringifying 500 entries on every
 * keystroke in the UI search filter.
 */
function buildSearchable(title: string, subtitle: string | undefined, raw: any): string {
  try {
    return `${title} ${subtitle ?? ''} ${JSON.stringify(raw)}`.toLowerCase()
  } catch {
    return `${title} ${subtitle ?? ''}`.toLowerCase()
  }
}

function normalizeWorkflowRow(row: any): LiveLogEntry {
  const level: LogLevel =
    row.level === 'error' || row.level === 'warn' || row.level === 'info'
      ? row.level
      : 'info'
  const title = row.message ?? '(no message)'
  const subtitle = [row.node_label, row.duration_ms != null ? `${row.duration_ms}ms` : null]
    .filter(Boolean)
    .join(' · ') || undefined
  return {
    key: `workflow:${row.id}`,
    source: 'workflow',
    level,
    timestamp: row.created_at,
    title,
    subtitle,
    raw: row,
    href: row.run_id ? `/automations/runs/${row.run_id}` : undefined,
    searchable: buildSearchable(title, subtitle, row),
  }
}

function normalizeAuditRow(row: any): LiveLogEntry {
  const destructive = row.action === 'delete' || row.action === 'revoke'
  const title = row.summary ?? `${row.action} ${row.object_type}`
  const subtitle = `${row.object_type} · ${row.action}`
  return {
    key: `audit:${row.id}`,
    source: 'audit',
    level: destructive ? 'warn' : 'info',
    timestamp: row.created_at,
    title,
    subtitle,
    actor: row.actor?.display_name
      ? { id: row.actor_id, name: row.actor.display_name }
      : row.actor_id
        ? { id: row.actor_id, name: `User ${String(row.actor_id).slice(0, 8)}` }
        : undefined,
    raw: row,
    href: '/activity',
    searchable: buildSearchable(title, subtitle, row),
  }
}

function normalizeIntegrationRow(row: any): LiveLogEntry {
  const level: LogLevel = row.error
    ? 'error'
    : row.response_status >= 500
      ? 'error'
      : row.response_status >= 400
        ? 'warn'
        : 'info'
  const title = `${row.method ?? 'REQ'} ${row.url ?? '(unknown)'}`
  const subtitle = [
    row.response_status != null ? `${row.response_status}` : null,
    row.duration_ms != null ? `${row.duration_ms}ms` : null,
    row.caller_type,
  ]
    .filter(Boolean)
    .join(' · ') || undefined
  return {
    key: `integration:${row.id}`,
    source: 'integration',
    level,
    timestamp: row.started_at ?? row.completed_at ?? new Date().toISOString(),
    title,
    subtitle,
    raw: row,
    href: row.integration_id ? `/integrations/${row.integration_id}/calls/${row.id}` : undefined,
    searchable: buildSearchable(title, subtitle, row),
  }
}

function normalizeAgentRow(row: any): LiveLogEntry {
  const level: LogLevel =
    row.status === 'failed' || row.error ? 'error' : 'info'
  const title = row.error || row.output_response?.slice(0, 120) || `Agent run: ${row.status}`
  const subtitle = [
    row.model,
    row.total_tokens != null ? `${row.total_tokens} tokens` : null,
    row.duration_ms != null ? `${row.duration_ms}ms` : null,
  ]
    .filter(Boolean)
    .join(' · ') || undefined
  return {
    key: `agent:${row.id}`,
    source: 'agent',
    level,
    timestamp: row.started_at ?? row.created_at,
    title,
    subtitle,
    actor: row.actor?.display_name
      ? { id: row.actor_id, name: row.actor.display_name }
      : row.actor_id
        ? { id: row.actor_id, name: `User ${String(row.actor_id).slice(0, 8)}` }
        : undefined,
    raw: row,
    href: row.agent_id ? `/agents/${row.agent_id}/runs/${row.id}` : undefined,
    searchable: buildSearchable(title, subtitle, row),
  }
}

function normalizeRow(source: LogSource, row: any): LiveLogEntry {
  switch (source) {
    case 'workflow': return normalizeWorkflowRow(row)
    case 'audit': return normalizeAuditRow(row)
    case 'integration': return normalizeIntegrationRow(row)
    case 'agent': return normalizeAgentRow(row)
  }
}

// ─── Hook ─────────────────────────────────────────────────────────

interface UseLiveLogsOptions {
  /** Master switch — when false the hook tears down the channel and
   *  empties the buffer. Flipping this to true opens a fresh subscription. */
  enabled: boolean
  /** Sources currently being streamed. Changing this re-subscribes. */
  sources: Set<LogSource>
}

interface UseLiveLogsResult {
  entries: LiveLogEntry[]
  /** Current subscription state for the status indicator */
  status: LiveLogsStatus
  /** Which transport is currently powering the tail */
  transport: LiveLogsTransport
  /** True when the user paused the stream — inflight events are held
   *  in a pause buffer and flushed on Resume. Nothing is dropped. */
  paused: boolean
  togglePause: () => void
  clear: () => void
  /** How many events are sitting in the pause buffer waiting to flush */
  pausedCount: number
}

export function useLiveLogs({ enabled, sources }: UseLiveLogsOptions): UseLiveLogsResult {
  const [entries, setEntries] = useState<LiveLogEntry[]>([])
  const [status, setStatus] = useState<LiveLogsStatus>('idle')
  const [transport, setTransport] = useState<LiveLogsTransport>(null)
  const [paused, setPaused] = useState(false)
  const [pausedCount, setPausedCount] = useState(0)

  // All buffers live in refs so realtime bursts never cause per-event
  // re-renders. The flush scheduler batches state updates into
  // requestAnimationFrame ticks.
  const bufferRef = useRef<LiveLogEntry[]>([])        // live buffer rendered to UI
  const pendingRef = useRef<LiveLogEntry[]>([])       // inflight bucket between RAF ticks
  const pauseBufferRef = useRef<LiveLogEntry[]>([])   // events accumulated while paused
  const flushTimerRef = useRef<number | null>(null)
  const pollingTimerRef = useRef<number | null>(null)
  const connectTimeoutRef = useRef<number | null>(null)
  const pausedRef = useRef(false)
  const statusRef = useRef<LiveLogsStatus>('idle')
  const transportRef = useRef<LiveLogsTransport>(null)
  const sourceStatusRef = useRef(new Map<LogSource, RealtimeStatus>())
  const fetchStateRef = useRef(new Map<LogSource, { inFlight: boolean; again: boolean; newest: string | null }>())
  const cancelledRef = useRef(false)
  const tailStartedAtRef = useRef<string | null>(null)
  const pollingInFlightRef = useRef(false)

  // Keep pausedRef in sync with state so the subscription callback can
  // read it without closing over stale state.
  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    transportRef.current = transport
  }, [transport])

  const clearPollingTimer = useCallback(() => {
    if (pollingTimerRef.current != null && typeof window !== 'undefined') {
      window.clearTimeout(pollingTimerRef.current)
      pollingTimerRef.current = null
    }
  }, [])

  const clearConnectTimeout = useCallback(() => {
    if (connectTimeoutRef.current != null && typeof window !== 'undefined') {
      window.clearTimeout(connectTimeoutRef.current)
      connectTimeoutRef.current = null
    }
  }, [])

  // ── Flush: merge pending events into the live buffer + state ──
  // Always uses the latest refs — this function never closes over
  // buffer contents so it's safe to call from any async context.
  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current != null) return
    if (typeof window === 'undefined') return
    flushTimerRef.current = window.requestAnimationFrame(() => {
      flushTimerRef.current = null
      if (cancelledRef.current) return

      if (pausedRef.current) {
        // Paused: move inflight events into the holding bucket. They'll
        // be replayed on Resume so nothing is lost.
        if (pendingRef.current.length > 0) {
          pauseBufferRef.current.push(...pendingRef.current)
          pendingRef.current = []
          setPausedCount(pauseBufferRef.current.length)
        }
        return
      }

      // Unpaused: merge pause buffer + pending, de-dupe, prepend, cap.
      // Pause buffer is always drained here (we passed the paused check
      // at the top), so we reset the counter in the same tick. React
      // dedupes identical state sets so the guard isn't needed.
      const hadPausedEntries = pauseBufferRef.current.length > 0
      const toMerge = [...pauseBufferRef.current, ...pendingRef.current]
      pauseBufferRef.current = []
      pendingRef.current = []
      if (hadPausedEntries) setPausedCount(0)
      if (toMerge.length === 0) return

      const seenKeys = new Set(bufferRef.current.map(e => e.key))
      const incoming: LiveLogEntry[] = []
      for (const entry of toMerge) {
        if (seenKeys.has(entry.key)) continue
        seenKeys.add(entry.key)
        incoming.push(entry)
      }
      if (incoming.length === 0) return

      const merged = [...incoming, ...bufferRef.current]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, BUFFER_LIMIT)
      bufferRef.current = merged
      setEntries(merged)
    })
  }, [])

  // Polling reads run server-side ('automations.liveLogs': one read per
  // source, batched into one request): each source's rows since `since` on
  // its timestamp column, newest first, at most 100.
  const fetchSourceRows = useCallback(async (source: LogSource, since: string) => {
    return (await serverQuery('automations.liveLogs', { source, since })) ?? []
  }, [])

  const startPolling = useCallback((sortedSources: LogSource[]) => {
    clearPollingTimer()
    if (cancelledRef.current || sortedSources.length === 0) return
    if (!tailStartedAtRef.current) tailStartedAtRef.current = new Date().toISOString()

    const pollOnce = async () => {
      if (cancelledRef.current || pollingInFlightRef.current) return
      // Hidden tab: skip the fetch batch but keep the timer chain alive so
      // polling resumes automatically when the tab becomes visible again.
      // Any rows missed while hidden are picked up by the next visible tick
      // (the `since` window is anchored to tail start, and flush dedupes).
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        pollingTimerRef.current = window.setTimeout(pollOnce, POLL_INTERVAL_MS)
        return
      }
      pollingInFlightRef.current = true
      try {
        const since = tailStartedAtRef.current ?? new Date().toISOString()

        // Fetch each source independently so one bad table doesn't
        // tank the whole batch. Promise.allSettled lets us collect
        // partial results even if some fetches 4xx. Without this, a
        // single 400 on integration_call_logs would reject the whole
        // Promise.all and every other source's events get dropped.
        const results = await Promise.allSettled(
          sortedSources.map(async (source) => {
            const rows = await fetchSourceRows(source, since)
            return rows.map((row) => normalizeRow(source, row))
          }),
        )

        const events: LiveLogEntry[] = []
        let anySucceeded = false
        for (let i = 0; i < results.length; i++) {
          const result = results[i]
          if (result.status === 'fulfilled') {
            anySucceeded = true
            events.push(...result.value)
          } else {
            // Log but don't throw — we want other sources to keep
            // streaming even if one has a permission/schema issue.
            console.warn(`[live-logs] polling ${sortedSources[i]} failed:`, result.reason)
          }
        }

        if (events.length > 0) {
          pendingRef.current.push(...events)
          scheduleFlush()
        }
        if (!cancelledRef.current) {
          transportRef.current = 'polling'
          // Only report 'live' if at least one source is actually
          // succeeding. Otherwise all fetches failed and we should
          // show the error state so the user knows something is wrong.
          setStatus(anySucceeded ? 'live' : 'error')
          setTransport('polling')
        }
      } catch (err) {
        if (!cancelledRef.current) {
          console.warn('[live-logs] poll tick failed:', err)
          transportRef.current = 'polling'
          setStatus('error')
          setTransport('polling')
        }
      } finally {
        pollingInFlightRef.current = false
        if (!cancelledRef.current && transportRef.current === 'polling' && typeof window !== 'undefined') {
          pollingTimerRef.current = window.setTimeout(pollOnce, POLL_INTERVAL_MS)
        }
      }
    }

    transportRef.current = 'polling'
    setTransport('polling')
    void pollOnce()
  }, [clearPollingTimer, fetchSourceRows, scheduleFlush])

  // ── Reset when enabled / sources change ──
  // NO seed query — the viewer is a pure live tail. Users only see
  // events that occur AFTER they click Start, matching the requirement.
  const sourcesKey = Array.from(sources).sort().join(',')
  const active = enabled && sources.size > 0

  useEffect(() => {
    cancelledRef.current = false
    fetchStateRef.current = new Map()

    // Not enabled or no sources selected → tear down and clear ALL buffers
    // so the viewer resets to empty. Buffer clear is important on "Stop" so
    // the user sees the empty state.
    if (!active) {
      sourceStatusRef.current = new Map()
      clearPollingTimer()
      clearConnectTimeout()
      tailStartedAtRef.current = null
      bufferRef.current = []
      pendingRef.current = []
      pauseBufferRef.current = []
      setEntries([])
      setPausedCount(0)
      setStatus('idle')
      setTransport(null)
      return
    }

    setStatus('connecting')
    setTransport(null)
    tailStartedAtRef.current = new Date().toISOString()
    const sortedSources = sourcesKey.split(',') as LogSource[]
    if (typeof window !== 'undefined') {
      connectTimeoutRef.current = window.setTimeout(() => {
        if (cancelledRef.current) return
        if (statusRef.current !== 'live') startPolling(sortedSources)
      }, REALTIME_CONNECT_TIMEOUT_MS)
    }
    // Sources kept from the previous selection are already live.
    if (sortedSources.every((s) => sourceStatusRef.current.get(s) === 'live')) {
      clearConnectTimeout()
      transportRef.current = 'realtime'
      setStatus('live')
      setTransport('realtime')
    }

    return () => {
      cancelledRef.current = true
      clearConnectTimeout()
      clearPollingTimer()
      if (flushTimerRef.current != null) {
        if (typeof window !== 'undefined') {
          window.cancelAnimationFrame(flushTimerRef.current)
        }
        flushTimerRef.current = null
      }
    }
  }, [active, sourcesKey, clearConnectTimeout, clearPollingTimer, startPolling])

  // ── Realtime subscriptions (one per enabled source) ──

  // SSE provider: the change names ids only. Read the source's newest rows
  // (since the tail started, or shortly before the newest one seen);
  // overlapping changes coalesce into one follow-up read.
  const fetchLatest = useCallback(async (source: LogSource) => {
    let state = fetchStateRef.current.get(source)
    if (!state) {
      state = { inFlight: false, again: false, newest: null }
      fetchStateRef.current.set(source, state)
    }
    if (state.inFlight) {
      state.again = true
      return
    }
    state.inFlight = true
    try {
      do {
        state.again = false
        const tailStart = tailStartedAtRef.current
        if (!tailStart) return
        const newest = state.newest ? new Date(Date.parse(state.newest) - 5000).toISOString() : null
        const since = newest && newest > tailStart ? newest : tailStart
        const rows = await fetchSourceRows(source, since)
        if (cancelledRef.current) return
        const entries = rows.map((row) => normalizeRow(source, row))
        for (const entry of entries) {
          if (entry.timestamp && (!state.newest || entry.timestamp > state.newest)) state.newest = entry.timestamp
        }
        if (entries.length > 0) {
          pendingRef.current.push(...entries)
          scheduleFlush()
        }
      } while (state.again && !cancelledRef.current)
    } catch (err) {
      console.warn(`[live-logs] reading ${source} after a change failed:`, err)
    } finally {
      state.inFlight = false
    }
  }, [fetchSourceRows, scheduleFlush])

  const onLogChange = useCallback((source: LogSource, change: RealtimeChange) => {
    if (cancelledRef.current) return
    if (change.record) {
      pendingRef.current.push(normalizeRow(source, change.record))
      scheduleFlush()
      return
    }
    void fetchLatest(source)
  }, [fetchLatest, scheduleFlush])

  // Aggregate the per-source subscription states into the tail's status:
  // live once every source is live; any failure falls back to polling.
  const onSourceStatus = useCallback((source: LogSource, subscribeStatus: RealtimeStatus) => {
    if (cancelledRef.current) return
    // Log every non-live state so failures are visible in the browser
    // console for debugging (the provider doesn't otherwise surface why a
    // subscription failed — the user just sees a silent error).
    if (subscribeStatus !== 'live' && subscribeStatus !== 'connecting') {
      console.warn('[live-logs] subscription status:', source, subscribeStatus)
    }
    sourceStatusRef.current.set(source, subscribeStatus)
    const sortedSources = sourcesKey.split(',').filter(Boolean) as LogSource[]
    const states = sortedSources.map((s) => sourceStatusRef.current.get(s))
    if (states.every((s) => s === 'live')) {
      clearConnectTimeout()
      clearPollingTimer()
      transportRef.current = 'realtime'
      setStatus('live')
      setTransport('realtime')
    } else if (subscribeStatus === 'error') {
      setStatus('error')
      startPolling(sortedSources)
    } else if (subscribeStatus === 'closed') {
      setStatus('closed')
      startPolling(sortedSources)
    }
  }, [sourcesKey, clearConnectTimeout, clearPollingTimer, startPolling])

  const INSERTS = { event: 'INSERT' } as const
  useRealtime(SOURCE_TABLE.workflow, INSERTS, (c) => onLogChange('workflow', c), {
    enabled: active && sources.has('workflow'), onStatus: (st) => onSourceStatus('workflow', st),
  })
  useRealtime(SOURCE_TABLE.audit, INSERTS, (c) => onLogChange('audit', c), {
    enabled: active && sources.has('audit'), onStatus: (st) => onSourceStatus('audit', st),
  })
  useRealtime(SOURCE_TABLE.integration, INSERTS, (c) => onLogChange('integration', c), {
    enabled: active && sources.has('integration'), onStatus: (st) => onSourceStatus('integration', st),
  })
  useRealtime(SOURCE_TABLE.agent, INSERTS, (c) => onLogChange('agent', c), {
    enabled: active && sources.has('agent'), onStatus: (st) => onSourceStatus('agent', st),
  })

  const togglePause = useCallback(() => {
    setPaused(p => {
      const next = !p
      if (!next) {
        // Resuming — flush any events that accumulated during pause.
        // pauseBufferRef is drained inside scheduleFlush after pausedRef
        // has been updated on the next render tick. Use a microtask so
        // pausedRef picks up the new value before scheduleFlush runs.
        queueMicrotask(() => {
          pausedRef.current = false
          scheduleFlush()
        })
      }
      return next
    })
  }, [scheduleFlush])

  const clear = useCallback(() => {
    bufferRef.current = []
    pendingRef.current = []
    pauseBufferRef.current = []
    setEntries([])
    setPausedCount(0)
  }, [])

  return { entries, status, transport, paused, togglePause, clear, pausedCount }
}
