'use client'

/**
 * Interactive building blocks for extension custom pages (re-exported by
 * `@user-tasks/extension-sdk/ui`): a button and a small form that run one
 * of the extension's UI actions on the server. Core components, so they
 * follow the workspace theme; extensions ship no client code or CSS.
 */

import { useState } from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { useExtensionAction } from './use-extension-action'

export function ExtensionActionButton({ extensionId, action, label, confirm, variant = 'secondary', values }: {
  extensionId: string
  action: string
  label: string
  confirm?: string
  variant?: ButtonProps['variant']
  values?: Record<string, unknown>
}) {
  const { run, busy, confirmDialog } = useExtensionAction()
  return (
    <>
      <Button variant={variant} loading={busy} onClick={() => run({ extensionId, action, label, confirm, values })}>{label}</Button>
      {confirmDialog}
    </>
  )
}

export interface ActionFormField {
  name: string
  label: string
  /**
   * text inputs; `select` (one of `options`); `checkboxes` (several of
   * `options`, sent as a string array); `checkbox` (sent as "true" / "");
   * `hidden` (sent as `defaultValue`, not shown).
   */
  type?: 'text' | 'textarea' | 'number' | 'email' | 'url' | 'password' | 'select' | 'checkboxes' | 'checkbox' | 'hidden'
  placeholder?: string
  required?: boolean
  help?: string
  options?: Array<{ value: string; label: string; description?: string }>
  /** Initial value (checkboxes: the values checked first). */
  defaultValue?: string | string[]
}

type FormValue = string | string[]

function initialValues(fields: ActionFormField[]): Record<string, FormValue> {
  const out: Record<string, FormValue> = {}
  for (const f of fields) {
    if (f.defaultValue === undefined) continue
    out[f.name] = f.type === 'checkboxes' ? (Array.isArray(f.defaultValue) ? f.defaultValue : [f.defaultValue]) : String(f.defaultValue)
  }
  return out
}

export function ExtensionActionForm({ extensionId, action, fields, submitLabel = 'Save', resetOnSuccess = true }: {
  extensionId: string
  action: string
  fields: ActionFormField[]
  submitLabel?: string
  /** Clear the form after a successful run (default true). */
  resetOnSuccess?: boolean
}) {
  const { execute, busy } = useExtensionAction()
  const [values, setValues] = useState<Record<string, FormValue>>(() => initialValues(fields))
  const set = (name: string, value: FormValue) => setValues((v) => ({ ...v, [name]: value }))
  return (
    <form
      className="max-w-[560px] space-y-4"
      onSubmit={async (event) => {
        event.preventDefault()
        const out = await execute({ extensionId, action, label: submitLabel, values })
        if (out && !out.redirect && resetOnSuccess) setValues(initialValues(fields))
      }}
    >
      {fields.map((field) => {
        const id = `ext-form-${field.name}`
        if (field.type === 'hidden') return null
        const value = values[field.name]
        const label = <label htmlFor={id} className="block text-ui font-medium text-fg">{field.label}{field.required && <span className="text-danger" aria-hidden> *</span>}</label>
        let control: React.ReactNode
        if (field.type === 'select') {
          control = <Select id={id} value={String(value ?? '')} required={field.required} placeholder={field.placeholder ?? 'Choose…'} options={field.options ?? []} onChange={(e) => set(field.name, e.target.value)} />
        } else if (field.type === 'checkboxes') {
          const checked = new Set(Array.isArray(value) ? value : [])
          return (
            <fieldset key={field.name} className="space-y-1.5">
              <legend className="block text-ui font-medium text-fg">{field.label}{field.required && <span className="text-danger" aria-hidden> *</span>}</legend>
              {(field.options ?? []).length === 0 && <p className="text-xs text-fg-muted">Nothing to choose from.</p>}
              <div className="space-y-1.5">
                {(field.options ?? []).map((o) => (
                  <Checkbox key={o.value} label={o.label} description={o.description} checked={checked.has(o.value)}
                    onChange={(e) => {
                      const next = new Set(checked)
                      if (e.target.checked) next.add(o.value)
                      else next.delete(o.value)
                      set(field.name, [...next])
                    }} />
                ))}
              </div>
              {field.help && <p className="text-xs text-fg-muted">{field.help}</p>}
            </fieldset>
          )
        } else if (field.type === 'checkbox') {
          return (
            <div key={field.name} className="space-y-1.5">
              <Checkbox id={id} label={field.label} description={field.help} checked={value === 'true'} onChange={(e) => set(field.name, e.target.checked ? 'true' : '')} />
            </div>
          )
        } else {
          const common = {
            id,
            value: String(value ?? ''),
            placeholder: field.placeholder,
            required: field.required,
            onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(field.name, e.target.value),
          }
          control = field.type === 'textarea' ? <Textarea {...common} rows={4} /> : <Input {...common} type={field.type ?? 'text'} autoComplete={field.type === 'password' ? 'new-password' : undefined} />
        }
        return (
          <div key={field.name} className="space-y-1.5">
            {label}
            {control}
            {field.help && <p className="text-xs text-fg-muted">{field.help}</p>}
          </div>
        )
      })}
      <Button type="submit" loading={busy}>{submitLabel}</Button>
    </form>
  )
}
