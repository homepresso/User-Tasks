'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Filter,
  MessageSquare,
  MoveRight,
  PlayCircle,
} from 'lucide-react'

type TimelineEvent = {
  id: string
  timestamp: string
  eventType: string
  taskId?: string | null
  taskTitle: string
  taskStatus?: string | null
  summary: string
  metadata?: Record<string, any>
}

interface Props {
  events: TimelineEvent[]
  mode?: 'report' | 'widget'
  title?: string
  subtitle?: string
}

const TIMELINE_FILTERS = [
  { id: 'all', label: 'All Events' },
  { id: 'completed', label: 'Completed' },
  { id: 'started', label: 'Started' },
  { id: 'escalated', label: 'Escalations' },
  { id: 'redirected', label: 'Redirected' },
  { id: 'comment_added', label: 'Comments' },
] as const

function timelineFilterMatches(filter: string, eventType: string) {
  if (filter === 'all') return true
  return eventType === filter
}

function timelineIcon(eventType: string) {
  if (eventType === 'completed') return CheckSquare
  if (eventType === 'started') return PlayCircle
  if (eventType === 'comment_added') return MessageSquare
  if (eventType === 'redirected' || eventType === 'reassigned' || eventType === 'delegated') return MoveRight
  if (eventType === 'escalated') return AlertTriangle
  return Activity
}

function timelineAccent(eventType: string) {
  if (eventType === 'completed') return { bg: 'rgba(16,185,129,0.12)', fg: '#047857' }
  if (eventType === 'started') return { bg: 'rgba(59,130,246,0.12)', fg: '#1D4ED8' }
  if (eventType === 'comment_added') return { bg: 'rgba(168,85,247,0.12)', fg: '#7E22CE' }
  if (eventType === 'redirected' || eventType === 'reassigned' || eventType === 'delegated') return { bg: 'rgba(14,165,233,0.12)', fg: '#0369A1' }
  if (eventType === 'escalated') return { bg: 'rgba(245,158,11,0.16)', fg: '#B45309' }
  return { bg: 'var(--theme-surface)', fg: 'var(--theme-card-text)' }
}

function formatFullDateTime(date: string | Date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date))
}

function formatRelativeDate(date: string | Date): string {
  const d = new Date(date)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  if (diffDays > 1 && diffDays <= 7) return `In ${diffDays} days`
  if (diffDays < -1 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function PersonalActivityTimeline({
  events,
  mode = 'report',
  title,
  subtitle,
}: Props) {
  const [timelineFilter, setTimelineFilter] = useState<string>('all')
  const [expandedTimelineIds, setExpandedTimelineIds] = useState<Record<string, boolean>>({})
  const [page, setPage] = useState(1)
  const pageSize = mode === 'widget' ? 10 : 10

  const filteredEvents = useMemo(
    () => events.filter((event) => timelineFilterMatches(timelineFilter, event.eventType)),
    [events, timelineFilter]
  )

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pagedEvents = mode === 'widget'
    ? filteredEvents.slice(0, 10)
    : filteredEvents.slice((safePage - 1) * pageSize, safePage * pageSize)

  function toggleTimelineItem(id: string) {
    setExpandedTimelineIds((current) => ({ ...current, [id]: !current[id] }))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title ?? (mode === 'widget' ? 'Recent Activity' : 'What You’ve Been Doing')}</h3>
          {subtitle && (
            <p className="text-[11px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
              {subtitle}
            </p>
          )}
        </div>
        {mode === 'report' && (
          <span className="text-[10px] px-2 py-1 rounded-full" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
            {timelineFilter === 'all' ? 'All events' : timelineFilter.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {mode === 'report' && (
        <div className="flex flex-wrap gap-2">
          {TIMELINE_FILTERS.map((filter) => {
            const active = timelineFilter === filter.id
            return (
              <button
                key={filter.id}
                onClick={() => {
                  setTimelineFilter(filter.id)
                  setPage(1)
                }}
                className="px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors"
                style={{
                  backgroundColor: active ? 'var(--theme-primary)' : 'var(--theme-surface)',
                  color: active ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
                  border: '1px solid var(--theme-surface-border)',
                }}
              >
                {filter.label}
              </button>
            )
          })}
        </div>
      )}

      {pagedEvents.length === 0 ? (
        <p className="text-xs py-8 text-center" style={{ color: 'var(--theme-muted-text)' }}>
          No matching events for this filter yet.
        </p>
      ) : (
        <div className={mode === 'widget' ? 'space-y-2 max-h-[420px] overflow-y-auto pr-1' : 'space-y-3'}>
          {pagedEvents.map((event, index) => {
            const Icon = timelineIcon(event.eventType)
            const accent = timelineAccent(event.eventType)
            const expanded = !!expandedTimelineIds[event.id]
            const metadataEntries = Object.entries(event.metadata ?? {}).filter(([, value]) => value != null && value !== '')

            return (
              <div key={event.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    style={{ backgroundColor: accent.bg, color: accent.fg }}
                  >
                    <Icon size={14} />
                  </span>
                  {mode === 'report' && index < pagedEvents.length - 1 && (
                    <span className="w-px flex-1 mt-2" style={{ backgroundColor: 'var(--theme-surface-border)', minHeight: 28 }} />
                  )}
                </div>

                <div
                  className="flex-1 rounded-xl border overflow-hidden"
                  style={{ borderColor: 'var(--theme-surface-border)' }}
                >
                  <button
                    type="button"
                    onClick={() => toggleTimelineItem(event.id)}
                    className="w-full p-4 text-left transition-colors hover:bg-[var(--theme-row-highlight)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold truncate">{event.taskTitle}</p>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: accent.bg, color: accent.fg }}>
                            {event.eventType.replace(/_/g, ' ')}
                          </span>
                          {event.taskStatus && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                              {event.taskStatus.replace(/_/g, ' ')}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] mt-2" style={{ color: 'var(--theme-card-text)' }}>
                          {event.summary}
                        </p>
                        <div className="flex flex-wrap gap-3 mt-2 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                          <span>{formatFullDateTime(event.timestamp)}</span>
                          <span>{formatRelativeDate(event.timestamp)}</span>
                        </div>
                      </div>
                      <span className="shrink-0 mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>
                        {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </span>
                    </div>
                  </button>

                  {expanded && (
                    <div className="border-t px-4 py-3 space-y-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
                        <div className="rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>Event</p>
                          <p className="mt-1 font-medium">{event.eventType.replace(/_/g, ' ')}</p>
                        </div>
                        <div className="rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>Occurred</p>
                          <p className="mt-1 font-medium">{formatFullDateTime(event.timestamp)}</p>
                        </div>
                        <div className="rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>Task</p>
                          <p className="mt-1 font-medium truncate">{event.taskTitle}</p>
                        </div>
                      </div>

                      {metadataEntries.length > 0 && (
                        <div className="rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                          <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>Event Details</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                            {metadataEntries.map(([key, value]) => (
                              <div key={key} className="rounded-md px-2.5 py-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
                                <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>
                                  {key.replace(/_/g, ' ')}
                                </p>
                                <p className="mt-1 break-words" style={{ color: 'var(--theme-card-text)' }}>
                                  {typeof value === 'string' ? value : JSON.stringify(value)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex justify-end">
                        <Link
                          href={event.taskId ? `/tasks/${event.taskId}` : '/tasks'}
                          className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
                          style={{ color: 'var(--theme-primary-text)' }}
                        >
                          Open task <ArrowRight size={12} />
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {mode === 'report' && filteredEvents.length > pageSize && (
        <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
          <span>
            Showing {(safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, filteredEvents.length)} of {filteredEvents.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage === 1}
              className="px-2 py-1 rounded border disabled:opacity-40"
              style={{ borderColor: 'var(--theme-surface-border)' }}
            >
              Prev
            </button>
            <span>Page {safePage} of {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage === totalPages}
              className="px-2 py-1 rounded border disabled:opacity-40"
              style={{ borderColor: 'var(--theme-surface-border)' }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
