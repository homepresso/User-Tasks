'use client'

/**
 * Requirement values for a package install / complete setup: one block per
 * requirement (connector credentials, integration auth, secrets, environment
 * URLs, assignees), secrets as password inputs. Values are kept as
 * { <requirement id>: { <field key>: value } } and never stored in the
 * browser beyond this form.
 */

import { useState, type ReactNode } from 'react'
import { CheckCircle2, CircleAlert, KeyRound } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Tag } from '@/components/ui/badge'
import { Dialog, DialogBody, DialogContent, DialogFooter, type DialogSize } from '@/components/ui/dialog'
import { assigneeFields, fillEmptyAssignees, type AssigneeFieldInfo } from '@/lib/packages/assignees'
import { assigneeFieldLabel, AssigneePicker, useAssigneeMe, type AssigneeChoice, type AssigneeKind } from './assignee-requirement-field'

export type RequirementValues = Record<string, Record<string, string>>

export interface RequirementView {
  id: string
  kind: string
  label: string
  description: string
  required: boolean
  status?: 'met' | 'missing'
  /** `assignee` (user requirements, from a plan): what the step takes, who is chosen, what is wrong. */
  fields: Array<{ key: string; label: string; type: string; secret: boolean; default?: unknown; description?: string; assignee?: AssigneeFieldInfo | null }>
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

/** The assignee block's help, worded for what its steps take (the package's own text predates the picker). */
function assigneeDescription(requirement: RequirementView): string {
  const teams = requirement.fields.some((field) => acceptsOf(field).includes('team'))
  return `People and teams are not part of a package: pick who receives each step — a person${teams ? ' or a team' : ''} in this workspace (search by name, or paste an email). ${requirement.required ? 'The workflow stays inactive until they are set.' : 'Left empty, the step keeps an unknown assignee.'}`
}

function acceptsOf(field: RequirementView['fields'][number]): AssigneeKind[] {
  return field.assignee?.accepts?.length ? field.assignee.accepts : [field.type === 'user' ? 'user' : 'team']
}

/** "Assign all to…": one pick fills every assignee still empty (that can take it). */
function AssignAll({ requirements, values, onChange, tenantId, me, known, remember }: {
  requirements: RequirementView[]
  values: RequirementValues
  onChange: (values: RequirementValues) => void
  tenantId?: string | null
  me?: AssigneeChoice | null
  known: Record<string, AssigneeChoice>
  remember: (value: string, choice: AssigneeChoice) => void
}) {
  const [status, setStatus] = useState<string | null>(null)
  const fields = assigneeFields(requirements)
  const accepts: AssigneeKind[] = fields.some((f) => f.accepts.includes('team')) ? ['user', 'team'] : ['user']
  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-subtle/50 p-3" data-testid="assign-all">
      <p className="mb-1 text-ui font-medium text-fg" id="assign-all-label">Assign all to…</p>
      <p className="mb-2 text-xs text-fg-muted" id="assign-all-help">Fills every step that has nobody yet{accepts.includes('team') ? '; a team only goes to steps that can be assigned to a team' : ''}. You can still change each step below.</p>
      <AssigneePicker
        value=""
        actionMode
        accepts={accepts}
        label="Assign all empty steps to"
        describedBy="assign-all-help"
        tenantId={tenantId}
        me={me}
        known={known}
        placeholder={accepts.includes('team') ? 'Choose a person or team for every empty step…' : 'Choose a person for every empty step…'}
        testId="assign-all-picker"
        onPick={(value, choice) => {
          remember(value, choice)
          const result = fillEmptyAssignees(requirements, values, choice)
          onChange(result.values as RequirementValues)
          setStatus(result.filled
            ? `${choice.name} assigned to ${result.filled} step${result.filled === 1 ? '' : 's'}${result.skipped ? `; ${result.skipped} step${result.skipped === 1 ? ' takes' : 's take'} a person only and ${result.skipped === 1 ? 'was' : 'were'} left empty` : ''}.`
            : result.skipped ? `No empty step can be assigned to a team (${result.skipped} take a person only).` : 'Every step already has someone.')
        }}
      />
      {status && <p className="mt-1.5 text-xs text-fg-muted" role="status" data-testid="assign-all-status">{status}</p>}
    </div>
  )
}

export function RequirementsForm({
  requirements,
  values,
  onChange,
  showMet = true,
  tenantId,
}: {
  requirements: RequirementView[]
  values: RequirementValues
  onChange: (values: RequirementValues) => void
  showMet?: boolean
  /** The workspace the package goes into, when not the current one (assignee search). */
  tenantId?: string | null
}) {
  const [known, setKnown] = useState<Record<string, AssigneeChoice>>({})
  const remember = (value: string, choice: AssigneeChoice) => setKnown((prev) => (prev[value] ? prev : { ...prev, [value]: choice }))
  const set = (id: string, key: string, value: string) => onChange({ ...values, [id]: { ...(values[id] ?? {}), [key]: value } })
  const visible = requirements.filter((r) => showMet || r.status !== 'met')
  const assigneeCount = assigneeFields(visible).length
  const { data: me = null } = useAssigneeMe(tenantId, assigneeCount > 0)
  if (!visible.length) return <p className="text-sm text-fg-muted">Nothing to configure.</p>
  return (
    <div className="space-y-3" data-testid="requirements-form">
      {assigneeCount > 1 && <AssignAll requirements={visible} values={values} onChange={onChange} tenantId={tenantId} me={me} known={known} remember={remember} />}
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
                <p className="mt-0.5 text-xs text-fg-muted">{requirement.kind === 'user' ? assigneeDescription(requirement) : requirement.description}</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {requirement.kind === 'user' && requirement.fields.map((field) => {
                const state = states.get(field.key)
                const accepts = acceptsOf(field)
                const label = assigneeFieldLabel(field, accepts)
                const labelId = `req-${requirement.id}-${field.key}`.replace(/[^a-zA-Z0-9_-]/g, '_')
                return (
                  <div key={field.key} className="space-y-1.5" data-requirement={requirement.id} data-field={field.key}>
                    <span id={labelId} className="flex items-center gap-1 text-ui font-medium text-fg">
                      {label}
                      {state === 'missing' && !values[requirement.id]?.[field.key] && <span className="text-danger" aria-hidden>*</span>}
                    </span>
                    <AssigneePicker
                      value={values[requirement.id]?.[field.key] ?? ''}
                      accepts={accepts}
                      kept={field.assignee?.current ?? null}
                      serverError={field.assignee?.error}
                      label={label}
                      required={state === 'missing'}
                      tenantId={tenantId}
                      me={me}
                      known={known}
                      testId={`assignee-${labelId}`}
                      onPick={(value, choice) => { remember(value, choice); set(requirement.id, field.key, value) }}
                      onClear={() => set(requirement.id, field.key, '')}
                    />
                  </div>
                )
              })}
              {requirement.kind !== 'user' && requirement.fields.map((field) => {
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
