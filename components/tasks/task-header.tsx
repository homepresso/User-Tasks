'use client'

import { PriorityBadge } from '@/components/ui/priority-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { reopenTask } from '@/app/actions/tasks'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, RefreshCw, Check, RotateCcw, Save } from 'lucide-react'
import { TaskOutcomeDialog } from './task-outcome-dialog'
import { TaskAcceptanceBanner } from './task-acceptance-banner'
import { useOnBehalf } from './on-behalf'
import { CollaboratorBar } from './collaborator-bar'
import { formatRelativeDate } from '@/lib/utils'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { rerouteTask } from '@/app/actions/task-queue'
import { useTenantUsers } from '@/hooks/use-tenant-users'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { TaskDescription } from '@/components/tasks/task-description'

interface TaskHeaderProps {
  task: {
    id: string
    title: string
    description: string | null
    status: string
    priority: string
    due_date: string | null
    assignee_id: string | null
    assigner_id: string | null
    created_at: string
    outcome: string | null
    outcome_notes: string | null
    available_outcomes: string[] | null
    acceptance_status?: string
    acceptance_comment?: string | null
    accepted_at?: string | null
    is_workflow_task?: boolean
    event_id?: string | null
    allow_reassign?: boolean | null
    allow_escalate?: boolean | null
  }
  tenant: { id: string; name: string; slug: string; branding: any } | null
  assigneeName?: string | null
  assignerName?: string | null
  collaborators?: any[]
  fields?: TaskFieldDef[]
  fieldValues?: Record<string, unknown>
  onFieldErrors?: (errors: Record<string, string>) => void
}

export function TaskHeader({ task, tenant: _tenant, assigneeName, assignerName, collaborators, fields, fieldValues, onFieldErrors }: TaskHeaderProps) {
  void _tenant
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: users } = useTenantUsers()
  const [completing, setCompleting] = useState(false)
  const [reopenError, setReopenError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [actionPanel, setActionPanel] = useState<'redirect' | 'escalate' | null>(null)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [routingComment, setRoutingComment] = useState('')
  const [routingBusy, setRoutingBusy] = useState(false)
  const [routingMessage, setRoutingMessage] = useState<string | null>(null)
  const [routingError, setRoutingError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    import('@/lib/get-user-id').then(async ({ getUserId }) => {
      const userId = await getUserId()
      if (!cancelled) setCurrentUserId(userId)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave() {
    setSaveState('saving')
    await new Promise(r => setTimeout(r, 300))
    router.refresh()
    setSaveState('saved')
    setTimeout(() => setSaveState('idle'), 2000)
  }

  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed'
  const isDone = task.status === 'completed'
  // Redirect / escalate are the assignee's (managers reassign from My team).
  const onBehalf = useOnBehalf()
  const ownsActions = onBehalf.canAct && !onBehalf.onBehalf
  const canRedirect = task.allow_reassign === true && ownsActions
  const canEscalate = task.allow_escalate !== false && ownsActions
  const availableTargets = (users ?? []).filter((user: any) => user.id !== currentUserId)

  async function handleReopen() {
    setCompleting(true)
    setReopenError(null)
    const result = await reopenTask(task.id)
    if (!result.ok) {
      setReopenError(result.error)
      setCompleting(false)
      return
    }
    queryClient.invalidateQueries({ queryKey: ['task-tree', task.id] })
    queryClient.invalidateQueries({ queryKey: ['task-detail', task.id] })
    setCompleting(false)
    router.refresh()
  }

  async function handleRouteTask(mode: 'redirect' | 'escalate') {
    if (!selectedUserId) {
      setRoutingError('Choose a user first')
      return
    }
    setRoutingBusy(true)
    setRoutingError(null)
    setRoutingMessage(null)
    try {
      const result = await rerouteTask(task.id, mode, {
        targetUserId: selectedUserId,
        comment: routingComment || undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['task-detail', task.id] })
      queryClient.invalidateQueries({ queryKey: ['task-tree', task.id] })
      queryClient.invalidateQueries({ queryKey: ['task-queue'] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      setRoutingMessage(
        mode === 'redirect'
          ? (result.targetUserName ? `Task redirected to ${result.targetUserName}.` : 'Task redirected.')
          : (result.targetUserName ? `Task escalated to ${result.targetUserName}.` : 'Task escalated.')
      )
      setSelectedUserId('')
      setRoutingComment('')
      setActionPanel(null)
      router.refresh()
    } catch (err: any) {
      setRoutingError(err?.message ?? `Unable to ${mode} task`)
    }
    setRoutingBusy(false)
  }

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
        <Link href="/tasks" className="hover:underline" style={{ color: 'var(--theme-primary-text)' }}>My tasks</Link>
        <span>/</span>
        <span className="min-w-0 truncate">{task.title}</span>
      </nav>

      {task.acceptance_status && task.acceptance_status !== 'accepted' && (
        <TaskAcceptanceBanner
          taskId={task.id}
          status={task.acceptance_status}
          comment={task.acceptance_comment ?? null}
        />
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold leading-tight">{task.title}</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
            {assignerName ? `Assigned by ${assignerName}` : 'Self-assigned'}
            {' · '}Created {formatRelativeDate(task.created_at)}
          </p>
        </div>
        {!isDone && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              variant={saveState === 'saved' ? 'default' : 'outline'}
              size="sm"
              onClick={handleSave}
              disabled={saveState === 'saving'}
              style={saveState === 'saved' ? { backgroundColor: 'var(--theme-success)', borderColor: 'var(--theme-success)' } : undefined}
            >
              {saveState === 'saving' ? (
                <><RefreshCw size={14} className="mr-1 animate-spin" /> Saving...</>
              ) : saveState === 'saved' ? (
                <><Check size={14} className="mr-1" /> Saved</>
              ) : (
                <><Save size={14} className="mr-1" /> Refresh</>
              )}
            </Button>
            {canEscalate && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setActionPanel(actionPanel === 'escalate' ? null : 'escalate')
                  setRoutingError(null)
                  setRoutingMessage(null)
                }}
              >
                <ArrowUpRight size={14} className="mr-1" /> Escalate
              </Button>
            )}
            {canRedirect && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setActionPanel(actionPanel === 'redirect' ? null : 'redirect')
                  setRoutingError(null)
                  setRoutingMessage(null)
                }}
              >
                <RefreshCw size={14} className="mr-1" /> Reassign
              </Button>
            )}
            <TaskOutcomeDialog
              taskId={task.id}
              taskTitle={task.title}
              outcomes={(task.available_outcomes as string[]) ?? ['completed']}
              isWorkflowTask={!!task.is_workflow_task}
              eventId={task.event_id}
              fields={fields}
              fieldValues={fieldValues}
              onFieldErrors={onFieldErrors}
              onComplete={() => router.refresh()}
            />
          </div>
        )}
        {isDone && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {task.outcome && (
              <span
                className="text-xs font-medium px-2.5 py-1 rounded-full"
                style={{
                  backgroundColor: task.outcome === 'approved' ? 'var(--status-done-bg)'
                    : task.outcome === 'rejected' ? 'var(--status-blocked-bg)'
                    : task.outcome === 'deferred' ? 'var(--status-progress-bg)'
                    : 'var(--theme-primary-light)',
                  color: task.outcome === 'approved' ? 'var(--status-done)'
                    : task.outcome === 'rejected' ? 'var(--status-blocked)'
                    : task.outcome === 'deferred' ? 'var(--status-progress)'
                    : 'var(--theme-primary-text)',
                }}
              >
                {task.outcome.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={handleReopen} disabled={completing}>
              <RotateCcw size={14} className="mr-1" /> Reopen
            </Button>
            {reopenError && (
              <span className="text-xs font-medium text-red-600 dark:text-red-400">{reopenError}</span>
            )}
          </div>
        )}
      </div>

      {actionPanel && (
        <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>
              {actionPanel === 'redirect' ? 'Reassign task' : 'Escalate task'}
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
              {actionPanel === 'redirect'
                ? 'Move ownership of this task to another user and send it back through acceptance.'
                : 'Escalate this task to another user while keeping a clear audit trail.'}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>
                User
              </label>
              <AutocompleteSelect
                value={selectedUserId}
                placeholder="Select a user"
                size="md"
                options={availableTargets.map((user: any) => ({
                  value: user.id,
                  label: user.display_name || user.email,
                  hint: user.display_name ? user.email : undefined,
                }))}
                onChange={setSelectedUserId}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>
                Note
              </label>
              <Input
                value={routingComment}
                onChange={(e) => setRoutingComment(e.target.value)}
                placeholder={actionPanel === 'redirect' ? 'Why are you redirecting this task?' : 'Why are you escalating this task?'}
              />
            </div>
          </div>

          {routingError && (
            <p className="text-xs font-medium text-red-600 dark:text-red-400">
              {routingError}
            </p>
          )}
          {routingMessage && (
            <p className="text-xs font-medium" style={{ color: 'var(--theme-success)' }}>
              {routingMessage}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setActionPanel(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => handleRouteTask(actionPanel)} disabled={routingBusy}>
              {routingBusy ? 'Saving...' : actionPanel === 'redirect' ? 'Reassign Task' : 'Escalate Task'}
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-3 px-1" style={{ borderTop: '1px solid var(--theme-surface-border)', borderBottom: '1px solid var(--theme-surface-border)' }}>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--theme-muted-text)' }}>Priority</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <PriorityBadge priority={task.priority} />
          </div>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--theme-muted-text)' }}>Due Date</p>
          <p className={`text-sm font-medium ${isOverdue ? 'text-red-500' : ''}`}>
            {task.due_date ? formatRelativeDate(task.due_date) : '—'}
            {isOverdue && ' (overdue)'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--theme-muted-text)' }}>
            {collaborators && collaborators.length > 0 ? 'Collaborators' : 'Assignee'}
          </p>
          {collaborators && collaborators.length > 0 ? (
            <CollaboratorBar collaborators={collaborators} />
          ) : (
            <p className="text-sm font-medium">{assigneeName ?? 'Unassigned'}</p>
          )}
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--theme-muted-text)' }}>Status</p>
          <p className="text-sm font-medium">
            {(task.status || 'todo').split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
          </p>
        </div>
      </div>

      {task.description && (
        <TaskDescription value={task.description} className="text-sm leading-relaxed" style={{ color: 'var(--theme-muted-text)' }} />
      )}
    </div>
  )
}
