'use client'

import { useState } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { cn } from '@/lib/utils'
import { serverRead } from '@/lib/server-read'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Tooltip } from '@/components/ui/tooltip'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { plural } from '@/lib/format/plural'
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

/** Timeline dot per event: semantic tone, neutral by default. */
const eventDots: Record<string, string> = {
  created: 'bg-primary',
  started: 'bg-info',
  completed: 'bg-success',
  reassigned: 'bg-warning',
  escalated: 'bg-danger',
  blocked: 'bg-danger',
  unblocked: 'bg-success',
  cancelled: 'bg-fg-subtle',
  comment_added: 'bg-primary',
  task_accepted: 'bg-success',
  task_held: 'bg-warning',
  task_rejected: 'bg-danger',
}

export function ActivityTimeline({ events, taskId }: TimelineProps) {
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  // Synchronous guard: a double Enter / click in one frame would post the comment twice.
  const commentGuard = useSubmitGuard()
  const [localEvents, setLocalEvents] = useState<TimelineEvent[]>([])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await commentGuard.run(async () => {
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
    })
  }

  const allEvents = [...localEvents, ...events]

  return (
    <Card padding="none" data-task-activity>
      <CardHeader title="Comments and activity" />

      {/* Comment input: stays in view on a phone while the thread scrolls. */}
      <form onSubmit={handleSubmit} className="flex gap-2 px-4 pb-4 max-md:sticky max-md:top-0 max-md:z-10 max-md:bg-panel max-md:pt-2" data-task-comment-composer>
        <Input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment…"
          aria-label="Add a comment"
          leading={<MessageSquare />}
          wrapperClassName="flex-1"
        />
        <IconButton type="submit" variant="primary" label="Post comment" icon={<Send />} disabled={!comment.trim()} loading={sending} />
      </form>

      {/* Events */}
      {allEvents.length > 0 && (
        <ol className="space-y-3 border-t border-border-subtle px-4 py-4">
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
            const breakGlass = event.metadata?.acted_as === 'break_glass'

            // Determine display label
            let eventLabel: string
            if (isEffortEvent) {
              eventLabel = event.metadata?.source === 'timer_entry' ? 'logged time' : 'logged effort'
            } else if (isTaskMessageEvent) {
              eventLabel = 'sent a message'
            } else if (event.event_type === 'reassigned' && event.metadata?.took_ownership) {
              eventLabel = 'took ownership of this task'
            } else if ((event.metadata?.action === 'viewers_invited' || event.metadata?.action === 'viewer_removed') && typeof event.metadata?.message === 'string') {
              // Invite (read only): "invited Finance (team) to view" / "stopped sharing with Priya Nair".
              eventLabel = event.metadata.message
            } else if (isSubtaskEvent) {
              eventLabel = event.event_type === 'completed' ? 'completed subtask' : 'reopened subtask'
            } else {
              eventLabel = eventLabels[event.event_type] ?? event.event_type.replace(/_/g, ' ')
            }

            const dot = isEffortEvent || isTaskMessageEvent ? 'bg-primary' : (eventDots[event.event_type] ?? 'bg-fg-subtle')

            return (
              <li key={event.id} className="flex items-start gap-3 text-ui">
                <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', dot)} />
                <div className="min-w-0 flex-1">
                  <div>
                    <span className="font-medium text-fg">
                      {event.actor?.display_name ?? 'System'}
                    </span>{' '}
                    <span className="text-fg-muted">{eventLabel}</span>
                    {event.metadata?.on_behalf_of && (
                      <Badge tone={breakGlass ? 'danger' : 'info'} className="ml-1" data-on-behalf-event>
                        {breakGlass ? 'break-glass · ' : ''}on behalf of {event.on_behalf_of_name ?? 'the assignee'}
                      </Badge>
                    )}
                    {isEffortEvent && (
                      <span className="num ml-1 text-xs font-semibold text-fg">
                        {effortHours}h
                        {effortDuration && <span className="ml-1 font-normal text-fg-muted">({effortDuration})</span>}
                      </span>
                    )}
                    {subtaskTitle && (
                      <span className="ml-1 text-xs font-medium text-primary-text">
                        &ldquo;{subtaskTitle}&rdquo;
                      </span>
                    )}
                    {isTaskMessageEvent && messageRecipientCount > 0 && (
                      <span className="ml-1 text-xs font-medium text-fg-muted">
                        to {plural(messageRecipientCount, 'recipient')}
                      </span>
                    )}
                  </div>
                  {event.metadata?.on_behalf_note && (
                    <p className="mt-0.5 text-xs text-fg-muted">
                      Reason: {String(event.metadata.on_behalf_note)}
                    </p>
                  )}
                  {isEffortEvent && effortNotes && (
                    <p className="mt-0.5 text-xs text-fg-muted">{effortNotes}</p>
                  )}
                  {isTaskMessageEvent && messageSubject && (
                    <p className="mt-1 text-xs font-medium text-fg">Subject: {messageSubject}</p>
                  )}
                  {isComment && message && (
                    <p className={cn('mt-1 rounded-md px-3 py-2 text-ui text-fg', isTaskMessageEvent ? 'bg-primary-wash' : 'bg-subtle')}>
                      {message}
                    </p>
                  )}
                </div>
                <Tooltip content={formatAbsolute(event.created_at)}>
                  <time dateTime={event.created_at} className="shrink-0 text-xs text-fg-muted">
                    {formatRelative(event.created_at)}
                  </time>
                </Tooltip>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}
