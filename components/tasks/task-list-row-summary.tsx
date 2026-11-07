'use client'

import { ReactNode } from 'react'
import { ExternalLink, GripVertical, Pencil, Clock, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import { OrgBadge } from '@/components/ui/org-badge'
import { PriorityBadge } from '@/components/ui/priority-badge'
import { StatusPill } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Tooltip } from '@/components/ui/tooltip'
import { TaskProgressStrip } from '@/components/tasks/task-progress-strip'
import { getTaskCode } from '@/components/tasks/timesheet-helpers'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { cn } from '@/lib/utils'

interface TaskListRowSummaryProps {
  task: any
  expanded?: boolean
  onToggle?: () => void
  onOpen?: () => void
  dragHandle?: {
    ref?: (node: HTMLElement | null) => void
    attributes?: Record<string, any>
    listeners?: Record<string, any>
  } | null
  topMeta?: ReactNode
  bottomBadges?: ReactNode
  rightMeta?: ReactNode
}

/** Progress of a task row: subtasks done when it has any, else its own progress (100 when closed). */
export function taskRowProgress(task: any): { pct: number; hasChildren: boolean; completed: number; total: number } {
  const isDone = task.status === 'completed' || task.status === 'cancelled'
  const total = task.subtask_count ?? task.child_count ?? 0
  const completed = task.completed_subtask_count ?? task.completed_child_count ?? 0
  const hasChildren = total > 0
  const pct = hasChildren ? Math.round((completed / Math.max(total, 1)) * 100) : (task.progress_pct ?? (isDone ? 100 : 0))
  return { pct, hasChildren, completed, total }
}

/** Overdue: past its due date and not completed. */
export function isTaskOverdue(task: { due_date?: string | null; status?: string }): boolean {
  return Boolean(task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed')
}

/** Due date cell content: relative, tabular; overdue in danger text with a 14px clock; absolute in a tooltip. */
export function TaskDue({ task }: { task: { due_date?: string | null; status?: string } }) {
  if (!task.due_date) return <span className="text-fg-subtle">—</span>
  const overdue = isTaskOverdue(task)
  return (
    <Tooltip content={formatAbsolute(task.due_date)}>
      <span className={cn('num inline-flex items-center justify-end gap-1 whitespace-nowrap', overdue ? 'text-danger' : 'text-fg-muted')}>
        {overdue && <Clock className="size-3.5" aria-hidden />}
        {overdue && <span className="sr-only">Overdue: </span>}
        {formatRelative(task.due_date)}
      </span>
    </Tooltip>
  )
}

/**
 * One task as a flat summary row (legacy list layout). Lists that render a
 * Table use the helpers above instead (AssignedTaskRow).
 */
export function TaskListRowSummary({
  task,
  expanded = false,
  onToggle,
  onOpen,
  dragHandle = null,
  topMeta = null,
  bottomBadges = null,
  rightMeta = null,
}: TaskListRowSummaryProps) {
  const isDone = task.status === 'completed' || task.status === 'cancelled'
  const isDarkRow = task.workflow_source != null || task.is_workflow_task || task.priority === 'critical'
  const { pct: progressPct, hasChildren, completed: completedChildren, total: totalChildren } = taskRowProgress(task)

  return (
    <div
      className={cn('flex cursor-pointer items-center gap-3 px-3 py-2.5 text-ui transition-colors duration-[var(--ds-dur-fast)] hover:bg-subtle', isDarkRow ? 'bg-subtle' : 'bg-panel')}
      onClick={onToggle}
      onDoubleClick={onOpen}
    >
      {dragHandle ? (
        <Tooltip content="Drag to reorder">
          <button
            ref={dragHandle.ref}
            {...(dragHandle.attributes ?? {})}
            {...(dragHandle.listeners ?? {})}
            aria-label="Drag to reorder"
            className="shrink-0 cursor-grab touch-none text-fg-subtle hover:text-fg-muted active:cursor-grabbing"
            onClick={(event) => event.stopPropagation()}
          >
            <GripVertical className="size-4" />
          </button>
        </Tooltip>
      ) : (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          className="shrink-0 text-fg-muted"
          onClick={(event) => {
            event.stopPropagation()
            onToggle?.()
          }}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
      )}

      <div className="w-28 shrink-0 max-sm:hidden">
        <TaskProgressStrip value={progressPct} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex size-5 shrink-0 items-center justify-center text-fg-subtle" aria-hidden>
            {task.workflow_source || task.is_workflow_task ? <Pencil className="size-3.5" /> : <Clock className="size-3.5" />}
          </span>
          <span className={cn('shrink-0 font-mono text-xs text-fg-muted', isDone && 'line-through')}>
            {getTaskCode(task)}
          </span>
          <span className={cn('truncate font-medium text-fg', isDone && 'line-through text-fg-muted')}>
            {task.title}
          </span>
          {task.tenant && (
            <OrgBadge
              name={task.tenant.name}
              slug={task.tenant.slug}
              color={task.tenant.branding?.primary_color}
              size="sm"
            />
          )}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
          {task.assignee && <span>{task.assignee.display_name}</span>}
          {task.assignee && (hasChildren || topMeta) && <span aria-hidden>·</span>}
          {hasChildren && (
            <>
              <span className="num">{completedChildren}/{totalChildren} subtasks</span>
              {topMeta && <span aria-hidden>·</span>}
            </>
          )}
          {topMeta ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{topMeta}</div> : null}
        </div>

        {bottomBadges ? <div className="mt-1 flex flex-wrap items-center gap-2">{bottomBadges}</div> : null}
      </div>

      {rightMeta ? <div className="flex shrink-0 flex-col items-end gap-1">{rightMeta}</div> : null}

      <StatusPill status={task.status} />
      <PriorityBadge priority={task.priority} />
      {task.due_date && <TaskDue task={task} />}

      <IconButton
        size="sm"
        label="Open task"
        icon={<ExternalLink />}
        onClick={(event) => {
          event.stopPropagation()
          onOpen?.()
        }}
      />

      {dragHandle ? (
        <span className="shrink-0 text-fg-muted" aria-hidden>
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </span>
      ) : null}
    </div>
  )
}
