'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, ChevronDown, Check, Loader2, ListPlus, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusBadge } from '@/components/ui/status-badge'
import { IconButton } from '@/components/ui/icon-button'
import { formatDay } from '@/lib/format/date'
import { SubtaskForm } from './subtask-form'

export interface TreeTask {
  id: string
  title: string
  subtitle?: string | null
  description?: string | null
  status: string
  priority?: string | null
  due_date?: string | null
  tags?: string[] | null
  parent_task_id: string | null
  sequence: number
  progress_pct: number
  child_count: number
  completed_child_count: number
  estimated_effort_assigner: number | null
  estimated_effort_assignee?: number | null
  actual_effort: number
  assignee_id: string | null
}

interface TaskTreeNodeProps {
  task: TreeTask
  depth: number
  onToggle: (id: string, status: string) => void
  buildTree: (parentId: string) => TreeTask[]
  toggling?: string | null
  canEdit?: boolean
  /** May a subtask be added under a node at this level (0 = a direct subtask)? */
  canAddUnder?: (level: number) => boolean
  onChanged?: () => Promise<void> | void
}

/** 90 → "1.5h", 45 → "45m". */
function effortText(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = minutes / 60
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`
}

export function TaskTreeNode({
  task, depth, onToggle, buildTree, toggling, canEdit = false, canAddUnder, onChanged,
}: TaskTreeNodeProps) {
  const [expanded, setExpanded] = useState(true)
  const [mode, setMode] = useState<'view' | 'edit' | 'add'>('view')
  const children = buildTree(task.id)
  const hasChildren = children.length > 0
  const isDone = task.status === 'completed'
  const isToggling = toggling === task.id
  const estimate = Number(task.estimated_effort_assignee || 0) || Number(task.estimated_effort_assigner || 0) || 0
  const indent = { paddingLeft: `${16 + depth * 20}px` }
  const canAdd = canAddUnder?.(depth) ?? false

  if (mode === 'edit') {
    return (
      <>
        <div className="border-b border-border-subtle py-2 pr-3" style={indent} data-task-tree-edit={task.id}>
          <SubtaskForm
            parentTaskId={task.parent_task_id ?? ''}
            subtaskId={task.id}
            initial={{
              title: task.title, subtitle: task.subtitle, description: task.description,
              estimated_effort_minutes: task.estimated_effort_assigner, due_date: task.due_date, priority: task.priority, tags: task.tags,
            }}
            defaultPriority={task.priority}
            onSaved={async () => { setMode('view'); await onChanged?.() }}
            onCancel={() => setMode('view')}
          />
        </div>
        {expanded && children.map((child) => (
          <TaskTreeNode key={child.id} task={child} depth={depth + 1} onToggle={onToggle} buildTree={buildTree} toggling={toggling} canEdit={canEdit} canAddUnder={canAddUnder} onChanged={onChanged} />
        ))}
      </>
    )
  }

  return (
    <>
      <div
        className="group flex items-start gap-2 border-b border-border-subtle py-2.5 pr-2 transition-colors hover:bg-subtle sm:gap-2.5 sm:pr-3"
        style={indent}
        data-task-tree-node={task.id}
      >
        {/* Expand/collapse */}
        {hasChildren ? (
          <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-label={expanded ? "Collapse subtasks" : "Expand subtasks"} className="mt-0.5 size-4 shrink-0 text-fg-muted">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : <span className="w-4 shrink-0" />}

        {/* Checkbox */}
        <button
          type="button"
          role="checkbox"
          aria-checked={isDone}
          aria-label={`${isDone ? 'Reopen' : 'Complete'} subtask: ${task.title}`}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (!isToggling) onToggle(task.id, task.status)
          }}
          disabled={isToggling || !canEdit}
          className={cn(
            'mt-px w-5 h-5 rounded-full border-[1.5px] shrink-0',
            'flex items-center justify-center transition-all',
            canEdit && 'hover:scale-110 active:scale-95',
            isDone && 'border-primary bg-primary',
            !isDone && 'border-border hover:border-border-strong',
            (isToggling || !canEdit) && 'opacity-50',
          )}
        >
          {isToggling ? (
            <Loader2 size={10} className="animate-spin text-fg" />
          ) : isDone ? (
            <Check size={10} className="text-primary-fg" />
          ) : null}
        </button>

        {/* Title + subtitle */}
        <span className="min-w-0 flex-1">
          <Link href={`/tasks/${task.id}`} className={cn(
            'block truncate text-ui font-medium hover:underline',
            isDone ? 'text-fg-muted line-through' : 'text-fg',
          )}>
            {task.title}
          </Link>
          {task.subtitle && <span className="block truncate text-xs text-fg-muted" data-task-tree-subtitle>{task.subtitle}</span>}
          {/* Phones: the estimate and due date go under the title. */}
          {(estimate > 0 || task.due_date) && (
            <span className="mt-0.5 flex gap-2 text-xs text-fg-muted sm:hidden">
              {estimate > 0 && <span className="num">{effortText(estimate)}</span>}
              {task.due_date && <span className="num">Due {formatDay(task.due_date)}</span>}
            </span>
          )}
        </span>

        {/* Effort / due (wider screens) */}
        {estimate > 0 && (
          <span className="mt-0.5 hidden shrink-0 text-xs font-mono text-fg-muted sm:inline" title="Estimate" data-task-tree-effort>
            {effortText(estimate)}
          </span>
        )}
        {task.due_date && <span className="num mt-0.5 hidden shrink-0 text-xs text-fg-muted sm:inline">{formatDay(task.due_date)}</span>}

        {/* Phones: the round checkbox shows done / to do, so the title keeps the room. */}
        <span className="hidden shrink-0 sm:inline-flex"><StatusBadge status={task.status} /></span>

        {canEdit && (
          <span className="-my-1 flex shrink-0 items-center">
            <IconButton size="sm" label={`Edit subtask: ${task.title}`} icon={<Pencil />} onClick={() => setMode('edit')} data-task-tree-edit-button />
            {canAdd && <IconButton size="sm" label={`Add a subtask under ${task.title}`} icon={<ListPlus />} onClick={() => { setExpanded(true); setMode('add') }} data-task-tree-add-under />}
          </span>
        )}
      </div>

      {expanded && children.map((child) => (
        <TaskTreeNode
          key={child.id}
          task={child}
          depth={depth + 1}
          onToggle={onToggle}
          buildTree={buildTree}
          toggling={toggling}
          canEdit={canEdit}
          canAddUnder={canAddUnder}
          onChanged={onChanged}
        />
      ))}
      {mode === 'add' && (
        <div className="border-b border-border-subtle py-2 pr-3" style={{ paddingLeft: `${16 + (depth + 1) * 20}px` }}>
          <SubtaskForm
            parentTaskId={task.id}
            defaultPriority={task.priority}
            compact
            onSaved={async (_sub, { closed }) => { if (closed) setMode('view'); await onChanged?.() }}
            onCancel={() => setMode('view')}
          />
        </div>
      )}
    </>
  )
}
