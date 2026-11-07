'use client'

import { useState } from 'react'
import { ChevronRight, ChevronDown, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusBadge } from '@/components/ui/status-badge'

interface Task {
  id: string
  title: string
  status: string
  parent_task_id: string | null
  sequence: number
  progress_pct: number
  child_count: number
  completed_child_count: number
  estimated_effort_assigner: number | null
  actual_effort: number
  assignee_id: string | null
}

interface TaskTreeNodeProps {
  task: Task
  allSubtasks: Task[]
  depth: number
  onToggle: (id: string, status: string) => void
  buildTree: (parentId: string) => Task[]
  toggling?: string | null
}

export function TaskTreeNode({
  task, allSubtasks, depth, onToggle, buildTree, toggling,
}: TaskTreeNodeProps) {
  const [expanded, setExpanded] = useState(true)
  const children = buildTree(task.id)
  const hasChildren = children.length > 0
  const isDone = task.status === 'completed'
  const isToggling = toggling === task.id

  return (
    <>
      <div
        className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-2.5 transition-colors hover:bg-subtle"
        style={{ paddingLeft: `${16 + depth * 24}px` }}
      >
        {/* Expand/collapse */}
        {hasChildren ? (
          <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-label={expanded ? "Collapse subtasks" : "Expand subtasks"} className="size-4 shrink-0 text-fg-muted">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : <span className="w-4 shrink-0" />}

        {/* Checkbox */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (!isToggling) onToggle(task.id, task.status)
          }}
          disabled={isToggling}
          className={cn(
            'w-5 h-5 rounded-full border-[1.5px] shrink-0',
            'flex items-center justify-center transition-all',
            'hover:scale-110 active:scale-95',
            isDone && 'border-primary bg-primary',
            !isDone && 'border-border hover:border-border-strong',
            isToggling && 'opacity-50',
          )}
        >
          {isToggling ? (
            <Loader2 size={10} className="animate-spin text-fg" />
          ) : isDone ? (
            <Check size={10} className="text-primary-fg" />
          ) : null}
        </button>

        {/* Title */}
        <span className={cn(
          'text-ui font-medium flex-1 min-w-0 truncate',
          isDone ? 'text-fg-muted line-through' : 'text-fg',
        )}>
          {task.title}
        </span>

        {/* Effort */}
        {task.estimated_effort_assigner != null && task.estimated_effort_assigner > 0 && (
          <span className="text-xs font-mono shrink-0 text-fg-muted">
            {(task.estimated_effort_assigner / 60).toFixed(1)}h
          </span>
        )}

        <StatusBadge status={task.status} />
      </div>

      {expanded && children.map((child) => (
        <TaskTreeNode
          key={child.id}
          task={child}
          allSubtasks={allSubtasks}
          depth={depth + 1}
          onToggle={onToggle}
          buildTree={buildTree}
          toggling={toggling}
        />
      ))}
    </>
  )
}
