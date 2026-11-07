'use client'

/**
 * Requirement values for a package install / complete setup: one block per
 * requirement (connector credentials, integration auth, secrets, environment
 * URLs, assignees), secrets as password inputs. Values are kept as
 * { <requirement id>: { <field key>: value } } and never stored in the
 * browser beyond this form.
 */

import type { ReactNode } from 'react'
import { CheckCircle2, CircleAlert, KeyRound } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Tag } from '@/components/ui/badge'
import { Dialog, DialogBody, DialogContent, DialogFooter, type DialogSize } from '@/components/ui/dialog'

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

/**
 * The packages dialogs: the Dialog primitive with a scrolling body and an
 * optional pinned footer (right-aligned actions: secondary, then primary).
 */
export function Modal({ open, onOpenChange, title, description, children, footer, size = 'lg', onEscapeKeyDown }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: DialogSize
  onEscapeKeyDown?: (event: KeyboardEvent) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={size} title={title} description={description} onEscapeKeyDown={onEscapeKeyDown}>
        <DialogBody>{children}</DialogBody>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
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
  if (!visible.length) return <p className="text-sm text-fg-muted">Nothing to configure.</p>
  return (
    <div className="space-y-3" data-testid="requirements-form">
      {visible.map((requirement) => {
        const states = new Map((requirement.field_states ?? []).map((s) => [s.key, s.state]))
        const filled = requirement.fields.every((f) => states.get(f.key) !== 'missing' || String(values[requirement.id]?.[f.key] ?? '').trim())
        return (
          <div key={requirement.id} className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-start gap-2">
              {filled
                ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-label="Complete" />
                : <CircleAlert size={16} className="mt-0.5 shrink-0 text-warning" aria-label="Needs values" />}
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                  {requirement.label}
                  <Tag>{KIND_LABEL[requirement.kind] ?? requirement.kind}</Tag>
                  {!requirement.required && <span className="text-xs font-normal text-fg-muted">Optional</span>}
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">{requirement.description}</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {requirement.fields.map((field) => {
                const state = states.get(field.key)
                const placeholder = state === 'stored' ? (field.secret ? '•••••• (kept — leave empty to keep)' : 'Already set — leave empty to keep') : field.default !== undefined ? String(field.default) : field.secret ? 'Secret value' : ''
                return (
                  <label key={field.key} className="block space-y-1.5">
                    <span className="flex items-center gap-1 text-ui font-medium text-fg">
                      {field.secret && <KeyRound size={14} className="text-fg-muted" aria-hidden />}
                      {field.label}
                      {state === 'missing' && <span className="text-danger" aria-hidden>*</span>}
                      {state === 'stored' && <span className="ml-1 text-xs font-normal text-success">Set</span>}
                    </span>
                    <Input
                      type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'}
                      autoComplete={field.secret ? 'new-password' : 'off'}
                      placeholder={placeholder}
                      value={values[requirement.id]?.[field.key] ?? ''}
                      onChange={(event) => set(requirement.id, field.key, event.target.value)}
                      aria-label={`${requirement.label} ${field.label}`}
                      data-requirement={requirement.id}
                      data-field={field.key}
                    />
                    {field.description && field.description !== 'Optional' && <span className="block text-xs text-fg-muted">{field.description}</span>}
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
