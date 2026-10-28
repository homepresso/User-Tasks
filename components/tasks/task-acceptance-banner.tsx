'use client'

import { useState } from 'react'
import { useOnBehalf } from './on-behalf'
import { Button } from '@/components/ui/button'
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
}

const statusConfig: Record<string, {
  icon: typeof Inbox
  label: string
  description: string
  bgClass: string
  textClass: string
  borderClass: string
}> = {
  pending: {
    icon: Inbox,
    label: 'Pending Acceptance',
    description: 'This task is waiting to be accepted by the assignee.',
    bgClass: 'bg-amber-50 dark:bg-amber-900/10',
    textClass: 'text-amber-800 dark:text-amber-300',
    borderClass: 'border-amber-200 dark:border-amber-800',
  },
  held: {
    icon: PauseCircle,
    label: 'On Hold',
    description: 'The assignee has put this task on hold.',
    bgClass: 'bg-orange-50 dark:bg-orange-900/10',
    textClass: 'text-orange-800 dark:text-orange-300',
    borderClass: 'border-orange-200 dark:border-orange-800',
  },
  rejected: {
    icon: XCircle,
    label: 'Rejected',
    description: 'The assignee has rejected this task.',
    bgClass: 'bg-red-50 dark:bg-red-900/10',
    textClass: 'text-red-800 dark:text-red-300',
    borderClass: 'border-red-200 dark:border-red-800',
  },
}

export function TaskAcceptanceBanner({ taskId, status, comment }: TaskAcceptanceBannerProps) {
  const [accepting, setAccepting] = useState(false)
  const [responding, setResponding] = useState<'held' | 'rejected' | null>(null)
  const [responseComment, setResponseComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const router = useRouter()
  const config = statusConfig[status]
  // Accept / hold / reject are the assignee's own (a manager acts through the outcome on their behalf).
  const onBehalf = useOnBehalf()
  const canRespond = onBehalf.canAct && !onBehalf.onBehalf

  if (!config) return null

  const Icon = config.icon

  async function handleAccept() {
    setAccepting(true)
    setError(null)
    try {
      await respondToTask(taskId, 'accepted')
      queryClient.invalidateQueries({ queryKey: ['task-detail', taskId] })
      queryClient.invalidateQueries({ queryKey: ['task-tree', taskId] })
      queryClient.invalidateQueries({ queryKey: ['task-queue'] })
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
      setError(action === 'held' ? 'Please add a short reason for holding this task' : 'Please add a short reason for rejecting this task')
      return
    }
    setResponding(action)
    setError(null)
    try {
      await respondToTask(taskId, action, responseComment)
      queryClient.invalidateQueries({ queryKey: ['task-detail', taskId] })
      queryClient.invalidateQueries({ queryKey: ['task-tree', taskId] })
      queryClient.invalidateQueries({ queryKey: ['task-queue'] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      router.refresh()
    } catch (err: any) {
      setError(err?.message ?? `Failed to ${action === 'held' ? 'hold' : 'reject'} task`)
    }
    setResponding(null)
  }

  return (
    <div className={cn(
      'rounded-lg border p-3 flex flex-wrap items-start gap-3',
      config.bgClass, config.borderClass
    )}>
      <Icon size={18} className={cn('shrink-0 mt-0.5', config.textClass)} />
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-semibold', config.textClass)}>
          {config.label}
        </p>
        <p className={cn('text-xs mt-0.5', config.textClass, 'opacity-80')}>
          {config.description}
        </p>
        {comment && (
          <div className={cn(
            'mt-2 flex items-start gap-1.5 text-xs rounded-md px-2.5 py-1.5',
            'bg-white/60 dark:bg-black/20'
          )}>
            <MessageSquare size={12} className="shrink-0 mt-0.5 opacity-60" />
            <span className={config.textClass}>&ldquo;{comment}&rdquo;</span>
          </div>
        )}
        {error && (
          <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
      {status === 'pending' && canRespond && (
        <div className="shrink-0 min-w-[240px] max-md:w-full space-y-2">
          <textarea
            value={responseComment}
            onChange={(e) => setResponseComment(e.target.value)}
            rows={3}
            placeholder="Add a note if you need to hold or reject this task..."
            className="w-full rounded-lg border px-3 py-2 text-xs"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
          />
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => handleSecondaryResponse('held')} disabled={accepting || responding !== null}>
              {responding === 'held' ? 'Holding...' : 'Hold'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleSecondaryResponse('rejected')} disabled={accepting || responding !== null}>
              {responding === 'rejected' ? 'Rejecting...' : 'Reject'}
            </Button>
            <Button size="sm" onClick={handleAccept} disabled={accepting || responding !== null} className="shrink-0">
              <CheckCircle size={14} className="mr-1" />
              {accepting ? 'Accepting...' : 'Accept'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
