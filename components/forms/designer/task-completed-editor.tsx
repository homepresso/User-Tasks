'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TaskCompletionFields, TaskCompletionOutcomeFields } from '@/components/tasks/task-completion-fields'
import { TaskCompletionPreview } from '@/components/settings/task-completion-card'
import { serverRead } from '@/lib/server-read'
import type { DesignerState } from '@/lib/forms/designer-state'
import {
  COMPLETION_VARIABLES, DEFAULT_TASK_COMPLETION, resolveTaskCompletion, taskCompletedOverride, withTaskCompletedOverride,
  type TaskCompletedOverride,
} from '@/lib/tasks/completion-screen'
import { DesignerVariableScope } from './designer-variable-scope'

/**
 * Buttons & header → Task completed screen (task forms): this form's own
 * wording for the screen shown once the task is actioned, stored in the
 * layout (layout.task_completed) so it travels with versions, export,
 * packages and the API. Blank fields inherit Settings → Workspace → Task
 * completion; headings can differ per outcome.
 */
export function TaskCompletedEditor({ state, onChange, outcomes = [] }: {
  state: DesignerState
  onChange: (next: DesignerState, tag?: string) => void
  outcomes?: string[]
}) {
  const { data: workspace } = useQuery({
    queryKey: ['task-completion-settings', 'designer'],
    staleTime: 60_000,
    queryFn: async () => (await serverRead('tasks.completionSettings')).data ?? DEFAULT_TASK_COMPLETION,
  })
  const inherited = workspace ?? DEFAULT_TASK_COMPLETION
  const override = taskCompletedOverride(state.layout) ?? {}
  const [previewOutcome, setPreviewOutcome] = useState<string>(outcomes[0] ?? 'Approved')
  const write = (next: TaskCompletedOverride, tag?: string) => onChange({ ...state, layout: withTaskCompletedOverride(state.layout, next) }, tag)
  const resolved = resolveTaskCompletion(inherited, override, previewOutcome)
  const customised = Object.keys(override).length > 0

  return (
    <div className="space-y-3" data-testid="task-completed-editor">
      <p className="text-2xs text-fg-muted">
        Shown in place of the task once it is completed with an outcome. Blank fields use the workspace&apos;s wording (Settings → Task completion).
        {customised && (
          <> <button type="button" className="font-medium text-primary-text underline-offset-2 hover:underline" onClick={() => write({})} data-testid="task-completed-reset">Use the workspace default</button></>
        )}
      </p>
      <DesignerVariableScope state={state} context={{ kind: 'task_completed' }} extras={COMPLETION_VARIABLES}>
        <TaskCompletionFields dense mode="override" inherited={inherited} value={override} onChange={(next) => write({ ...next, ...(override.outcomes ? { outcomes: override.outcomes } : {}) }, 'task-completed')} />
        <div className="mt-3">
          <TaskCompletionOutcomeFields dense outcomes={outcomes} value={override.outcomes} onChange={(map) => write({ ...override, outcomes: map }, 'task-completed')} />
        </div>
      </DesignerVariableScope>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-2xs font-medium text-fg-muted">Preview</span>
          {outcomes.length > 1 && (
            <SegmentedControl size="sm" aria-label="Preview outcome" value={previewOutcome} onValueChange={setPreviewOutcome}
              options={outcomes.slice(0, 4).map((o) => ({ value: o, text: o }))} />
          )}
        </div>
        {resolved.enabled
          ? <PreviewFor outcome={previewOutcome} settings={resolved} />
          : <p className="rounded border border-dashed border-border px-2 py-3 text-center text-2xs text-fg-muted">Off for this form: completing the task keeps the task page.</p>}
      </div>
    </div>
  )
}

function PreviewFor({ outcome, settings }: { outcome: string; settings: ReturnType<typeof resolveTaskCompletion> }) {
  const reject = /reje|declin|deny|denied|refus|send back|sent back|return/i.test(outcome)
  // The workspace preview's cases, with this form's outcome.
  return (
    <div data-task-completed-preview-outcome={outcome}>
      <TaskCompletionPreview settings={settings} kind={reject ? 'reject' : 'assigned'} outcome={outcome} />
    </div>
  )
}
