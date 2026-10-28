'use client'

import { useState } from 'react'
import { setSubtaskCompleted } from '@/app/actions/tasks'
import { useRouter } from 'next/navigation'
import { TaskTreeNode } from './task-tree-node'

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

interface TaskTreeProps {
  task: Task & { tenant_id?: string }
  subtasks: Task[]
  totalCount: number
  completedCount: number
}

export function TaskTree({ task, subtasks: initialSubtasks, totalCount, completedCount }: TaskTreeProps) {
  const router = useRouter()
  const [toggling, setToggling] = useState<string | null>(null)
  const [localOverrides, setLocalOverrides] = useState<Record<string, string>>({})

  // Apply optimistic overrides for instant UI feedback
  const subtasks = initialSubtasks.map(s =>
    localOverrides[s.id] ? { ...s, status: localOverrides[s.id] } : s
  )

  function buildTree(parentId: string): Task[] {
    return subtasks
      .filter((s) => s.parent_task_id === parentId)
      .sort((a, b) => a.sequence - b.sequence)
  }

  async function toggleComplete(taskId: string, currentStatus: string) {
    if (toggling) return
    const newStatus = currentStatus === 'completed' ? 'todo' : 'completed'

    // Optimistic: update UI immediately
    setToggling(taskId)
    setLocalOverrides(prev => ({ ...prev, [taskId]: newStatus }))

    // Updates the subtask and logs the change on this task's timeline.
    const result = await setSubtaskCompleted(taskId, newStatus === 'completed', task.id)

    if (!result.ok) {
      setLocalOverrides(prev => { const next = { ...prev }; delete next[taskId]; return next })
      setToggling(null)
      return
    }

    setToggling(null)
    // Refresh the server component to get updated counts
    router.refresh()
  }

  const optimisticCompleted = subtasks.filter(s => s.status === 'completed').length

  const directChildren = buildTree(task.id)

  return (
    <div className="border rounded-xl overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--theme-surface-border)' }}>
        <h3 className="font-semibold text-sm">Task tree</h3>
        <span className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
          {optimisticCompleted}/{totalCount} complete
        </span>
      </div>
      {directChildren.map((child) => (
        <TaskTreeNode
          key={child.id}
          task={child}
          allSubtasks={subtasks}
          depth={0}
          onToggle={toggleComplete}
          buildTree={buildTree}
          toggling={toggling}
        />
      ))}
      {directChildren.length === 0 && (
        <p className="px-4 py-6 text-sm text-center" style={{ color: 'var(--theme-muted-text)' }}>
          No subtasks yet.
        </p>
      )}
    </div>
  )
}
