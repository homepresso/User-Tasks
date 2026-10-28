'use client'

import { useState } from 'react'
import { getInitials, formatRelativeDate } from '@/lib/utils'
import { serverRead } from '@/lib/server-read'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Send, MessageSquare } from 'lucide-react'

interface TimelineEvent {
  id: string
  event_type: string
  created_at: string
  metadata: any
  actor: { display_name: string; avatar_url: string | null } | null
  /** Assignee a manager acted for (lib/services/activity.ts). */
  on_behalf_of_name?: string | null
}

interface TimelineProps {
  events: TimelineEvent[]
  taskId: string
  tenantId: string
}

const eventLabels: Record<string, string> = {
  created: 'created this task',
  assigned: 'assigned this task',
  started: 'started working',
  reassigned: 'reassigned this task',
  escalated: 'escalated this task',
  completed: 'completed this task',
  cancelled: 'cancelled this task',
  blocked: 'marked as blocked',
  unblocked: 'unblocked this task',
  reopened: 'reopened this task',
  comment_added: 'added a comment',
  task_accepted: 'accepted this task',
  task_held: 'put this task on hold',
  task_rejected: 'rejected this task',
  task_data_saved: 'updated the task fields',
}

const eventColors: Record<string, string> = {
  created: 'var(--theme-primary)',
  started: 'var(--status-info)',
  completed: 'var(--theme-success)',
  reassigned: 'var(--theme-warning)',
  escalated: 'var(--theme-danger)',
  blocked: 'var(--theme-danger)',
  unblocked: 'var(--theme-success)',
  cancelled: 'var(--theme-muted-text)',
  comment_added: 'var(--theme-accent)',
  task_accepted: 'var(--theme-success)',
  task_held: 'var(--theme-warning)',
  task_rejected: 'var(--theme-danger)',
}

export function ActivityTimeline({ events, taskId, tenantId }: TimelineProps) {
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [localEvents, setLocalEvents] = useState<TimelineEvent[]>([])
  const queryClient = useQueryClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!comment.trim()) return

    setSending(true)
    const { data: profile } = await serverRead('tasks.myProfile')

    const { addTaskComment } = await import('@/app/actions/tasks')
    const result = await addTaskComment(taskId, comment.trim())

    if (!result.ok) {
} else {
      setLocalEvents(prev => [{
        id: crypto.randomUUID(),
        event_type: 'comment_added',
        created_at: new Date().toISOString(),
        metadata: { message: comment.trim(), source: 'user' },
        actor: {
          display_name: (profile as any)?.display_name ?? 'You',
          avatar_url: (profile as any)?.avatar_url ?? null,
        },
      }, ...prev])
      setComment('')
    }
    setSending(false)
  }

  const allEvents = [...localEvents, ...events]

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
        Activity
      </h3>

      {/* Comment input */}
      <form onSubmit={handleSubmit} className="mb-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <MessageSquare
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--theme-muted-text)' }}
            />
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment..."
              className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm"
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-surface-border)',
                color: 'var(--theme-card-text)',
              }}
            />
          </div>
          <Button type="submit" size="sm" disabled={sending || !comment.trim()}>
            <Send size={14} />
          </Button>
        </div>
      </form>

      {/* Events */}
      {allEvents.length > 0 && (
        <div className="space-y-3">
          {allEvents.map((event) => {
            const isComment = event.event_type === 'comment_added'
            const message = event.metadata?.message || event.metadata?.comment
            const isTaskMessageEvent = event.metadata?.source === 'task_message'
            const messageSubject = event.metadata?.subject
            const messageRecipientCount = Number(event.metadata?.recipient_count ?? 0)
            const isSubtaskEvent = event.metadata?.source === 'subtask_toggle'
            const subtaskTitle = event.metadata?.subtask_title
            const isEffortEvent = event.metadata?.source === 'effort_log' || event.metadata?.source === 'timer_entry'
            const effortHours = event.metadata?.hours
            const effortNotes = event.metadata?.notes
            const effortDuration = event.metadata?.duration

            // Determine display label
            let eventLabel: string
            if (isEffortEvent) {
              eventLabel = event.metadata?.source === 'timer_entry' ? 'logged time' : 'logged effort'
            } else if (isTaskMessageEvent) {
              eventLabel = 'sent a message'
            } else if (isSubtaskEvent) {
              eventLabel = event.event_type === 'completed' ? 'completed subtask' : 'reopened subtask'
            } else {
              eventLabel = eventLabels[event.event_type] ?? event.event_type.replace(/_/g, ' ')
            }

            // Determine dot color
            const dotColor = isEffortEvent
              ? 'var(--theme-accent)'
              : isTaskMessageEvent
                ? 'var(--theme-primary-hover)'
                : (eventColors[event.event_type] ?? 'var(--theme-muted-text)')

            return (
              <div key={event.id} className="flex gap-3 text-sm items-start">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5"
                  style={{ backgroundColor: dotColor }}
                />
                <div className="flex-1 min-w-0">
                  <div>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {event.actor?.display_name ?? 'System'}
                    </span>{' '}
                    <span className="text-gray-500">{eventLabel}</span>
                    {event.metadata?.on_behalf_of && (
                      <span className="ml-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold" data-on-behalf-event
                        style={{ backgroundColor: event.metadata?.acted_as === 'break_glass' ? 'var(--status-blocked-bg)' : 'var(--status-info-bg, var(--theme-primary-light))', color: event.metadata?.acted_as === 'break_glass' ? 'var(--status-blocked)' : 'var(--theme-primary-text)' }}>
                        {event.metadata?.acted_as === 'break_glass' ? 'break-glass · ' : ''}on behalf of {event.on_behalf_of_name ?? 'the assignee'}
                      </span>
                    )}
                    {isEffortEvent && (
                      <span className="text-xs font-semibold ml-1" style={{ color: 'var(--theme-accent-text)' }}>
                        {effortHours}h
                        {effortDuration && <span className="font-normal ml-1">({effortDuration})</span>}
                      </span>
                    )}
                    {subtaskTitle && (
                      <span className="text-xs font-medium ml-1" style={{ color: 'var(--theme-primary-text)' }}>
                        &ldquo;{subtaskTitle}&rdquo;
                      </span>
                    )}
                    {isTaskMessageEvent && messageRecipientCount > 0 && (
                      <span className="text-xs font-medium ml-1" style={{ color: 'var(--theme-primary-hover)' }}>
                        to {messageRecipientCount} recipient{messageRecipientCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  {event.metadata?.on_behalf_note && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>
                      Reason: {String(event.metadata.on_behalf_note)}
                    </p>
                  )}
                  {isEffortEvent && effortNotes && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>
                      {effortNotes}
                    </p>
                  )}
                  {isTaskMessageEvent && messageSubject && (
                    <p className="mt-1 text-xs font-medium" style={{ color: 'var(--theme-card-text)' }}>
                      Subject: {messageSubject}
                    </p>
                  )}
                  {isComment && message && (
                    <p
                      className="mt-1 text-xs rounded-lg px-3 py-2"
                      style={{
                        backgroundColor: isTaskMessageEvent ? 'color-mix(in srgb, var(--theme-primary-hover) 10%, var(--theme-surface))' : 'var(--theme-surface)',
                        color: 'var(--theme-card-text)',
                      }}
                    >
                      {message}
                    </p>
                  )}
                </div>
                <span className="text-xs shrink-0" style={{ color: 'var(--theme-muted-text)' }}>
                  {formatRelativeDate(event.created_at)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
