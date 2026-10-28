'use client'

import { useEffect, useMemo, useState } from 'react'
import { serverRead } from '@/lib/server-read'
import type { ActionResult } from '@/lib/action-result'
import { setEffortEstimate, setEstimatedCompletion as setEstimatedCompletionAction, setRemainingEffort } from '@/app/actions/task-effort'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Clock, Timer, CalendarClock, RotateCcw, Save } from 'lucide-react'
import { formatRelativeDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DateTimePicker } from '@/components/ui/date-time-picker'

interface EffortBoxProps {
  task: {
    id: string
    tenant_id: string
    metadata?: Record<string, any> | null
    estimated_completion?: string | null
    estimated_effort_assigner: number | null
    estimated_effort_assignee: number | null
    actual_effort: number | null
    assigner_id?: string | null
    assignee_id?: string | null
    assignment_mode?: string | null
  }
}

function EffortColumn({ label, value, editable, onSave, className, helper }: {
  label: string
  value: number | null
  editable?: boolean
  onSave?: (minutes: number) => void
  className?: string
  helper?: string
}) {
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState(value != null ? String(value) : '')

  useEffect(() => {
    setInputVal(value != null ? String(value) : '')
  }, [value])

  function commit() {
    setEditing(false)
    if (!onSave) return
    if (!inputVal.trim()) {
      onSave(0)
      return
    }
    onSave(Math.max(0, parseInt(inputVal, 10) || 0))
  }

  const displayHours = value != null ? (value / 60).toFixed(1) : '—'

  return (
    <div className="text-center">
      <p className="text-[10px] mb-1" style={{ color: 'var(--theme-muted-text)' }}>{label}</p>
      {editable && editing ? (
        <input
          type="number"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          autoFocus
          className="w-16 text-center text-lg font-semibold border rounded px-1 py-0.5"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
        />
      ) : (
        <p
          className={`text-lg font-semibold ${className ?? ''} ${editable ? 'cursor-pointer hover:opacity-70' : ''}`}
          style={!className ? { color: 'var(--theme-card-text)' } : undefined}
          onClick={() => editable && setEditing(true)}
        >
          {displayHours}h
        </p>
      )}
      {helper && (
        <p className="mt-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          {helper}
        </p>
      )}
    </div>
  )
}

export function EffortBox({ task }: EffortBoxProps) {
  const [assigneeEstimate, setAssigneeEstimate] = useState(task.estimated_effort_assignee)
  const [assignerEstimate, setAssignerEstimate] = useState(task.estimated_effort_assigner)
  const [remainingOverride, setRemainingOverride] = useState<number | null>(() => {
    const remaining = (task.metadata as Record<string, any> | null)?.remaining_effort_minutes
    return typeof remaining === 'number' ? remaining : null
  })
  const [estimatedCompletion, setEstimatedCompletion] = useState(task.estimated_completion ?? '')
  const [showLog, setShowLog] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [savingState, setSavingState] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    setAssigneeEstimate(task.estimated_effort_assignee)
    setAssignerEstimate(task.estimated_effort_assigner)
    setEstimatedCompletion(task.estimated_completion ?? '')
    const remaining = (task.metadata as Record<string, any> | null)?.remaining_effort_minutes
    setRemainingOverride(typeof remaining === 'number' ? remaining : null)
  }, [task.estimated_completion, task.estimated_effort_assignee, task.estimated_effort_assigner, task.metadata])

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

  const { data: effortEntries } = useQuery({
    queryKey: ['effort-entries', task.id],
    queryFn: async () => (await serverRead('tasks.effortEntries', { taskId: task.id })).data ?? [],
    staleTime: 60000,
  })

  const isAssigner = currentUserId != null && task.assigner_id === currentUserId
  const isAssignee = currentUserId != null && task.assignee_id === currentUserId
  const canEditAssignerEstimate = isAssigner || (!task.assigner_id && isAssignee)
  const canEditExecutionPlan = isAssignee || task.assignment_mode === 'collaborative' || isAssigner

  async function refreshTask() {
    await queryClient.invalidateQueries({ queryKey: ['task-detail', task.id] })
    await queryClient.invalidateQueries({ queryKey: ['task-tree', task.id] })
    await queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }

  // Each save writes the task and its activity-timeline event server-side
  // (lib/services/task-effort), then refreshes the task views.
  async function save(eventType: string, action: () => Promise<ActionResult<unknown>>) {
    setSavingState(eventType)
    setSaveError(null)
    const result = await action()
    if (!result.ok) setSaveError(result.error)
    await refreshTask()
    setSavingState(null)
    return result.ok
  }

  async function saveEstimate(kind: 'assigner' | 'assignee', minutes: number) {
    if (kind === 'assigner') setAssignerEstimate(minutes)
    else setAssigneeEstimate(minutes)
    const ok = await save('comment_added', () => setEffortEstimate(task.id, kind, minutes))
    // The assignee estimate is also kept as an effort record.
    if (ok && kind === 'assignee') queryClient.invalidateQueries({ queryKey: ['effort-entries', task.id] })
  }

  async function saveRemaining(minutes: number | null) {
    setRemainingOverride(minutes)
    await save('comment_added', () => setRemainingEffort(task.id, minutes))
  }

  async function saveEstimatedCompletion(value: string) {
    const isoValue = value ? new Date(value).toISOString() : null
    setEstimatedCompletion(isoValue ?? '')
    await save('comment_added', () => setEstimatedCompletionAction(task.id, isoValue))
  }

  const assigner = assignerEstimate ?? 0
  const assignee = assigneeEstimate ?? 0
  const actual = task.actual_effort ?? 0
  const bestEstimate = assignee || assigner
  const calculatedRemaining = Math.max(0, bestEstimate - actual)
  const remaining = remainingOverride ?? calculatedRemaining
  const pct = bestEstimate > 0 ? Math.min(100, Math.round((actual / bestEstimate) * 100)) : 0
  const etaInputValue = useMemo(() => {
    if (!estimatedCompletion) return ''
    const parsed = new Date(estimatedCompletion)
    if (Number.isNaN(parsed.getTime())) return ''
    const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000)
    return local.toISOString().slice(0, 16)
  }, [estimatedCompletion])

  return (
    <div className="rounded-xl mb-5" style={{ backgroundColor: 'var(--theme-surface)' }}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
        <EffortColumn
          label="Assigner est."
          value={assigner}
          editable={canEditAssignerEstimate}
          onSave={(minutes) => saveEstimate('assigner', minutes)}
          helper={canEditAssignerEstimate ? 'Click to edit' : undefined}
        />
        <EffortColumn
          label={isAssignee ? 'Your estimate' : 'Execution est.'}
          value={assignee}
          editable={canEditExecutionPlan}
          onSave={(minutes) => saveEstimate('assignee', minutes)}
          helper={canEditExecutionPlan ? 'Click to edit' : undefined}
        />
        <EffortColumn label="Actual" value={actual} className="text-[color:var(--theme-card-text)]" />
        <EffortColumn
          label="Remaining"
          value={remaining}
          editable={canEditExecutionPlan}
          onSave={(minutes) => saveRemaining(minutes)}
          className="text-amber-500"
          helper={remainingOverride != null ? 'Manual plan' : 'Calculated'}
        />
      </div>

      <div className="border-t px-4 py-3 space-y-3" style={{ borderColor: 'var(--theme-surface-border)' }}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl">
            <p className="text-xs font-semibold" style={{ color: 'var(--theme-card-text)' }}>
              Execution plan
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
              The assigner sets the expected size of the work, the assignee adjusts the working estimate, and remaining effort can be updated as the task evolves.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] max-md:w-full">
              <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>
                <CalendarClock size={11} />
                Estimated Completion
              </label>
              <DateTimePicker
                value={etaInputValue}
                onChange={setEstimatedCompletion}
                disabled={!canEditExecutionPlan}
                placeholder="Set ETA"
              />
            </div>
            {canEditExecutionPlan && (
              <Button size="sm" variant="outline" onClick={() => saveEstimatedCompletion(etaInputValue)} disabled={savingState !== null}>
                <Save size={12} className="mr-1" />
                Save ETA
              </Button>
            )}
          </div>
        </div>

        {saveError && (
          <p className="text-xs" style={{ color: 'var(--theme-danger)' }}>{saveError}</p>
        )}

        {canEditExecutionPlan && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => saveRemaining(calculatedRemaining)} disabled={savingState !== null}>
              Sync Remaining
            </Button>
            <Button size="sm" variant="outline" onClick={() => saveRemaining(null)} disabled={savingState !== null}>
              <RotateCcw size={12} className="mr-1" />
              Use Calculated Remaining
            </Button>
            <span className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
              Based on {((bestEstimate || 0) / 60).toFixed(1)}h planned and {(actual / 60).toFixed(1)}h logged.
            </span>
          </div>
        )}
      </div>

      {bestEstimate > 0 && (
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Effort progress</span>
            <span className="text-[10px] font-semibold" style={{ color: pct >= 100 ? '#EF4444' : 'var(--theme-primary-text)' }}>
              {pct}%
            </span>
          </div>
          <div className="h-1.5 rounded-full" style={{ backgroundColor: 'var(--theme-surface-border)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(pct, 100)}%`,
                backgroundColor: pct >= 100 ? '#EF4444' : pct >= 80 ? '#F59E0B' : 'var(--theme-primary)',
              }}
            />
          </div>
        </div>
      )}

      <button
        onClick={() => setShowLog(!showLog)}
        className="w-full flex items-center gap-1.5 px-4 py-2 text-[10px] font-medium border-t transition-colors hover:opacity-80"
        style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-primary-text)' }}
      >
        {showLog ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        Effort Log ({effortEntries?.length ?? 0} entries)
      </button>

      {showLog && (
        <div className="px-4 pb-3 space-y-1.5">
          {!effortEntries?.length ? (
            <p className="text-[10px] py-2" style={{ color: 'var(--theme-muted-text)' }}>No effort logged yet</p>
          ) : (
            effortEntries.map((e: any) => (
              <div key={e.id} className="flex items-center gap-2 text-xs py-1" style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
                {e.record_type === 'timer_entry' ? (
                  <Timer size={11} style={{ color: '#8B5CF6' }} />
                ) : (
                  <Clock size={11} style={{ color: 'var(--theme-primary-text)' }} />
                )}
                <span className="font-semibold" style={{ color: '#8B5CF6' }}>
                  {(e.minutes / 60).toFixed(1)}h
                </span>
                <span className="flex-1 truncate" style={{ color: 'var(--theme-muted-text)' }}>
                  {e.notes || (e.record_type === 'timer_entry' ? 'Timer' : 'Manual')}
                </span>
                <span className="text-[10px] shrink-0" style={{ color: 'var(--theme-muted-text)' }}>
                  {(e.user as any)?.display_name ?? ''}
                </span>
                <span className="text-[10px] shrink-0" style={{ color: 'var(--theme-muted-text)' }}>
                  {formatRelativeDate(e.created_at)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
