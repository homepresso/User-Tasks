'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { setSubtaskCompleted } from '@/app/actions/tasks'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { InlineNotice } from '@/components/ui/inline-notice'
import { SUBTASK_MAX_DEPTH } from '@/lib/tasks/subtask-input'
import { SubtaskForm } from './subtask-form'
import { TaskTreeNode, type TreeTask } from './task-tree-node'

interface TaskTreeProps {
  task: TreeTask & { tenant_id?: string; priority?: string | null }
  subtasks: TreeTask[]
  totalCount: number
  completedCount: number
  /** May add subtasks here (lib/services/tasks canAddSubtask, read with the task). */
  canAdd?: boolean
  /** May tick and edit subtasks (tasks.complete on a task they can reach). */
  canEdit?: boolean
  /** How many levels down this task is (subtasks go at most SUBTASK_MAX_DEPTH deep). */
  depth?: number
}

/** Everything a subtask change can affect: this page, its parent's, the lists and panels. */
const REFRESH_KEYS = [['task-detail'], ['task-tree'], ['tasks'], ['assigned-tasks'], ['team-tasks'], ['home'], ['subtasks']] as const

/**
 * The task page's subtasks: the whole tree (ticks update the parent's
 * progress), each with its subtitle, estimate and due date; "Add subtask"
 * (the shared SubtaskForm — title, then More details) at the top level and
 * under any subtask that isn't at the depth limit, and Edit on each row.
 */
export function TaskTree({ task, subtasks: initialSubtasks, totalCount, completedCount, canAdd = false, canEdit = false, depth = 0 }: TaskTreeProps) {
  const queryClient = useQueryClient()
  const [toggling, setToggling] = useState<string | null>(null)
  const [localOverrides, setLocalOverrides] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Apply optimistic overrides for instant UI feedback
  const subtasks = initialSubtasks.map(s =>
    localOverrides[s.id] ? { ...s, status: localOverrides[s.id] } : s
  )

  function buildTree(parentId: string): TreeTask[] {
    return subtasks
      .filter((s) => s.parent_task_id === parentId)
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
  }

  async function refresh() {
    await Promise.all(REFRESH_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })))
  }

  async function toggleComplete(taskId: string, currentStatus: string) {
    if (toggling) return
    const newStatus = currentStatus === 'completed' ? 'todo' : 'completed'

    // Optimistic: update UI immediately
    setToggling(taskId)
    setError(null)
    setLocalOverrides(prev => ({ ...prev, [taskId]: newStatus }))

    // Updates the subtask and logs the change on this task's timeline.
    const result = await setSubtaskCompleted(taskId, newStatus === 'completed', task.id)

    if (!result.ok) {
      setLocalOverrides(prev => { const next = { ...prev }; delete next[taskId]; return next })
      setError(result.error)
      setToggling(null)
      return
    }

    // Fresh counts and progress (the parent's child counts follow from the tasks trigger).
    await refresh()
    setLocalOverrides(prev => { const next = { ...prev }; delete next[taskId]; return next })
    setToggling(null)
  }

  const optimisticCompleted = subtasks.filter(s => s.status === 'completed').length
  const directChildren = buildTree(task.id)
  const total = Math.max(totalCount - 1, subtasks.length)

  return (
    <Card padding="none" className="overflow-hidden" data-task-tree>
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
        <h3 className="text-base font-semibold text-fg">Subtasks</h3>
        <div className="flex items-center gap-2">
          <span className="num text-xs text-fg-muted" data-task-tree-count>
            {optimisticCompleted}/{total} complete
          </span>
          {canAdd && !adding && (
            <Button type="button" size="sm" variant="secondary" leadingIcon={<Plus />} onClick={() => setAdding(true)} data-task-tree-add>
              Add subtask
            </Button>
          )}
        </div>
      </div>
      {directChildren.map((child) => (
        <TaskTreeNode
          key={child.id}
          task={child}
          depth={0}
          onToggle={toggleComplete}
          buildTree={buildTree}
          toggling={toggling}
          canEdit={canEdit}
          // A subtask at level `depth + 1` may hold children while that stays within the limit.
          canAddUnder={(level) => canAdd && depth + level + 1 < SUBTASK_MAX_DEPTH}
          onChanged={refresh}
        />
      ))}
      {directChildren.length === 0 && !adding && (
        <p className="px-4 py-6 text-sm text-center text-fg-muted">
          No subtasks yet{canAdd ? ' — break the work into steps with Add subtask.' : ''}
        </p>
      )}
      {adding && (
        <div className="px-3 py-3 sm:px-4">
          <SubtaskForm
            parentTaskId={task.id}
            defaultPriority={task.priority ?? null}
            onSaved={async (_sub, { closed }) => { if (closed) setAdding(false); await refresh() }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}
      {error && <div className="px-4 pb-3"><InlineNotice tone="danger" onDismiss={() => setError(null)}>{error}</InlineNotice></div>}
    </Card>
  )
}
