'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { FormButtonBar, FormMessages, FormSuccessScreen } from '@/components/forms/form-shell'
import { normalizeFormButtons, planButtonEffects, type ButtonEffects, type ButtonPlacement, type FormButton } from '@/lib/forms/buttons'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { validateTaskFieldValues } from '@/lib/task-field-schema'
import { useOnBehalf } from './on-behalf'

/**
 * The button bar of a task form whose step configured one (task metadata
 * `form_buttons`): outcome / Submit buttons complete the task and run the
 * button's actions on the server, Save draft saves, Cancel discards the
 * unsaved values (asking first). The task's own header buttons stay as
 * they are.
 */
export function TaskFormButtons({ taskId, rawButtons, fields, values, savedValues, placement, onErrors, onReset, closed }: {
  taskId: string
  /** The task is completed / cancelled: only what the last click showed stays (success screen, messages). */
  closed?: boolean
  rawButtons: unknown
  fields: TaskFieldDef[]
  values: Record<string, unknown>
  savedValues: Record<string, unknown>
  placement?: ButtonPlacement
  onErrors: (errors: Record<string, string>) => void
  onReset: () => void
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const buttons = normalizeFormButtons(rawButtons)
  const [busy, setBusy] = useState<string | null>(null)
  const [effects, setEffects] = useState<ButtonEffects | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const onBehalf = useOnBehalf()
  const dirty = fields.some((f) => JSON.stringify(values[f.key] ?? null) !== JSON.stringify(savedValues[f.key] ?? null))

  async function press(button: FormButton) {
    setFailure(null)
    if (button.kind === 'cancel') {
      if (dirty && !confirmCancel) { setConfirmCancel(true); return }
      setConfirmCancel(false)
      onReset()
      const planned = planButtonEffects(button, { values: savedValues })
      if (planned.redirect) router.push(planned.redirect)
      else setEffects(planned)
      return
    }
    if (button.kind !== 'draft') {
      const errors = validateTaskFieldValues(fields, values)
      if (Object.keys(errors).length) { onErrors(errors); return }
      if (onBehalf.needsNote) { setFailure('Add a reason (above) before acting on their behalf'); return }
    }
    setBusy(button.id)
    try {
      const { completeTaskWithFormButton } = await import('@/app/actions/task-queue')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the action returns one of several result shapes
      const result = await completeTaskWithFormButton(taskId, button.id, values, undefined, onBehalf.options) as Record<string, any>
      if (!result.success) {
        if (result.errors) onErrors(result.errors)
        setFailure(result.error ?? (result.errors ? 'Some values need attention' : 'The form could not be submitted'))
        return
      }
      const next = (result.effects ?? { messages: [] }) as ButtonEffects
      if (result.status === 'saved' && !next.messages.length) next.messages.push({ text: 'Saved.', tone: 'success' })
      if (result.status === 'completed' && !next.messages.length && !next.success_screen) next.messages.push({ text: `Completed: ${result.outcome}`, tone: 'success' })
      if (result.status === 'waiting') next.messages.push({ text: `Response recorded (${result.responses} of ${result.needed}).`, tone: 'info' })
      await queryClient.invalidateQueries({ queryKey: ['task-detail', taskId] })
      if (next.redirect) { router.push(next.redirect); return }
      if (next.close) { router.push('/tasks'); return }
      setEffects(next)
    } finally {
      setBusy(null)
    }
  }

  if (closed && !effects) return null
  if (effects?.success_screen) {
    return <FormSuccessScreen screen={effects.success_screen} onClose={() => router.push('/tasks')} onSubmitAnother={() => router.push('/tasks')} />
  }
  return (
    <div data-task-form-buttons>
      {failure && <p className="mt-3 text-sm" role="alert" style={{ color: 'var(--status-blocked)' }}>{failure}</p>}
      {effects && <FormMessages messages={effects.messages} onDismiss={(i) => setEffects({ ...effects, messages: effects.messages.filter((_, j) => j !== i) })} />}
      {confirmCancel && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm" role="alertdialog" aria-label="Discard your changes?" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <span className="flex-1">Discard the changes you haven&apos;t saved?</span>
          <Button size="sm" variant="outline" onClick={() => setConfirmCancel(false)}>Keep editing</Button>
          <Button size="sm" variant="destructive" onClick={() => void press(buttons.find((b) => b.kind === 'cancel')!)}>Discard</Button>
        </div>
      )}
      {!closed && onBehalf.canAct && <FormButtonBar buttons={buttons} placement={placement} busy={busy} onClick={(b) => void press(b)} />}
    </div>
  )
}
