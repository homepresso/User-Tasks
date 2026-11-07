'use client'

import { PriorityBadge } from '@/components/ui/priority-badge'
import { Badge, StatusPill, type Tone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Card } from '@/components/ui/card'
import { InlineNotice } from '@/components/ui/inline-notice'
import { PageHeader } from '@/components/ui/page-header'
import { TaskFollowToggle } from '@/components/tasks/task-follow-button'
import { Tooltip } from '@/components/ui/tooltip'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { reopenTask } from '@/app/actions/tasks'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, RefreshCw, Check, Copy, MoreHorizontal, RotateCcw, Clock, Workflow } from 'lucide-react'
import Link from 'next/link'
import { usePermissions } from '@/lib/permissions-context'
import { TaskOutcomeDialog, outcomeLabel } from './task-outcome-dialog'
import { TaskAcceptanceBanner } from './task-acceptance-banner'
import { useOnBehalf } from './on-behalf'
import { CollaboratorBar } from './collaborator-bar'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { rerouteTask } from '@/app/actions/task-queue'
import { useTenantUsers } from '@/hooks/use-tenant-users'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { TaskDescription } from '@/components/tasks/task-description'
import { getTaskCode } from '@/components/tasks/timesheet-helpers'

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
    assignment_mode?: string | null
  }
  tenant: { id: string; name: string; slug: string; branding: any } | null
  assigneeName?: string | null
  assignerName?: string | null
  collaborators?: any[]
  fields?: TaskFieldDef[]
  fieldValues?: Record<string, unknown>
  onFieldErrors?: (errors: Record<string, string>) => void
  /** The form's grid (steps / tabs: fields on hidden pages are not required). */
  formLayout?: unknown
  /** Show the description under the meta strip (the tabbed task page shows it in Details). */
  showDescription?: boolean
  /** Phones: the actions also render into this element (a sticky bar at the foot of the page) and leave the header. */
  mobileActionsTarget?: HTMLElement | null
  /** The task was completed with an outcome here (the page shows the Task completed screen). */
  onCompleted?: (outcome: string) => void
}

/** Tone of a recorded outcome (approved = success, rejected = danger, deferred = warning). */
function outcomeTone(outcome: string): Tone {
  if (outcome === 'approved' || outcome === 'completed') return 'success'
  if (outcome === 'rejected') return 'danger'
  if (outcome === 'deferred') return 'warning'
  return 'brand'
}

export function TaskHeader({ task, tenant, assigneeName, assignerName, collaborators, fields, fieldValues, onFieldErrors, formLayout, showDescription = true, mobileActionsTarget = null, onCompleted }: TaskHeaderProps) {
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
  const [copied, setCopied] = useState(false)

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
  // Only the assignee (on a collaborative task, any of them) accepts, declines,
  // redirects or escalates; the server re-checks.
  const collaborative = task.assignment_mode === 'collaborative'
  const isAssignee: boolean | null = currentUserId === null
    ? null
    : collaborative
      ? (collaborators ?? []).some((c: any) => c?.user_id === currentUserId)
      : task.assignee_id === currentUserId
  const ownsActions = onBehalf.canAct && !onBehalf.onBehalf && isAssignee === true
  const canRedirect = task.allow_reassign === true && ownsActions
  const canEscalate = task.allow_escalate !== false && ownsActions
  const availableTargets = (users ?? []).filter((user: any) => user.id !== currentUserId)
  const code = getTaskCode({ id: task.id, tenant })

  async function copyId() {
    try {
      await navigator.clipboard.writeText(task.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable */ }
  }

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
      queryClient.invalidateQueries({ queryKey: ['home'] })
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

  function openPanel(mode: 'redirect' | 'escalate') {
    setActionPanel(actionPanel === mode ? null : mode)
    setRoutingError(null)
    setRoutingMessage(null)
  }

  // Process view: workflow tasks open their run — the full run view with workflows.view_runs, else the
  // submitter-safe progress view (anyone with a task in the run may see it; lib/tasks/completion-screen.ts).
  const { can } = usePermissions()
  const runId = (task as { workflow_run_id?: string | null }).workflow_run_id ?? null
  const viewFlow = runId ? (
    <Button asChild variant="secondary" size="sm" leadingIcon={<Workflow />} data-task-view-flow>
      <Link href={can('workflows.view_runs') ? `/automations/runs/${runId}` : `/home/runs/${runId}`}>Process view</Link>
    </Button>
  ) : null

  // Follow (Task tracker → Following): open or closed, a task can be followed from its page.
  const follow = <TaskFollowToggle taskId={task.id} />
  const actions = !isDone ? (
    <>
      {follow}
      {viewFlow}
      <TaskOutcomeDialog
        taskId={task.id}
        taskTitle={task.title}
        outcomes={(task.available_outcomes as string[]) ?? ['completed']}
        isWorkflowTask={!!task.is_workflow_task}
        eventId={task.event_id}
        fields={fields}
        fieldValues={fieldValues}
        onFieldErrors={onFieldErrors}
        formLayout={formLayout}
        onComplete={(result) => { if (result?.completed) onCompleted?.(result.outcome); router.refresh() }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="More actions" icon={<MoreHorizontal />} variant="secondary" size="sm" data-task-more />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            icon={saveState === 'saved' ? <Check /> : <RefreshCw className={saveState === 'saving' ? 'animate-spin' : undefined} />}
            disabled={saveState === 'saving'}
            onSelect={() => { void handleSave() }}
          >
            {saveState === 'saving' ? 'Refreshing…' : saveState === 'saved' ? 'Refreshed' : 'Refresh'}
          </DropdownMenuItem>
          {canEscalate && (
            <DropdownMenuItem icon={<ArrowUpRight />} onSelect={() => openPanel('escalate')}>Escalate…</DropdownMenuItem>
          )}
          {canRedirect && (
            <DropdownMenuItem icon={<RefreshCw />} onSelect={() => openPanel('redirect')}>Reassign…</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  ) : (
    <>
      {follow}
      {viewFlow}
      {task.outcome && <Badge tone={outcomeTone(task.outcome)} pill dot>{outcomeLabel(task.outcome)}</Badge>}
      <Button variant="secondary" size="sm" onClick={handleReopen} loading={completing} leadingIcon={<RotateCcw />}>
        Reopen
      </Button>
    </>
  )

  return (
    <div className="space-y-4">
      {task.acceptance_status && task.acceptance_status !== 'accepted' && (
        <TaskAcceptanceBanner
          taskId={task.id}
          status={task.acceptance_status}
          comment={task.acceptance_comment ?? null}
          isAssignee={isAssignee}
          assigneeName={assigneeName ?? null}
        />
      )}

      <PageHeader
        className="mb-0"
        breadcrumbs={[
          { label: 'My tasks', href: '/tasks' },
          {
            label: (
              <span className="inline-flex items-center gap-1">
                <span className="font-mono">{code}</span>
                <IconButton
                  label={copied ? 'Copied' : 'Copy task ID'}
                  icon={copied ? <Check /> : <Copy />}
                  size="sm"
                  className="size-5"
                  onClick={copyId}
                  data-task-copy-id
                />
              </span>
            ),
          },
        ]}
        title={<span className="line-clamp-2 whitespace-normal">{task.title}</span>}
        description={
          <>
            {assignerName ? `Assigned by ${assignerName}` : 'Self-assigned'}
            {' · '}Created{' '}
            <Tooltip content={formatAbsolute(task.created_at)}>
              <time dateTime={task.created_at}>{formatRelative(task.created_at).replace(/^(Yesterday|Just now)/, (w) => w.toLowerCase())}</time>
            </Tooltip>
          </>
        }
        actions={<div className={`${mobileActionsTarget ? 'hidden md:flex' : 'flex'} flex-wrap items-center justify-end gap-2`}>{actions}</div>}
      />
      {mobileActionsTarget && createPortal(actions, mobileActionsTarget)}
      {reopenError && <InlineNotice tone="danger">{reopenError}</InlineNotice>}
      {routingMessage && !actionPanel && <InlineNotice tone="success">{routingMessage}</InlineNotice>}

      {actionPanel && (
        <Card padding="md" className="space-y-3" data-task-route-panel={actionPanel}>
          <div>
            <p className="text-base font-semibold text-fg">
              {actionPanel === 'redirect' ? 'Reassign task' : 'Escalate task'}
            </p>
            <p className="mt-1 text-ui text-fg-muted">
              {actionPanel === 'redirect'
                ? 'Move ownership of this task to another user and send it back through acceptance.'
                : 'Escalate this task to another user while keeping a clear audit trail.'}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Field label="User">
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
            </Field>
            <Field label="Note" optional>
              <Input
                value={routingComment}
                onChange={(e) => setRoutingComment(e.target.value)}
                placeholder={actionPanel === 'redirect' ? 'Why are you redirecting this task?' : 'Why are you escalating this task?'}
              />
            </Field>
          </div>

          {routingError && <InlineNotice tone="danger">{routingError}</InlineNotice>}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setActionPanel(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => handleRouteTask(actionPanel)} loading={routingBusy}>
              {routingBusy ? 'Saving…' : actionPanel === 'redirect' ? 'Reassign task' : 'Escalate task'}
            </Button>
          </div>
        </Card>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border-subtle py-3 md:grid-cols-4" data-task-meta>
        <div className="min-w-0">
          <dt className="mb-1 text-xs text-fg-muted">Priority</dt>
          <dd><PriorityBadge priority={task.priority} className="text-ui" /></dd>
        </div>
        <div className="min-w-0">
          <dt className="mb-1 text-xs text-fg-muted">Due date</dt>
          <dd className={`flex items-center gap-1 text-ui font-medium ${isOverdue ? 'text-danger' : 'text-fg'}`}>
            {isOverdue && <Clock className="size-3.5 shrink-0" aria-hidden />}
            {task.due_date ? (
              <Tooltip content={formatAbsolute(task.due_date)}>
                <time dateTime={task.due_date} className="num">{formatRelative(task.due_date)}</time>
              </Tooltip>
            ) : '—'}
            {isOverdue && <span className="font-normal">· overdue</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="mb-1 text-xs text-fg-muted">
            {collaborators && collaborators.length > 0 ? 'Collaborators' : 'Assignee'}
          </dt>
          <dd className="truncate text-ui font-medium text-fg">
            {collaborators && collaborators.length > 0 ? (
              <CollaboratorBar collaborators={collaborators} />
            ) : (
              assigneeName ?? 'Unassigned'
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="mb-1 text-xs text-fg-muted">Status</dt>
          <dd><StatusPill status={task.status || 'todo'} /></dd>
        </div>
      </dl>

      {showDescription && task.description && (
        <TaskDescription value={task.description} className="text-sm leading-relaxed text-fg-muted" />
      )}
    </div>
  )
}
