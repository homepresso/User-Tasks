'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Loader2 } from 'lucide-react'
import { cn, formatRelativeDate } from '@/lib/utils'
import { PriorityBadge } from '@/components/ui/priority-badge'
import { setSubtaskCompleted } from '@/app/actions/tasks'
import { useSubtasks } from '@/hooks/use-subtasks'

interface SubtaskListProps {
  parentTaskId: string
  tenantId?: string
}

export function SubtaskList({ parentTaskId, tenantId }: SubtaskListProps) {
  const { data: subtasks, isLoading } = useSubtasks(parentTaskId)
  const [toggling, setToggling] = useState<string | null>(null)
  const [localOverrides, setLocalOverrides] = useState<Record<string, string>>({})
  const router = useRouter()
  const queryClient = useQueryClient()

  async function toggleComplete(subtaskId: string, currentStatus: string) {
    if (toggling) return
    const newStatus = currentStatus === 'completed' ? 'todo' : 'completed'

    setToggling(subtaskId)
    setLocalOverrides(prev => ({ ...prev, [subtaskId]: newStatus }))

    const result = await setSubtaskCompleted(subtaskId, newStatus === 'completed')

    if (!result.ok) {
      setLocalOverrides(prev => { const next = { ...prev }; delete next[subtaskId]; return next })
    } else {
      queryClient.invalidateQueries({ queryKey: ['subtasks', parentTaskId] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      router.refresh()
    }

    setToggling(null)
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Loader2 size={12} className="animate-spin text-fg-muted" />
        <span className="text-2xs text-fg-muted">Loading subtasks...</span>
      </div>
    )
  }

  if (!subtasks || subtasks.length === 0) return null

  const displaySubtasks = subtasks.slice(0, 50)
  const hasMore = subtasks.length > 50

  return (
    <div className="space-y-0.5">
      <p className="text-2xs font-medium mb-1 text-fg-muted">Subtasks</p>
      {displaySubtasks.map(sub => {
        const status = localOverrides[sub.id] ?? sub.status
        const isDone = status === 'completed'
        const isToggling = toggling === sub.id
        const isOverdue = sub.due_date && new Date(sub.due_date) < new Date() && !isDone

        return (
          <div key={sub.id} className="flex items-center gap-2 py-1 rounded-md px-1 -mx-1 hover:bg-subtle transition-colors">
            {/* Checkbox */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                if (!isToggling) toggleComplete(sub.id, status)
              }}
              disabled={isToggling}
              className={cn(
                'w-4 h-4 rounded-full border-[1.5px] shrink-0',
                'flex items-center justify-center transition-all',
                'hover:scale-110 active:scale-95',
                isDone && 'border-primary bg-primary',
                !isDone && 'border-border hover:border-border-strong',
                isToggling && 'opacity-50',
              )}
            >
              {isToggling ? (
                <Loader2 size={8} className="animate-spin text-fg" />
              ) : isDone ? (
                <Check size={8} className="text-primary-fg" />
              ) : null}
            </button>

            {/* Title */}
            <span className={cn(
              'min-w-0 flex-1 truncate text-xs',
              isDone ? 'text-fg-muted line-through' : 'text-fg',
            )}>
              {sub.title}
            </span>

            <PriorityBadge priority={sub.priority} />

            {sub.due_date && (
              <span className={cn('num shrink-0 whitespace-nowrap text-xs', isOverdue ? 'text-danger' : 'text-fg-muted')}>
                {formatRelativeDate(sub.due_date)}
              </span>
            )}
          </div>
        )
      })}
      {hasMore && (
        <Link href={`/tasks/${parentTaskId}`} className="text-2xs font-medium block mt-1 text-primary-text"
          onClick={e => e.stopPropagation()}>
          View all subtasks
        </Link>
      )}
    </div>
  )
}
