'use client'

import { FormRenderer } from '@/components/forms/form-renderer'
import { FormThemeScope } from '@/components/forms/form-theme-scope'
import { FormLookupProvider } from '@/components/forms/lookup-field'
import { FormButtonBar, FormHeaderBlock, FormMessages, FormSuccessScreen } from '@/components/forms/form-shell'
import type { ButtonEffects, FormButton } from '@/lib/forms/buttons'
import type { WorkflowStartForm } from '@/lib/forms/workflow-start-form'

/**
 * The form a workflow starts from, drawn as its users see it: a linked
 * reusable form exactly as its page (/f/<id>) shows it — header, grid, mini
 * theme with the page background, lookups with real suggestions, the
 * button bar — or the designed start form (grid + theme) with one start
 * button. Stateless: the Test runner (test submission) and the Run dialog
 * (real submission / manual run) own the values and what a button does.
 */
export function WorkflowStartFormView({
  spec, values, errors, onChange, onPress, busy = null, disabled, failure, messages, successScreen, onSubmitAnother, note, idPrefix = 'start-form-', startLabel = 'Start', hideButtons = false,
}: {
  spec: Exclude<WorkflowStartForm, { kind: 'none' }>
  /** Keyed by field key. */
  values: Record<string, unknown>
  errors: Record<string, string>
  onChange: (key: string, value: unknown) => void
  onPress: (button: FormButton) => void
  busy?: string | null
  disabled?: boolean
  failure?: string | null
  messages?: ButtonEffects['messages']
  successScreen?: ButtonEffects['success_screen'] | null
  onSubmitAnother?: () => void
  /** Shown above the buttons (e.g. "Test submission — nothing is stored"). */
  note?: React.ReactNode
  idPrefix?: string
  /** The start form's button. */
  startLabel?: string
  /** The start form's button bar is the caller's (the Run dialog's footer). */
  hideButtons?: boolean
}) {
  if (spec.kind === 'form') {
    const form = spec.form
    // As on /f/<id>: the form's own header replaces the theme's.
    const overrides = form.header?.enabled && form.theme_overrides?.header ? { ...form.theme_overrides, header: undefined } : form.theme_overrides
    return (
      <div data-start-form="form" data-form-id={form.id}>
        <FormThemeScope overrides={overrides} page>
          <FormHeaderBlock header={form.header ?? (form.theme_overrides?.header?.enabled ? null : { enabled: true, image: 'none', title: form.name, align: 'left' })} values={values} overrides={form.theme_overrides} />
          {successScreen ? (
            <FormSuccessScreen screen={successScreen} onSubmitAnother={onSubmitAnother} />
          ) : (
            <FormLookupProvider source={{ kind: 'form', formId: form.id }}>
              <FormRenderer
                idPrefix={idPrefix}
                fields={form.fields}
                layout={form.layout}
                values={values}
                errors={errors}
                readOnly={disabled}
                labelPosition={form.theme_overrides?.label_position}
                density={form.theme_overrides?.density}
                onChange={onChange}
              />
              {failure && <p className="mt-3 text-sm" role="alert" style={{ color: 'var(--status-blocked)' }}>{failure}</p>}
              {messages && messages.length > 0 && <FormMessages messages={messages} />}
              {note}
              <FormButtonBar buttons={form.buttons.filter((b) => b.kind !== 'draft')} placement={form.theme_overrides?.button_placement} busy={busy} disabled={disabled} onClick={onPress} />
            </FormLookupProvider>
          )}
        </FormThemeScope>
      </div>
    )
  }
  const start: FormButton = { id: 'start', label: startLabel, kind: 'submit', style: 'primary' }
  return (
    <div data-start-form="start_form">
      <FormThemeScope overrides={spec.theme_overrides} page>
        <FormRenderer
          idPrefix={idPrefix}
          fields={spec.fields}
          layout={spec.layout}
          values={values}
          errors={errors}
          readOnly={disabled}
          labelPosition={spec.theme_overrides?.label_position}
          density={spec.theme_overrides?.density}
          onChange={onChange}
        />
        {failure && <p className="mt-3 text-sm" role="alert" style={{ color: 'var(--status-blocked)' }}>{failure}</p>}
        {note}
        {!hideButtons && <FormButtonBar buttons={[start]} placement={spec.theme_overrides?.button_placement} busy={busy} disabled={disabled} onClick={onPress} />}
      </FormThemeScope>
    </div>
  )
}
