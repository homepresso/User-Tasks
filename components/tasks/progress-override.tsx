'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { ProgressBar } from '@/components/ui/progress-bar'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Check, X, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { plural } from '@/lib/format/plural'
import { updateTaskField } from '@/app/actions/tasks'

interface ProgressOverrideProps {
  taskId: string
  /** Progress computed from subtask completion */
  subtaskProgress: number
  /** Manual override from progress_pct column (null = use subtask progress) */
  overridePct: number | null
  totalSubtasks: number
  completedSubtasks: number
}

export function ProgressOverride({
  taskId,
  subtaskProgress,
  overridePct,
  totalSubtasks,
  completedSubtasks,
}: ProgressOverrideProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(overridePct ?? ''))
  const [localProgress, setLocalProgress] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const queryClient = useQueryClient()
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isOverridden = localProgress !== null ? true : overridePct !== null
  const displayProgress = localProgress ?? (overridePct !== null ? overridePct : subtaskProgress)

  useEffect(() => {
    if (editing) return
    setValue(String(overridePct ?? ''))
    setLocalProgress(null)
  }, [editing, overridePct])

  // Auto-save when slider value changes (debounced 500ms)
  const autoSave = useCallback((pct: number) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true)
      try {
        await updateTaskField(taskId, 'progress_pct', pct)
        queryClient.invalidateQueries({ queryKey: ['task-tree', taskId] })
      } catch {}
      setSaving(false)
    }, 500)
  }, [taskId, queryClient])

  function handleSliderChange(newValue: string) {
    setValue(newValue)
    setLocalProgress(parseInt(newValue))
    autoSave(parseInt(newValue))
  }

  async function saveOverride() {
    const pct = parseInt(value)
    if (isNaN(pct) || pct < 0 || pct > 100) return
    setEditing(false)
    setLocalProgress(pct)
    setSaving(true)

    try {
      await updateTaskField(taskId, 'progress_pct', pct)
      queryClient.invalidateQueries({ queryKey: ['task-tree', taskId] })
    } catch {}
    setSaving(false)
  }

  async function clearOverride() {
    setEditing(false)
    setValue('')
    setLocalProgress(null)

    try {
      await updateTaskField(taskId, 'progress_pct', null)
      queryClient.invalidateQueries({ queryKey: ['task-tree', taskId] })
    } catch {
      /* the next refresh shows the stored value */
    }
  }

  return (
    <div className="mb-2" data-task-progress>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-y-1">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-fg-muted">Progress</p>
          {saving && <Badge tone="brand">Saving…</Badge>}
          {!saving && isOverridden && <Badge tone="warning">Manual override</Badge>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {totalSubtasks > 0 && (
            <p className="num text-xs text-fg-muted">
              {completedSubtasks} of {plural(totalSubtasks, 'subtask')}
            </p>
          )}

          {editing ? (
            <div className="flex items-center gap-1">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={value || 0}
                onChange={(e) => handleSliderChange(e.target.value)}
                aria-label="Progress"
                className="h-1.5 w-28 cursor-pointer accent-[color:var(--theme-primary)]"
              />
              <span className="num w-9 text-right text-xs font-semibold text-fg">{value || 0}%</span>
              <IconButton size="sm" label="Save progress" icon={<Check />} onClick={saveOverride} />
              <IconButton size="sm" label="Cancel" icon={<X />} onClick={() => setEditing(false)} />
              {isOverridden && (
                <IconButton size="sm" label="Reset to subtask progress" icon={<RotateCcw />} onClick={clearOverride} />
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setValue(String(displayProgress))
                setEditing(true)
              }}
              aria-label={`Edit progress: ${displayProgress}%`}
              className="flex cursor-text items-center gap-1 rounded-md px-1.5 py-0.5 text-fg transition-colors hover:bg-subtle"
            >
              <span className="num text-sm font-semibold decoration-fg-subtle decoration-dotted underline-offset-4 hover:underline">{displayProgress}%</span>
              <Pencil className="size-3 text-fg-muted" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <ProgressBar value={displayProgress} label="Task progress" />
    </div>
  )
}
