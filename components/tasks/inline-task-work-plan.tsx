'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { saveTaskWorkPlan } from '@/app/actions/task-effort'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { CalendarClock, RotateCcw, Save } from 'lucide-react'

interface InlineTaskWorkPlanProps {
  task: {
    id: string
    tenant_id?: string | null
    assignee_id?: string | null
    assigner_id?: string | null
    assignment_mode?: string | null
    estimated_effort_assigner?: number | null
    estimated_effort_assignee?: number | null
    actual_effort?: number | null
    estimated_completion?: string | null
    metadata?: Record<string, any> | null
  }
  density?: 'compact' | 'full'
}

function toLocalDateTime(value: string | null | undefined) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export function InlineTaskWorkPlan({ task, density = 'compact' }: InlineTaskWorkPlanProps) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [assignerEstimate, setAssignerEstimate] = useState(String(task.estimated_effort_assigner ?? ''))
  const [assigneeEstimate, setAssigneeEstimate] = useState(String(task.estimated_effort_assignee ?? ''))
  const [remaining, setRemaining] = useState(() => {
    const saved = (task.metadata as Record<string, any> | null)?.remaining_effort_minutes
    return typeof saved === 'number' ? String(saved) : ''
  })
  const [estimatedCompletion, setEstimatedCompletion] = useState(toLocalDateTime(task.estimated_completion))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const queryClient = useQueryClient()

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

  useEffect(() => {
    setAssignerEstimate(String(task.estimated_effort_assigner ?? ''))
    setAssigneeEstimate(String(task.estimated_effort_assignee ?? ''))
    const saved = (task.metadata as Record<string, any> | null)?.remaining_effort_minutes
    setRemaining(typeof saved === 'number' ? String(saved) : '')
    setEstimatedCompletion(toLocalDateTime(task.estimated_completion))
  }, [task.estimated_completion, task.estimated_effort_assigner, task.estimated_effort_assignee, task.metadata])

  const isAssigner = currentUserId != null && task.assigner_id === currentUserId
  const isAssignee = currentUserId != null && task.assignee_id === currentUserId
  const canEditAssignerEstimate = isAssigner || (!task.assigner_id && isAssignee)
  const canEditExecutionPlan = isAssignee || task.assignment_mode === 'collaborative' || isAssigner

  const actual = Number(task.actual_effort ?? 0)
  const calculatedRemaining = useMemo(() => {
    const bestEstimate = Number(assigneeEstimate || 0) || Number(assignerEstimate || 0)
    return Math.max(0, bestEstimate - actual)
  }, [actual, assigneeEstimate, assignerEstimate])

  async function persist(nextRemaining?: string) {
    setSaving(true)
    setSaveError(null)
    const remainingValue = nextRemaining !== undefined ? nextRemaining : remaining
    const minutesOrNull = (value: string) => value.trim() === '' ? null : Math.max(0, Math.round(Number(value) || 0))

    // Saves the estimates, remaining plan and ETA and logs the change on the
    // activity timeline (lib/services/task-effort).
    const result = await saveTaskWorkPlan(task.id, {
      estimatedEffortAssigner: minutesOrNull(assignerEstimate),
      estimatedEffortAssignee: minutesOrNull(assigneeEstimate),
      remainingEffortMinutes: minutesOrNull(remainingValue),
      estimatedCompletion: estimatedCompletion ? new Date(estimatedCompletion).toISOString() : null,
    })
    if (!result.ok) setSaveError(result.error)

    await queryClient.invalidateQueries({ queryKey: ['task-detail', task.id] })
    await queryClient.invalidateQueries({ queryKey: ['task-tree', task.id] })
    await queryClient.invalidateQueries({ queryKey: ['task-queue'] })
    await queryClient.invalidateQueries({ queryKey: ['assigned-tasks'] })
    await queryClient.invalidateQueries({ queryKey: ['tasks'] })
    setSaving(false)
  }

  function useCalculatedRemaining() {
    const next = String(calculatedRemaining)
    setRemaining(next)
    void persist(next)
  }

  const wrapperClass = density === 'compact'
    ? 'rounded-lg border px-3 py-3 space-y-3'
    : 'rounded-xl border px-4 py-4 space-y-4'

  return (
    <div className={wrapperClass} style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>
            Work Plan
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
            Update the estimate, remaining effort, and ETA without leaving this list.
          </p>
        </div>
        <div className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
          Actual {(actual / 60).toFixed(1)}h
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>Assigner (min)</label>
          <Input
            type="number"
            min="0"
            value={assignerEstimate}
            onChange={(e) => setAssignerEstimate(e.target.value)}
            disabled={!canEditAssignerEstimate}
            placeholder="e.g. 120"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>Execution (min)</label>
          <Input
            type="number"
            min="0"
            value={assigneeEstimate}
            onChange={(e) => setAssigneeEstimate(e.target.value)}
            disabled={!canEditExecutionPlan}
            placeholder="e.g. 90"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>Remaining (min)</label>
          <Input
            type="number"
            min="0"
            value={remaining}
            onChange={(e) => setRemaining(e.target.value)}
            disabled={!canEditExecutionPlan}
            placeholder={String(calculatedRemaining)}
          />
        </div>
        <div>
          <label className="mb-1 flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>
            <CalendarClock size={11} />
            ETA
          </label>
          <DateTimePicker
            value={estimatedCompletion}
            onChange={setEstimatedCompletion}
            disabled={!canEditExecutionPlan}
            placeholder="Set ETA"
          />
        </div>
      </div>

      {saveError && (
        <p className="text-xs" style={{ color: 'var(--theme-danger)' }}>{saveError}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
          Calculated remaining {(calculatedRemaining / 60).toFixed(1)}h
        </span>
        <div className="flex flex-wrap gap-2">
          {canEditExecutionPlan && (
            <Button size="sm" variant="outline" onClick={useCalculatedRemaining} disabled={saving}>
              <RotateCcw size={12} className="mr-1" />
              Use Calculated
            </Button>
          )}
          {(canEditAssignerEstimate || canEditExecutionPlan) && (
            <Button size="sm" onClick={() => persist()} disabled={saving}>
              <Save size={12} className="mr-1" />
              {saving ? 'Saving...' : 'Save Plan'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
