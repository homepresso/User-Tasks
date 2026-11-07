'use client'

import { cn } from '@/lib/utils'
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

/** Token classes for an event's icon tile and type badge (status washes, neutral otherwise). */
function timelineAccent(eventType: string): string {
  if (eventType === 'completed') return 'bg-success-wash text-success'
  if (eventType === 'started') return 'bg-info-wash text-info'
  if (eventType === 'escalated') return 'bg-warning-wash text-warning'
  if (eventType === 'comment_added' || eventType === 'redirected' || eventType === 'reassigned' || eventType === 'delegated') return 'bg-primary-wash text-primary-text'
  return 'bg-subtle text-fg'
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
          <h3 className="text-sm font-semibold text-fg">{title ?? (mode === 'widget' ? 'Recent Activity' : 'What You’ve Been Doing')}</h3>
          {subtitle && (
            <p className="text-2xs mt-1 text-fg-muted">
              {subtitle}
            </p>
          )}
        </div>
        {mode === 'report' && (
          <span className="text-2xs px-2 py-1 rounded-full bg-bg text-fg-muted">
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
                aria-pressed={active}
                className={cn('rounded-full border px-2.5 py-1 text-xs font-medium transition-colors', active ? 'border-border-strong bg-muted text-fg' : 'border-border bg-panel text-fg-muted hover:text-fg')}
              >
                {filter.label}
              </button>
            )
          })}
        </div>
      )}

      {pagedEvents.length === 0 ? (
        <p className="text-xs py-8 text-center text-fg-muted">
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
                    className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', accent)}
                  >
                    <Icon size={14} />
                  </span>
                  {mode === 'report' && index < pagedEvents.length - 1 && (
                    <span className="mt-2 min-h-7 w-px flex-1 bg-border" />
                  )}
                </div>

                <div
                  className="flex-1 rounded-xl border overflow-hidden border-border"
                >
                  <button
                    type="button"
                    onClick={() => toggleTimelineItem(event.id)}
                    className="w-full p-4 text-left transition-colors hover:bg-subtle"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold truncate">{event.taskTitle}</p>
                          <span className={cn('rounded-full px-1.5 py-0.5 text-2xs', accent)}>
                            {event.eventType.replace(/_/g, ' ')}
                          </span>
                          {event.taskStatus && (
                            <span className="text-2xs px-1.5 py-0.5 rounded-full bg-bg text-fg-muted">
                              {event.taskStatus.replace(/_/g, ' ')}
                            </span>
                          )}
                        </div>
                        <p className="text-2xs mt-2 text-fg">
                          {event.summary}
                        </p>
                        <div className="flex flex-wrap gap-3 mt-2 text-2xs text-fg-muted">
                          <span>{formatFullDateTime(event.timestamp)}</span>
                          <span>{formatRelativeDate(event.timestamp)}</span>
                        </div>
                      </div>
                      <span className="shrink-0 mt-0.5 text-fg-muted">
                        {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </span>
                    </div>
                  </button>

                  {expanded && (
                    <div className="border-t px-4 py-3 space-y-3 border-border bg-bg">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-2xs">
                        <div className="rounded-lg border p-3 border-border bg-panel">
                          <p className="text-xs text-fg-muted">Event</p>
                          <p className="mt-1 font-medium">{event.eventType.replace(/_/g, ' ')}</p>
                        </div>
                        <div className="rounded-lg border p-3 border-border bg-panel">
                          <p className="text-xs text-fg-muted">Occurred</p>
                          <p className="mt-1 font-medium">{formatFullDateTime(event.timestamp)}</p>
                        </div>
                        <div className="rounded-lg border p-3 border-border bg-panel">
                          <p className="text-xs text-fg-muted">Task</p>
                          <p className="mt-1 font-medium truncate">{event.taskTitle}</p>
                        </div>
                      </div>

                      {metadataEntries.length > 0 && (
                        <div className="rounded-lg border p-3 border-border bg-panel">
                          <p className="text-xs mb-2 text-fg-muted">Event Details</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-2xs">
                            {metadataEntries.map(([key, value]) => (
                              <div key={key} className="rounded-md px-2.5 py-2 bg-bg">
                                <p className="text-xs text-fg-muted">
                                  {key.replace(/_/g, ' ')}
                                </p>
                                <p className="mt-1 break-words text-fg">
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
                          className="inline-flex items-center gap-1 text-2xs font-medium hover:underline text-primary-text"
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
        <div className="flex items-center justify-between text-2xs text-fg-muted">
          <span>
            Showing {(safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, filteredEvents.length)} of {filteredEvents.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage === 1}
              className="px-2 py-1 rounded border disabled:opacity-40 border-border"
            >
              Prev
            </button>
            <span>Page {safePage} of {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage === totalPages}
              className="px-2 py-1 rounded border disabled:opacity-40 border-border"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
