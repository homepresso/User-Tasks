'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { ProgressBar } from '@/components/ui/progress-bar'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Check, X, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
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
    } catch (err) {
}
  }

  return (
    <div className="mt-5 mb-2">
      <div className="flex flex-wrap items-center justify-between gap-y-1 mb-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium" style={{ color: 'var(--theme-muted-text)' }}>
            Progress
          </p>
          {saving && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
              Saving...
            </span>
          )}
          {!saving && isOverridden && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
              Manual override
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {totalSubtasks > 0 && (
            <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
              {completedSubtasks} of {totalSubtasks} subtasks
            </p>
          )}

          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={value || 0}
                onChange={(e) => handleSliderChange(e.target.value)}
                className="w-28 h-1.5 accent-[color:var(--theme-primary)] cursor-pointer"
              />
              <span className="text-xs font-semibold w-8 text-right" style={{ color: 'var(--theme-card-text)' }}>
                {value || 0}%
              </span>
              <button onClick={saveOverride}
                className="p-0.5 text-[color:var(--theme-card-text)] hover:text-[color:var(--theme-card-text)]">
                <Check size={14} />
              </button>
              <button onClick={() => setEditing(false)}
                className="p-0.5 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
              {isOverridden && (
                <button onClick={clearOverride}
                  className="p-0.5 text-amber-500 hover:text-amber-600"
                  title="Reset to subtask progress">
                  <RotateCcw size={14} />
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => {
                setValue(String(displayProgress))
                setEditing(true)
              }}
              className="flex items-center gap-1 text-xs font-medium rounded px-1.5 py-0.5
                hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              style={{ color: 'var(--theme-primary-text)' }}
            >
              <span className={cn(
                "text-sm font-semibold",
                displayProgress === 100 ? "text-[color:var(--theme-card-text)]" : ""
              )}
                style={displayProgress < 100 ? { color: 'var(--theme-card-text)' } : undefined}
              >
                {displayProgress}%
              </span>
              <Pencil size={10} />
            </button>
          )}
        </div>
      </div>

      <ProgressBar value={displayProgress} />
    </div>
  )
}
