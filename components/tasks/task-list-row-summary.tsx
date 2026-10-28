'use client'

import { ReactNode } from 'react'
import { ExternalLink, GripVertical, Pencil, Clock, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import { OrgBadge } from '@/components/ui/org-badge'
import { PriorityBadge } from '@/components/ui/priority-badge'
import { TaskProgressStrip } from '@/components/tasks/task-progress-strip'
import { EffortBadge, getEffortBadge, getTaskCode } from '@/components/tasks/timesheet-helpers'
import { formatRelativeDate, cn } from '@/lib/utils'

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
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed'
  const isDarkRow = task.workflow_source != null || task.is_workflow_task || task.priority === 'critical'
  const hasChildren = (task.subtask_count ?? task.child_count ?? 0) > 0
  const completedChildren = task.completed_subtask_count ?? task.completed_child_count ?? 0
  const totalChildren = task.subtask_count ?? task.child_count ?? 0
  const progressPct = hasChildren
    ? Math.round((completedChildren / Math.max(totalChildren, 1)) * 100)
    : (task.progress_pct ?? (isDone ? 100 : 0))
  const badge = getEffortBadge(task.status, task.priority)

  return (
    <div
      className="flex items-center gap-3 px-3 py-3 cursor-pointer transition-colors"
      style={{
        backgroundColor: isDarkRow ? 'var(--theme-row-highlight-strong)' : 'var(--theme-card-bg)',
        borderLeftWidth: 3,
        borderLeftColor: isOverdue ? 'var(--theme-danger)' : 'transparent',
      }}
      onClick={onToggle}
      onDoubleClick={onOpen}
    >
      {dragHandle ? (
        <button
          ref={dragHandle.ref}
          {...(dragHandle.attributes ?? {})}
          {...(dragHandle.listeners ?? {})}
          className={cn(
            'shrink-0 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none',
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <GripVertical size={14} />
        </button>
      ) : (
        <button
          type="button"
          className="shrink-0"
          style={{ color: 'var(--theme-muted-text)' }}
          onClick={(event) => {
            event.stopPropagation()
            onToggle?.()
          }}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      )}

      <div className="w-28 shrink-0 max-sm:hidden">
        <TaskProgressStrip value={progressPct} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-400">
            {task.workflow_source || task.is_workflow_task ? <Pencil size={12} /> : <Clock size={12} />}
          </div>
          <span className={cn('font-bold text-sm', 'text-gray-900 dark:text-white', isDone && 'line-through opacity-60')}>
            {getTaskCode(task)}
          </span>
          <span className={cn('text-sm truncate', 'text-gray-700 dark:text-gray-300', isDone && 'line-through opacity-60')}>
            · {task.title}
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

        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          {task.assignee && (
            <span className="text-xs text-gray-500">
              {task.assignee.display_name}
            </span>
          )}
          {task.assignee && (hasChildren || topMeta) && (
            <span className="text-xs text-gray-400">·</span>
          )}
          {hasChildren && (
            <>
              <span className="text-xs text-gray-500">
                {completedChildren}/{totalChildren} subtasks
              </span>
              {topMeta && <span className="text-xs text-gray-400">·</span>}
            </>
          )}
          {topMeta ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
              {topMeta}
            </div>
          ) : null}
        </div>

        {bottomBadges ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {bottomBadges}
          </div>
        ) : null}
      </div>

      {rightMeta ? (
        <div className="flex flex-col items-end shrink-0 gap-1">
          {rightMeta}
        </div>
      ) : null}

      <EffortBadge config={badge} />
      <PriorityBadge priority={task.priority} />

      {task.due_date && (
        <span className={cn('text-xs whitespace-nowrap shrink-0', isOverdue ? 'text-red-600 font-medium' : 'text-gray-500')}>
          {formatRelativeDate(task.due_date)}
        </span>
      )}

      <button
        type="button"
        className="shrink-0 hover:opacity-70 transition-opacity"
        style={{ color: 'var(--theme-primary-text)' }}
        title="Open task"
        onClick={(event) => {
          event.stopPropagation()
          onOpen?.()
        }}
      >
        <ExternalLink size={14} />
      </button>

      {dragHandle ? (
        <span className="shrink-0" style={{ color: 'var(--theme-muted-text)' }}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      ) : null}
    </div>
  )
}
