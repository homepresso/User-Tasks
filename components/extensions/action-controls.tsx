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
  type?: 'text' | 'textarea' | 'number' | 'email' | 'url'
  placeholder?: string
  required?: boolean
  help?: string
}

export function ExtensionActionForm({ extensionId, action, fields, submitLabel = 'Save' }: {
  extensionId: string
  action: string
  fields: ActionFormField[]
  submitLabel?: string
}) {
  const { execute, busy } = useExtensionAction()
  const [values, setValues] = useState<Record<string, string>>({})
  return (
    <form
      className="max-w-[560px] space-y-4"
      onSubmit={async (event) => {
        event.preventDefault()
        const out = await execute({ extensionId, action, label: submitLabel, values })
        if (out && !out.redirect) setValues({})
      }}
    >
      {fields.map((field) => {
        const id = `ext-form-${field.name}`
        const common = {
          id,
          value: values[field.name] ?? '',
          placeholder: field.placeholder,
          required: field.required,
          onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [field.name]: e.target.value })),
        }
        return (
          <div key={field.name} className="space-y-1.5">
            <label htmlFor={id} className="block text-ui font-medium text-fg">{field.label}{field.required && <span className="text-danger" aria-hidden> *</span>}</label>
            {field.type === 'textarea' ? <Textarea {...common} rows={4} /> : <Input {...common} type={field.type ?? 'text'} />}
            {field.help && <p className="text-xs text-fg-muted">{field.help}</p>}
          </div>
        )
      })}
      <Button type="submit" loading={busy}>{submitLabel}</Button>
    </form>
  )
}
