'use client'

import { useEffect, useMemo, useState } from 'react'
import { SettingsSaveBar } from './settings-section'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { VariableScopeProvider } from '@/components/automations/variable-scope'
import { TaskCompletedView } from '@/components/tasks/task-completed-screen'
import { TaskCompletionFields } from '@/components/tasks/task-completion-fields'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { serverRead } from '@/lib/server-read'
import { setTaskCompletionSettings } from '@/app/actions/workspace-settings'
import { formVariableScope } from '@/lib/forms/variable-catalog'
import {
  COMPLETION_PREVIEW_VALUES, COMPLETION_VARIABLES, completionScreenText, DEFAULT_TASK_COMPLETION, parseTaskCompletionSettings,
  type TaskCompletionSettings, type TaskNextStep,
} from '@/lib/tasks/completion-screen'

/**
 * Settings → Workspace → Task completion: the Task completed screen's
 * defaults for every task (task forms can override them in the designer),
 * with a live preview of a few cases.
 */

type PreviewCase = 'assigned' | 'reject' | 'complete' | 'waiting'

const CASES: Array<{ value: PreviewCase; text: string }> = [
  { value: 'assigned', text: 'Approved' },
  { value: 'reject', text: 'Rejected' },
  { value: 'complete', text: 'Last step' },
  { value: 'waiting', text: 'Waiting' },
]

export function previewValues(kind: PreviewCase) {
  const base = COMPLETION_PREVIEW_VALUES
  const next = base.next as TaskNextStep
  switch (kind) {
    case 'reject':
      return { ...base, outcome: 'Rejected', next: { ...next, steps: [{ name: 'Fix the invoice', assignees: ['Sam Lee'], team: null }] } }
    case 'complete':
      return { ...base, next: { ...next, state: 'complete' as const, steps: [] } }
    case 'waiting':
      return { ...base, next: { ...next, state: 'waiting' as const, steps: [{ name: 'Payment run (Friday)', assignees: [], team: null }] } }
    default:
      return base
  }
}

/** The Task completed screen with sample values, as it would look. */
export function TaskCompletionPreview({ settings, kind, outcome }: { settings: TaskCompletionSettings; kind: PreviewCase; outcome?: string }) {
  const values = outcome ? { ...previewValues(kind), outcome } : previewValues(kind)
  const text = completionScreenText(settings, values)
  return (
    <div inert className="select-none rounded-lg border border-dashed border-border bg-bg px-4" aria-label="Preview" role="group" data-task-completion-preview={kind}>
      <TaskCompletedView
        text={text}
        completedAt={new Date(2026, 10, 5, 14, 5)}
        autoFocus={false}
        escToBack={false}
        onNextTask={settings.show_next_task ? () => {} : null}
        onBack={settings.show_back ? () => {} : null}
        onViewFlow={settings.show_view_flow ? () => {} : null}
        className="py-6 sm:py-6"
      />
    </div>
  )
}

export function TaskCompletionCard({ readOnly }: { readOnly: boolean }) {
  const [settings, setSettings] = useState<TaskCompletionSettings | null>(null)
  const [draft, setDraft] = useState<TaskCompletionSettings>(DEFAULT_TASK_COMPLETION)
  const [preview, setPreview] = useState<PreviewCase>('assigned')
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const guard = useSubmitGuard()
  // The picker lists the screen's own placeholders (and flags anything else as not filled in).
  const scope = useMemo(() => formVariableScope({ fields: [], layout: null }, { kind: 'task_completed' }, COMPLETION_VARIABLES), [])

  useEffect(() => {
    let active = true
    serverRead('tasks.completionSettings').then(({ data }) => {
      if (!active) return
      const value = data ?? DEFAULT_TASK_COMPLETION
      setSettings(value)
      setDraft(value)
    })
    return () => { active = false }
  }, [])

  const dirty = settings !== null && JSON.stringify(draft) !== JSON.stringify(settings)
  const shown = parseTaskCompletionSettings(draft)

  function save(e: React.FormEvent) {
    e.preventDefault()
    void guard.run(async () => {
      setNotice(null)
      const result = await setTaskCompletionSettings(draft)
      if ('error' in result) { setNotice({ tone: 'error', message: result.error }); return }
      setSettings(result.settings)
      setDraft(result.settings)
      setNotice({ tone: 'success', message: 'Saved.' })
    })
  }

  if (!settings) return <p className="text-sm text-fg-muted">Loading…</p>

  return (
    <form onSubmit={save} className="space-y-6" aria-label="Task completed screen" data-testid="task-completion-settings">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-ui font-medium text-fg">Live preview</span>
          <SegmentedControl size="sm" aria-label="Preview case" value={preview} onValueChange={setPreview} options={CASES} />
        </div>
        {shown.enabled
          ? <TaskCompletionPreview settings={shown} kind={preview} />
          : <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-fg-muted">Off: completing a task keeps the person on the task page, which shows it completed.</p>}
      </div>
      <VariableScopeProvider value={scope}>
        <TaskCompletionFields value={draft} mode="workspace" disabled={readOnly} onChange={(next) => setDraft({ ...draft, ...next } as TaskCompletionSettings)} />
      </VariableScopeProvider>
      {notice?.tone === 'success' && <p role="status" className="text-xs text-success">{notice.message}</p>}
      {!readOnly && (
        <SettingsSaveBar
          dirty={dirty}
          saving={guard.pending}
          error={notice?.tone === 'error' ? notice.message : null}
          onDiscard={() => { setDraft(settings); setNotice(null) }}
          saveLabel="Save task completion"
          saveTestId="task-completion-save"
        />
      )}
    </form>
  )
}
