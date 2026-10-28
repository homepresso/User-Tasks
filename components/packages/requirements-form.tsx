'use client'

/**
 * Requirement values for a package install / complete setup: one card per
 * requirement (connector credentials, integration auth, secrets, environment
 * URLs, assignees), secrets as password inputs. Values are kept as
 * { <requirement id>: { <field key>: value } } and never stored in the
 * browser beyond this form.
 */

import * as Dialog from '@radix-ui/react-dialog'
import { CheckCircle2, CircleAlert, KeyRound, X } from 'lucide-react'
import { Input } from '@/components/ui/input'

export type RequirementValues = Record<string, Record<string, string>>

export interface RequirementView {
  id: string
  kind: string
  label: string
  description: string
  required: boolean
  status?: 'met' | 'missing'
  fields: Array<{ key: string; label: string; type: string; secret: boolean; default?: unknown; description?: string }>
  field_states?: Array<{ key: string; state: 'provided' | 'stored' | 'default' | 'missing' | 'optional' }>
}

export function Modal({ open, onOpenChange, title, children, width = 'w-[min(46rem,94vw)]', onEscapeKeyDown }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: React.ReactNode; width?: string; onEscapeKeyDown?: (event: KeyboardEvent) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
        <Dialog.Content
          onEscapeKeyDown={onEscapeKeyDown}
          className={`fixed left-1/2 top-1/2 z-50 ${width} max-h-[90vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-xl p-6 shadow-xl dialog-content`}
          style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
        >
          <div className="flex items-start justify-between gap-3 mb-4">
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close aria-label="Close" className="opacity-60 hover:opacity-100"><X size={16} /></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const KIND_LABEL: Record<string, string> = {
  connector: 'Connection', integration_auth: 'Integration', secret: 'Secret', env: 'Environment', user: 'Assignees', role: 'Roles', email_template: 'Email template',
}

export function missingCount(requirements: RequirementView[], values: RequirementValues): number {
  let count = 0
  for (const requirement of requirements) {
    for (const state of requirement.field_states ?? []) {
      if (state.state === 'missing' && !String(values[requirement.id]?.[state.key] ?? '').trim()) count++
    }
  }
  return count
}

export function RequirementsForm({
  requirements,
  values,
  onChange,
  showMet = true,
}: {
  requirements: RequirementView[]
  values: RequirementValues
  onChange: (values: RequirementValues) => void
  showMet?: boolean
}) {
  const set = (id: string, key: string, value: string) => onChange({ ...values, [id]: { ...(values[id] ?? {}), [key]: value } })
  const visible = requirements.filter((r) => showMet || r.status !== 'met')
  if (!visible.length) return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Nothing to configure.</p>
  return (
    <div className="space-y-3" data-testid="requirements-form">
      {visible.map((requirement) => {
        const states = new Map((requirement.field_states ?? []).map((s) => [s.key, s.state]))
        const filled = requirement.fields.every((f) => states.get(f.key) !== 'missing' || String(values[requirement.id]?.[f.key] ?? '').trim())
        return (
          <div key={requirement.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <div className="flex items-start gap-2 mb-2">
              {filled ? <CheckCircle2 size={16} style={{ color: 'var(--theme-success)' }} className="mt-0.5 shrink-0" /> : <CircleAlert size={16} style={{ color: 'var(--theme-warning)' }} className="mt-0.5 shrink-0" />}
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {requirement.label}
                  <span className="ml-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>{KIND_LABEL[requirement.kind] ?? requirement.kind}</span>
                  {!requirement.required && <span className="ml-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>optional</span>}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>{requirement.description}</p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {requirement.fields.map((field) => {
                const state = states.get(field.key)
                const placeholder = state === 'stored' ? (field.secret ? '•••••• (kept — leave empty to keep)' : 'Already set — leave empty to keep') : field.default !== undefined ? String(field.default) : field.secret ? 'Secret value' : ''
                return (
                  <label key={field.key} className="text-xs space-y-1 block">
                    <span className="flex items-center gap-1 font-medium">
                      {field.secret && <KeyRound size={11} />}
                      {field.label}
                      {state === 'missing' && <span style={{ color: 'var(--theme-danger)' }}>*</span>}
                      {state === 'stored' && <span style={{ color: 'var(--theme-success)' }}>set</span>}
                    </span>
                    <Input
                      type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'}
                      autoComplete={field.secret ? 'new-password' : 'off'}
                      className="h-8 text-xs"
                      placeholder={placeholder}
                      value={values[requirement.id]?.[field.key] ?? ''}
                      onChange={(event) => set(requirement.id, field.key, event.target.value)}
                      aria-label={`${requirement.label} ${field.label}`}
                      data-requirement={requirement.id}
                      data-field={field.key}
                    />
                    {field.description && field.description !== 'Optional' && <span className="block text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>{field.description}</span>}
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Drop empty values before sending. */
export function cleanValues(values: RequirementValues): RequirementValues {
  const out: RequirementValues = {}
  for (const [id, fields] of Object.entries(values)) {
    for (const [key, value] of Object.entries(fields)) if (String(value).trim()) (out[id] ??= {})[key] = String(value).trim()
  }
  return out
}
