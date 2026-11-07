'use client'

import { useState } from 'react'
import { useOnBehalf } from './on-behalf'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { respondToTask } from '@/app/actions/task-queue'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  Inbox, PauseCircle, XCircle, CheckCircle, MessageSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface TaskAcceptanceBannerProps {
  taskId: string
  status: string
  comment: string | null
  /**
   * Whether the viewer is the assignee (or, on a collaborative task, one of
   * them). null while unknown. Only assignees accept, hold or decline.
   */
  isAssignee?: boolean | null
  assigneeName?: string | null
}

const statusConfig: Record<string, {
  icon: typeof Inbox
  label: string
  description: string
  /** Box (wash + toned border) and icon colour, from the semantic tones. */
  boxClass: string
  iconClass: string
}> = {
  pending: {
    icon: Inbox,
    label: 'Queued',
    description: 'This task is waiting for the assignee to accept or decline it.',
    boxClass: 'bg-warning-wash border-[color-mix(in_srgb,var(--theme-warning)_30%,var(--ds-border))]',
    iconClass: 'text-warning',
  },
  held: {
    icon: PauseCircle,
    label: 'On hold',
    description: 'The assignee has put this task on hold.',
    boxClass: 'bg-warning-wash border-[color-mix(in_srgb,var(--theme-warning)_30%,var(--ds-border))]',
    iconClass: 'text-warning',
  },
  rejected: {
    icon: XCircle,
    label: 'Declined',
    description: 'The assignee has declined this task.',
    boxClass: 'bg-danger-wash border-[color-mix(in_srgb,var(--theme-danger)_30%,var(--ds-border))]',
    iconClass: 'text-danger',
  },
}

export function TaskAcceptanceBanner({ taskId, status, comment, isAssignee = null, assigneeName = null }: TaskAcceptanceBannerProps) {
  const [accepting, setAccepting] = useState(false)
  const [responding, setResponding] = useState<'held' | 'rejected' | null>(null)
  const [responseComment, setResponseComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const router = useRouter()
  const config = statusConfig[status]
  // Accept / hold / reject are the assignee's own (a manager acts through the outcome on their behalf).
  const onBehalf = useOnBehalf()
  const canRespond = onBehalf.canAct && !onBehalf.onBehalf && isAssignee === true

  if (!config) return null

  const Icon = config.icon
  const description = status === 'pending' && isAssignee === false
    ? `Waiting for ${assigneeName || 'the assignee'} to accept or decline it.`
    : config.description

  async function handleAccept() {
    setAccepting(true)
    setError(null)
    try {
      await respondToTask(taskId, 'accepted')
      queryClient.invalidateQueries({ queryKey: ['task-detail', taskId] })
      queryClient.invalidateQueries({ queryKey: ['task-tree', taskId] })
      queryClient.invalidateQueries({ queryKey: ['home'] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      router.refresh()
    } catch (err: any) {
      setError(err?.message ?? 'Failed to accept task')
      console.error('[task-acceptance-banner] Accept failed:', err?.message ?? err)
    }
    setAccepting(false)
  }

  async function handleSecondaryResponse(action: 'held' | 'rejected') {
    if (!responseComment.trim()) {
      setError(action === 'held' ? 'Please add a short reason for holding this task' : 'Please add a short reason for declining this task')
      return
    }
    setResponding(action)
    setError(null)
    try {
      await respondToTask(taskId, action, responseComment)
      queryClient.invalidateQueries({ queryKey: ['task-detail', taskId] })
      queryClient.invalidateQueries({ queryKey: ['task-tree', taskId] })
      queryClient.invalidateQueries({ queryKey: ['home'] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      router.refresh()
    } catch (err: any) {
      setError(err?.message ?? `Failed to ${action === 'held' ? 'hold' : 'decline'} task`)
    }
    setResponding(null)
  }

  return (
    <div className={cn('flex flex-wrap items-start gap-3 rounded-lg border p-3 text-fg', config.boxClass)} data-acceptance-banner={status}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', config.iconClass)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-ui font-semibold">{config.label}</p>
        <p className="mt-0.5 text-ui text-fg-muted">{description}</p>
        {comment && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-panel px-2.5 py-1.5 text-ui">
            <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-fg-muted" aria-hidden />
            <span>&ldquo;{comment}&rdquo;</span>
          </div>
        )}
        {error && <p className="mt-2 text-xs font-medium text-danger" role="alert">{error}</p>}
      </div>
      {status === 'pending' && canRespond && (
        <div className="min-w-[240px] shrink-0 space-y-2 max-md:w-full">
          <Textarea
            value={responseComment}
            onChange={(e) => setResponseComment(e.target.value)}
            rows={3}
            aria-label="Note for hold or decline"
            placeholder="Add a note if you need to hold or decline this task…"
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => handleSecondaryResponse('held')} disabled={accepting || responding !== null} loading={responding === 'held'}>
              {responding === 'held' ? 'Holding…' : 'Hold'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => handleSecondaryResponse('rejected')} disabled={accepting || responding !== null} loading={responding === 'rejected'}>
              {responding === 'rejected' ? 'Declining…' : 'Decline'}
            </Button>
            <Button size="sm" onClick={handleAccept} disabled={responding !== null} loading={accepting} leadingIcon={<CheckCircle />} className="shrink-0">
              {accepting ? 'Accepting…' : 'Accept'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
