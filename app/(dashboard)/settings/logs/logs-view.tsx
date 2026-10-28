'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Play, Pause, Trash2, Search, ChevronDown, ChevronRight,
  ExternalLink, ScrollText, Workflow, Activity, Network, Bot,
  User as UserIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLiveLogs, type LogSource, type LogLevel, type LiveLogEntry, type LiveLogsStatus, type LiveLogsTransport } from '@/hooks/use-live-logs'
import { formatRelativeDate, getInitials, cn } from '@/lib/utils'

/**
 * Format a timestamp as HH:MM:SS.mmm for the exact-time display on
 * each log row. Matches what most tail tools show. Uses the user's
 * locale for the colon separator but not the hour format — we want
 * 24h everywhere for unambiguous readability in a debugging context.
 */
function formatExactTime(timestamp: string): string {
  try {
    const d = new Date(timestamp)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    const ms = String(d.getMilliseconds()).padStart(3, '0')
    return `${hh}:${mm}:${ss}.${ms}`
  } catch {
    return '—'
  }
}

const STORAGE_KEY = 'settings_logs_sources'

interface SourceMeta {
  id: LogSource
  label: string
  icon: React.ElementType
  color: string
}

const SOURCES: SourceMeta[] = [
  { id: 'workflow', label: 'Workflow', icon: Workflow, color: 'var(--theme-primary-text)' },
  { id: 'audit', label: 'Audit', icon: Activity, color: 'var(--status-info, #3B82F6)' },
  { id: 'integration', label: 'Integrations', icon: Network, color: 'var(--status-warning, #F59E0B)' },
  { id: 'agent', label: 'Agents', icon: Bot, color: 'var(--theme-primary-text)' },
]

const LEVELS: { id: LogLevel; label: string; color: string; bg: string }[] = [
  { id: 'info', label: 'Info', color: 'var(--status-info)', bg: 'var(--status-info-bg)' },
  { id: 'warn', label: 'Warn', color: 'var(--status-warning)', bg: 'var(--status-warning-bg)' },
  { id: 'error', label: 'Error', color: 'var(--status-error)', bg: 'var(--status-error-bg)' },
]

/**
 * Two-pane real-time log tail for the Settings admin area.
 *
 *   Left panel (fixed 260px): master Start/Pause control, source
 *     checkboxes, level checkboxes, free-text search.
 *   Right panel (flex-1):    the live entry list with expandable
 *     metadata JSON and deep-links to source detail pages.
 *
 * The viewer opens PAUSED. The user must click Start to subscribe.
 * Source selections persist in localStorage so users don't re-pick
 * their preferred sources every visit.
 */
export function LogsView() {
  // Hook-level controls
  const [enabled, setEnabled] = useState(false) // master "is subscribing" switch
  const [selectedSources, setSelectedSources] = useState<Set<LogSource>>(
    () => new Set<LogSource>(['workflow', 'audit', 'integration', 'agent']),
  )
  const [selectedLevels, setSelectedLevels] = useState<Set<LogLevel>>(
    () => new Set<LogLevel>(['info', 'warn', 'error']),
  )
  const [search, setSearch] = useState('')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  // Restore source selection from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((s): s is LogSource =>
          ['workflow', 'audit', 'integration', 'agent'].includes(s),
        )
        if (valid.length > 0) setSelectedSources(new Set(valid))
      }
    } catch {}
  }, [])

  // Persist source selection changes
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selectedSources))) } catch {}
  }, [selectedSources])

  const { entries, status, transport, paused, togglePause, clear, pausedCount } = useLiveLogs({
    enabled,
    sources: selectedSources,
  })

  // Apply client-side filters. Each entry carries a pre-computed
  // `searchable` string built once at normalization time — we avoid
  // JSON.stringify-ing 500 raw rows on every keystroke.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter(e => {
      if (!selectedLevels.has(e.level)) return false
      if (!q) return true
      return e.searchable.includes(q)
    })
  }, [entries, search, selectedLevels])

  function toggleSource(id: LogSource) {
    setSelectedSources(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleLevel(id: LogLevel) {
    setSelectedLevels(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleStart() {
    setEnabled(true)
  }

  function handleStop() {
    setEnabled(false)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            className="p-1.5 rounded-lg hover:bg-[var(--theme-surface)] transition-colors"
            style={{ color: 'var(--theme-muted-text)' }}
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: 'var(--theme-card-text)' }}>
              <ScrollText size={20} style={{ color: 'var(--theme-primary-text)' }} />
              Live Logs
            </h1>
            <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
              Real-time tail across workflows, audits, integrations, agents, and forms
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {enabled ? (
            <>
              <Button
                size="sm"
                variant={paused ? 'default' : 'outline'}
                onClick={togglePause}
                title={paused ? 'Resume' : 'Pause'}
              >
                {paused ? <Play size={13} className="mr-1" /> : <Pause size={13} className="mr-1" />}
                {paused ? `Resume${pausedCount > 0 ? ` (${pausedCount})` : ''}` : 'Pause'}
              </Button>
              <Button size="sm" variant="outline" onClick={handleStop}>
                Stop
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={handleStart}>
              <Play size={13} className="mr-1" /> Start
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={clear} disabled={entries.length === 0}>
            <Trash2 size={13} className="mr-1" /> Clear
          </Button>
        </div>
      </div>

      {/* Two-pane body */}
      <div
        className="flex max-md:flex-col rounded-xl border overflow-hidden max-md:min-h-[60dvh] md:h-[calc(100vh-220px)]"
        style={{
          borderColor: 'var(--theme-surface-border)',
          backgroundColor: 'var(--theme-card-bg)',
        }}
      >
        {/* Left panel: controls */}
        <aside
          className="w-full md:w-[260px] md:shrink-0 flex flex-col md:border-r max-md:border-b p-4 gap-4 md:overflow-y-auto"
          style={{ borderColor: 'var(--theme-surface-border)' }}
        >
          {/* Status — reflects the actual Supabase channel state so
              users see 'Connecting' / 'Disconnected' instead of a
              lying "Live" badge when the subscription has failed. */}
          <StatusChip
            enabled={enabled}
            paused={paused}
            status={status}
            transport={transport}
            entriesCount={entries.length}
          />

          {/* Sources */}
          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
              Sources
            </h3>
            <div className="space-y-1">
              {SOURCES.map(s => {
                const Icon = s.icon
                const checked = selectedSources.has(s.id)
                return (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-[var(--theme-surface)] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSource(s.id)}
                      className="h-3.5 w-3.5 rounded accent-[color:var(--theme-primary)]"
                    />
                    <Icon size={12} style={{ color: s.color }} />
                    <span className="text-xs flex-1" style={{ color: 'var(--theme-card-text)' }}>{s.label}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Levels */}
          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
              Level
            </h3>
            <div className="space-y-1">
              {LEVELS.map(l => {
                const checked = selectedLevels.has(l.id)
                return (
                  <label
                    key={l.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-[var(--theme-surface)] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleLevel(l.id)}
                      className="h-3.5 w-3.5 rounded accent-[color:var(--theme-primary)]"
                    />
                    <span
                      className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: l.bg, color: l.color }}
                    >
                      {l.label}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Search */}
          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
              Search
            </h3>
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="message, metadata…"
                className="pl-8 !h-7 !text-xs"
              />
            </div>
          </div>

          <p className="text-[10px] mt-auto" style={{ color: 'var(--theme-muted-text)' }}>
            {enabled
              ? 'Pure live tail — only events that happen while this viewer is running. Tenant-scoped via RLS.'
              : 'Click Start to subscribe. Tenant-scoped via RLS.'}
          </p>
        </aside>

        {/* Right panel: entry list */}
        <section className="flex-1 min-w-0 flex flex-col">
          {entries.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <ScrollText size={48} className="opacity-20 mb-3" style={{ color: 'var(--theme-muted-text)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>
                {enabled ? 'Waiting for events…' : 'Live tail is stopped'}
              </p>
              <p className="text-xs mt-1 max-w-sm" style={{ color: 'var(--theme-muted-text)' }}>
                {enabled
                  ? 'Live tail active. Log rows from your selected sources will appear here as they happen.'
                  : 'Click Start to begin streaming. Only events that occur after you click Start will appear — this is a pure live tail, not an archive.'}
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>
                No entries match your filters.
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {filtered.map(entry => (
                <LogRow
                  key={entry.key}
                  entry={entry}
                  expanded={expandedKey === entry.key}
                  onToggleExpand={() => setExpandedKey(k => k === entry.key ? null : entry.key)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/* ─── Status chip ─── */

/**
 * Renders the connection status of the live tail in the left panel.
 * Four visual states map from the combination of `enabled`, `paused`,
 * and the raw subscription status:
 *
 *   enabled=false                 → "Stopped" (neutral)
 *   enabled + status=connecting   → "Connecting…" (warning yellow)
 *   enabled + status=error/closed → "Disconnected" (red)
 *   enabled + paused              → "Paused" (warning yellow)
 *   enabled + status=live         → "Live" (primary green, pulsing dot)
 */
function StatusChip({
  enabled, paused, status, transport, entriesCount,
}: {
  enabled: boolean
  paused: boolean
  status: LiveLogsStatus
  transport: LiveLogsTransport
  entriesCount: number
}) {
  let label: string
  let color: string
  let bg: string
  let border: string
  let pulse = false

  if (!enabled) {
    label = 'Stopped'
    color = 'var(--theme-muted-text)'
    bg = 'var(--theme-surface)'
    border = 'var(--theme-surface-border)'
  } else if (status === 'error') {
    label = 'Disconnected'
    color = 'var(--status-error)'
    bg = 'var(--status-error-bg)'
    border = 'var(--status-error)'
  } else if (status === 'closed') {
    label = 'Closed'
    color = 'var(--theme-muted-text)'
    bg = 'var(--theme-surface)'
    border = 'var(--theme-surface-border)'
  } else if (status === 'connecting') {
    label = 'Connecting…'
    color = 'var(--status-warning)'
    bg = 'var(--status-warning-bg)'
    border = 'var(--status-warning)'
  } else if (paused) {
    label = 'Paused'
    color = 'var(--status-warning)'
    bg = 'var(--status-warning-bg)'
    border = 'var(--status-warning)'
  } else {
    label = transport === 'polling' ? 'Live (Fallback)' : 'Live'
    color = 'var(--theme-primary)'
    bg = 'var(--theme-primary-light)'
    border = 'var(--theme-primary)'
    pulse = true
  }

  return (
    <div
      className="rounded-lg border px-3 py-2 text-[11px]"
      style={{ borderColor: border, backgroundColor: bg, color }}
    >
      <div className="flex items-center gap-1.5 font-semibold">
        <span
          className={cn('h-2 w-2 rounded-full', pulse && 'animate-pulse')}
          style={{ backgroundColor: color }}
        />
        {label}
      </div>
      <div className="mt-1">
        {entriesCount === 0 && enabled && status === 'live'
          ? 'Waiting for events…'
          : `${entriesCount} / 500 buffered${transport === 'polling' ? ' · polling' : transport === 'realtime' ? ' · realtime' : ''}`}
      </div>
    </div>
  )
}

/* ─── Log row ─── */

function LogRow({
  entry, expanded, onToggleExpand,
}: {
  entry: LiveLogEntry
  expanded: boolean
  onToggleExpand: () => void
}) {
  const sourceMeta = SOURCES.find(s => s.id === entry.source)!
  const levelMeta = LEVELS.find(l => l.id === entry.level)!
  const SourceIcon = sourceMeta.icon
  // Build a rich tooltip for the timestamp showing the exact datetime
  // plus a relative-time fallback so users can hover any entry to get
  // "at 10:42:01.317 — 6 seconds ago".
  const fullTimestamp = new Date(entry.timestamp).toLocaleString()
  const relativeTimestamp = formatRelativeDate(entry.timestamp)

  return (
    <div
      className="border-b transition-colors hover:bg-[var(--theme-row-highlight)]"
      style={{ borderColor: 'var(--theme-surface-border)' }}
    >
      <button
        onClick={onToggleExpand}
        className="w-full flex items-start gap-2 px-4 py-2 text-left"
      >
        {expanded
          ? <ChevronDown size={12} className="shrink-0 mt-1" style={{ color: 'var(--theme-muted-text)' }} />
          : <ChevronRight size={12} className="shrink-0 mt-1" style={{ color: 'var(--theme-muted-text)' }} />
        }
        {/* Exact time — fixed-width monospace so rows align when scanning. */}
        <span
          className="shrink-0 mt-0.5 text-[10px] font-mono tabular-nums"
          style={{ color: 'var(--theme-card-text)' }}
          title={`${fullTimestamp} — ${relativeTimestamp}`}
        >
          {formatExactTime(entry.timestamp)}
        </span>
        <span
          className="shrink-0 mt-0.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
          style={{ backgroundColor: levelMeta.bg, color: levelMeta.color }}
        >
          {levelMeta.label}
        </span>
        <span
          className="shrink-0 mt-0.5 inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ backgroundColor: 'var(--theme-surface)', color: sourceMeta.color }}
        >
          <SourceIcon size={9} /> {sourceMeta.label}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs truncate" style={{ color: 'var(--theme-card-text)' }}>
            {entry.title}
          </p>
          <div className="flex items-center gap-2 mt-0.5 min-w-0">
            {entry.subtitle && (
              <p className="text-[10px] truncate" style={{ color: 'var(--theme-muted-text)' }}>
                {entry.subtitle}
              </p>
            )}
            {/* Actor chip — shows who caused the event when we can
                resolve it. Avatar initials + name, kept small so it
                doesn't compete with the message content. Tooltip shows
                the full name for group hover debugging. */}
            {entry.actor && (
              <span
                className="inline-flex items-center gap-1 shrink-0 text-[10px]"
                style={{ color: 'var(--theme-muted-text)' }}
                title={entry.actor.name}
              >
                <span
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold"
                  style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}
                >
                  {getInitials(entry.actor.name)}
                </span>
                {entry.actor.name}
              </span>
            )}
            {!entry.actor && (
              <span
                className="inline-flex items-center gap-1 shrink-0 text-[10px]"
                style={{ color: 'var(--theme-muted-text)' }}
                title="No user attributed to this event"
              >
                <UserIcon size={9} /> system
              </span>
            )}
          </div>
        </div>
        {entry.href && (
          <Link
            href={entry.href}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 p-1 rounded hover:bg-[var(--theme-surface)]"
            style={{ color: 'var(--theme-muted-text)' }}
            title="Open detail"
          >
            <ExternalLink size={11} />
          </Link>
        )}
      </button>
      {expanded && (
        <div
          className="px-4 pb-3 pl-14"
          style={{ backgroundColor: 'var(--theme-surface)' }}
        >
          <div className="text-[10px] mb-1" style={{ color: 'var(--theme-muted-text)' }}>
            <span className="font-semibold">Exact time:</span> {fullTimestamp}
            {entry.actor && (
              <>
                {' · '}
                <span className="font-semibold">Actor:</span> {entry.actor.name}
                {' '}
                <span className="font-mono">({entry.actor.id.slice(0, 8)})</span>
              </>
            )}
          </div>
          <pre
            className="font-mono text-[10px] whitespace-pre-wrap break-all rounded p-2 max-h-64 overflow-auto"
            style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
          >
            {safeStringify(entry.raw)}
          </pre>
        </div>
      )}
    </div>
  )
}

function safeStringify(v: any): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return '[Unserializable value]'
  }
}
