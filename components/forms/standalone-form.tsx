'use client'

import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormRenderer } from '@/components/forms/form-renderer'
import { FormThemeScope } from '@/components/forms/form-theme-scope'
import { FormLookupProvider } from '@/components/forms/lookup-field'
import { FormButtonBar, FormHeaderBlock, FormMessages, FormSuccessScreen } from '@/components/forms/form-shell'
import { serverRead } from '@/lib/server-read'
import { submitStandaloneForm } from '@/app/actions/forms'
import { planButtonEffects, type ButtonEffects, type FormButton } from '@/lib/forms/buttons'
import { defaultTaskFieldValues, validateTaskFieldValues } from '@/lib/task-field-schema'

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`
}

/**
 * A reusable form on its own page (/f/<id>): header, fields (lookups
 * included), the button bar and what the button does (message, success
 * screen, redirect, close). Submitting goes to the server (validation,
 * workflows, the "Form submitted" trigger); one idempotency key per filled
 * form makes a double-click one submission. Cancel discards the values
 * (asking first when something was typed).
 */
export function StandaloneForm({ formId }: { formId: string }) {
  const router = useRouter()
  const { data: form, error, isLoading } = useQuery({
    queryKey: ['form-submittable', formId],
    queryFn: async () => {
      const { data, error: readError } = await serverRead('forms.submittable', { id: formId })
      if (readError) throw new Error(readError.message)
      return data
    },
  })
  const defaults = useMemo(() => (form ? defaultTaskFieldValues(form.fields, (v) => (/\{\{/.test(v) ? '' : v)) : {}), [form])
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [effects, setEffects] = useState<ButtonEffects | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [closed, setClosed] = useState(false)
  const keyRef = useRef(newKey())
  const shown = { ...defaults, ...values }
  const dirty = Object.keys(values).length > 0

  if (isLoading) return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Loading the form…</p>
  if (error || !form) {
    return (
      <div className="flex items-start gap-2 rounded-lg border p-4 text-sm" role="alert" style={{ borderColor: 'var(--theme-surface-border)' }}>
        <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden style={{ color: 'var(--status-blocked)' }} />
        <span>{error instanceof Error ? error.message : 'This form is not available.'}</span>
      </div>
    )
  }

  function reset() {
    setValues({}); setErrors({}); setEffects(null); setFailure(null); setConfirmCancel(false); setClosed(false)
    keyRef.current = newKey()
  }

  function finish(next: ButtonEffects) {
    if (next.redirect) { router.push(next.redirect); return }
    if (next.close && !next.success_screen) { setClosed(true) }
    setEffects(next)
  }

  async function press(button: FormButton) {
    setFailure(null)
    if (button.kind === 'cancel') {
      if (dirty && !confirmCancel) { setConfirmCancel(true); return }
      const planned = planButtonEffects(button, { values: shown })
      setValues({}); setErrors({}); setConfirmCancel(false)
      finish(planned)
      return
    }
    const clientErrors = validateTaskFieldValues(form!.fields, shown)
    if (Object.keys(clientErrors).length) { setErrors(clientErrors); return }
    setBusy(button.id)
    try {
      const result = await submitStandaloneForm(formId, { values: shown, button_id: button.id, idempotency_key: keyRef.current })
      if (!result.ok) {
        if (result.fields) setErrors(result.fields)
        setFailure(result.error)
        return
      }
      setErrors({})
      if (!result.data.effects.success_screen && !result.data.effects.redirect && !result.data.effects.close) {
        // Stay on the form, cleared for the next submission, with the message(s).
        setValues({})
        keyRef.current = newKey()
        setEffects({ ...result.data.effects, messages: result.data.effects.messages.length ? result.data.effects.messages : [{ text: 'Submitted.', tone: 'success' }] })
        return
      }
      finish(result.data.effects)
    } finally {
      setBusy(null)
    }
  }

  const overrides = form.header?.enabled && form.theme_overrides?.header ? { ...form.theme_overrides, header: undefined } : form.theme_overrides
  return (
    <div className="mx-auto max-w-3xl" data-standalone-form={form.id}>
      <FormThemeScope overrides={overrides} page>
        <div>
          <FormHeaderBlock header={form.header ?? (form.theme_overrides?.header?.enabled ? null : { enabled: true, image: 'none', title: form.name, align: 'left' })} values={shown} overrides={form.theme_overrides} />
          {closed ? (
            <div className="py-10 text-center text-sm" style={{ color: 'var(--theme-muted-text)' }} role="status">
              This form is closed. <button type="button" className="underline" onClick={reset}>Open it again</button>
            </div>
          ) : effects?.success_screen ? (
            <FormSuccessScreen screen={effects.success_screen} onSubmitAnother={reset} onClose={() => { setEffects(null); setClosed(true) }} />
          ) : (
            <FormLookupProvider source={{ kind: 'form', formId: form.id }}>
              <FormRenderer
                idPrefix="form-field-"
                fields={form.fields}
                layout={form.layout}
                values={shown}
                errors={errors}
                labelPosition={form.theme_overrides?.label_position}
                density={form.theme_overrides?.density}
                onChange={(key, value) => {
                  setValues((prev) => ({ ...prev, [key]: value }))
                  setErrors((prev) => { if (!prev[key]) return prev; const next = { ...prev }; delete next[key]; return next })
                  setConfirmCancel(false)
                }}
              />
              {failure && <p className="mt-3 text-sm" role="alert" style={{ color: 'var(--status-blocked)' }}>{failure}</p>}
              {effects && <FormMessages messages={effects.messages} onDismiss={(i) => setEffects({ ...effects, messages: effects.messages.filter((_, j) => j !== i) })} />}
              {confirmCancel && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm" role="alertdialog" aria-label="Discard your answers?" style={{ borderColor: 'var(--theme-surface-border)' }}>
                  <span className="flex-1">Discard what you&apos;ve entered?</span>
                  <Button size="sm" variant="outline" onClick={() => setConfirmCancel(false)}>Keep editing</Button>
                  <Button size="sm" variant="destructive" onClick={() => void press(form.buttons.find((b) => b.kind === 'cancel')!)} data-confirm-cancel>Discard</Button>
                </div>
              )}
              <FormButtonBar buttons={form.buttons.filter((b) => b.kind !== 'draft')} placement={form.theme_overrides?.button_placement} busy={busy} onClick={(b) => void press(b)} />
            </FormLookupProvider>
          )}
        </div>
      </FormThemeScope>
    </div>
  )
}
