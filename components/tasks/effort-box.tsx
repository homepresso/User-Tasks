'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { serverRead } from '@/lib/server-read'
import type { ActionResult } from '@/lib/action-result'
import { setEffortEstimate, setEstimatedCompletion as setEstimatedCompletionAction, setRemainingEffort } from '@/app/actions/task-effort'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Clock, Info, Timer, RotateCcw, Save } from 'lucide-react'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Tooltip } from '@/components/ui/tooltip'
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
  /** Card header actions (the task timer). */
  actions?: ReactNode
  /** Under the effort log (manual effort entry). */
  footer?: ReactNode
}

/** One effort value: label, then hours in tabular figures; editable values edit inline (dotted underline on hover). */
function EffortColumn({ label, value, editable, onSave, helper }: {
  label: string
  value: number | null
  editable?: boolean
  onSave?: (minutes: number) => void
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
    <div className="min-w-0" data-effort-column={label}>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5">
        {editable && editing ? (
          <input
            type="number"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            autoFocus
            aria-label={`${label} (minutes)`}
            className="num h-7 w-20 rounded-md border border-input-border bg-input px-1.5 text-base font-semibold text-fg"
          />
        ) : editable ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${label.toLowerCase()}: ${displayHours} hours`}
            className="num cursor-text text-base font-semibold text-fg decoration-fg-subtle decoration-dotted underline-offset-4 hover:underline"
          >
            {displayHours}h
          </button>
        ) : (
          <span className="num text-base font-semibold text-fg">{displayHours}h</span>
        )}
        {helper && <span className="ml-1.5 text-xs text-fg-muted">{helper}</span>}
      </dd>
    </div>
  )
}

export function EffortBox({ task, actions, footer }: EffortBoxProps) {
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
    <Card padding="none" className="mb-5" data-effort-card>
      <CardHeader title="Effort" actions={actions} className="pb-3" />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 pb-4 md:grid-cols-4">
        <EffortColumn
          label="Assigner est."
          value={assigner}
          editable={canEditAssignerEstimate}
          onSave={(minutes) => saveEstimate('assigner', minutes)}
        />
        <EffortColumn
          label={isAssignee ? 'Your estimate' : 'Execution est.'}
          value={assignee}
          editable={canEditExecutionPlan}
          onSave={(minutes) => saveEstimate('assignee', minutes)}
        />
        <EffortColumn label="Actual" value={actual} />
        <EffortColumn
          label="Remaining"
          value={remaining}
          editable={canEditExecutionPlan}
          onSave={(minutes) => saveRemaining(minutes)}
          helper={remainingOverride != null ? 'Manual plan' : 'Calculated'}
        />
      </dl>

      {bestEstimate > 0 && (
        <div className="flex items-center gap-2 px-4 pb-4">
          <div
            role="progressbar"
            aria-label="Effort progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(pct, 100)}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn('h-full rounded-full transition-[width] duration-[var(--ds-dur-base)]', pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-primary')}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <span className={cn('num w-10 shrink-0 text-right text-xs font-medium', pct >= 100 ? 'text-danger' : 'text-fg-muted')}>{pct}%</span>
        </div>
      )}

      {/* Execution plan: ETA and the remaining-effort controls. */}
      <div className="space-y-3 border-t border-border-subtle px-4 py-3" data-execution-plan>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] max-md:w-full">
            <p className="mb-1 flex items-center gap-1 text-xs text-fg-muted">
              Estimated completion
              <Tooltip content="The assigner sets the expected size of the work, the assignee adjusts the working estimate, and remaining effort can be updated as the task evolves.">
                <button type="button" aria-label="About the execution plan" className="inline-flex text-fg-subtle hover:text-fg-muted"><Info className="size-3.5" /></button>
              </Tooltip>
            </p>
            <DateTimePicker
              value={etaInputValue}
              onChange={setEstimatedCompletion}
              disabled={!canEditExecutionPlan}
              placeholder="Set ETA"
            />
          </div>
          {canEditExecutionPlan && (
            <Button size="sm" variant="secondary" onClick={() => saveEstimatedCompletion(etaInputValue)} disabled={savingState !== null} leadingIcon={<Save />}>
              Save ETA
            </Button>
          )}
        </div>

        {saveError && <InlineNotice tone="danger">{saveError}</InlineNotice>}

        {canEditExecutionPlan && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => saveRemaining(calculatedRemaining)} disabled={savingState !== null}>
              Sync remaining
            </Button>
            <Button size="sm" variant="ghost" onClick={() => saveRemaining(null)} disabled={savingState !== null} leadingIcon={<RotateCcw />}>
              Use calculated remaining
            </Button>
            <span className="num text-xs text-fg-muted">
              Based on {((bestEstimate || 0) / 60).toFixed(1)}h planned and {(actual / 60).toFixed(1)}h logged.
            </span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowLog(!showLog)}
        aria-expanded={showLog}
        className="flex w-full items-center gap-1.5 border-t border-border-subtle px-4 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-subtle hover:text-fg"
        data-effort-log-toggle
      >
        {showLog ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
        Effort log <span className="num">({effortEntries?.length ?? 0})</span>
      </button>

      {showLog && (
        <ul className="px-4 pb-3">
          {!effortEntries?.length ? (
            <li className="py-2 text-xs text-fg-muted">No effort logged yet</li>
          ) : (
            effortEntries.map((e: any) => (
              <li key={e.id} className="flex items-center gap-2 border-b border-border-subtle py-1.5 text-ui last:border-b-0">
                {e.record_type === 'timer_entry'
                  ? <Timer className="size-3.5 shrink-0 text-fg-muted" aria-label="Timer" />
                  : <Clock className="size-3.5 shrink-0 text-fg-muted" aria-label="Manual" />}
                <span className="num font-medium text-fg">{(e.minutes / 60).toFixed(1)}h</span>
                <span className="flex-1 truncate text-fg-muted">
                  {e.notes || (e.record_type === 'timer_entry' ? 'Timer' : 'Manual')}
                </span>
                <span className="shrink-0 text-xs text-fg-muted">{(e.user as any)?.display_name ?? ''}</span>
                <Tooltip content={formatAbsolute(e.created_at)}>
                  <time dateTime={e.created_at} className="shrink-0 text-xs text-fg-muted">{formatRelative(e.created_at)}</time>
                </Tooltip>
              </li>
            ))
          )}
        </ul>
      )}

      {footer != null && <div className="border-t border-border-subtle px-4 py-3">{footer}</div>}
    </Card>
  )
}
