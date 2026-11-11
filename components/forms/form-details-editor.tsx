'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { updateForm } from '@/app/actions/forms'
import { ObjectPermissions } from '@/components/governance/object-permissions'
import { FormGovernanceSection } from './form-governance-section'
import { FormAnonymousSection } from './form-anonymous-section'
import { FormAvailabilityHint, FormAvailabilityStatus } from './form-availability-hint'
import { FormSystemNameField } from './form-system-name-field'

/**
 * A reusable form's settings — name, description, tags, friendly link name
 * and "Available forms" (none of which makes a new version) — and its
 * Access (who may submit it, the public link, retention). The Forms
 * library's Settings dialog and the designer page's Form / Access tabs.
 */

export interface FormDetailsSource {
  id: string
  name: string
  description: string | null
  tags: string[]
  available_in_menu?: boolean
  system_name?: string | null
}

export interface FormDetailsDraft { name: string; description: string; tags: string; available: boolean; systemName: string }

export function formDetailsDraft(form: FormDetailsSource): FormDetailsDraft {
  return { name: form.name, description: form.description ?? '', tags: form.tags.join(', '), available: form.available_in_menu === true, systemName: form.system_name ?? '' }
}

export const parseTags = (text: string) => text.split(',').map((t) => t.trim()).filter(Boolean)

/**
 * The settings of a saved form (`form`), saved with their own button; or,
 * for a form not created yet (`form` null), the draft the creation will use
 * (`draft` / `onDraftChange`, no button).
 */
export function FormDetailsEditor({ form, draft, onDraftChange, onSaved, onNotice, onCancel, submitLabel = 'Save settings', idPrefix = 'form' }: {
  form: FormDetailsSource | null
  draft?: FormDetailsDraft
  onDraftChange?: (draft: FormDetailsDraft) => void
  /** After a successful save (refresh the lists). */
  onSaved?: (message: string) => void | Promise<void>
  onNotice?: (notice: { tone: 'error' | 'success'; message: string }) => void
  onCancel?: () => void
  submitLabel?: string
  idPrefix?: string
}) {
  const [own, setOwn] = useState<FormDetailsDraft>(() => (form ? formDetailsDraft(form) : draft ?? { name: '', description: '', tags: '', available: false, systemName: '' }))
  const value = form ? own : draft ?? own
  const set = (next: FormDetailsDraft) => { if (form) setOwn(next); else (onDraftChange ?? setOwn)(next) }
  const [systemNameOk, setSystemNameOk] = useState(true)
  const [turningOn, setTurningOn] = useState(false)
  const [saving, setSaving] = useState(false)
  const availableId = `${idPrefix}-available`

  async function save() {
    if (!form) return
    const systemName = value.systemName.trim().toLowerCase()
    setSaving(true)
    const result = await updateForm(form.id, {
      name: value.name, description: value.description, tags: parseTags(value.tags), available_in_menu: value.available,
      ...(systemName && systemName !== (form.system_name ?? '') ? { system_name: systemName } : {}),
    })
    setSaving(false)
    if (!result.ok) { onNotice?.({ tone: 'error', message: result.error }); return }
    await onSaved?.('Details saved')
  }

  return (
    <form className="space-y-3" data-testid="form-details-fields" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <Field label="Name"><Input required maxLength={120} value={value.name} onChange={(e) => set({ ...value, name: e.target.value })} data-testid="form-name" /></Field>
      <Field label="Description" optional><Input maxLength={2000} value={value.description} onChange={(e) => set({ ...value, description: e.target.value })} /></Field>
      <Field label="Tags" description="Comma separated" optional><Input value={value.tags} onChange={(e) => set({ ...value, tags: e.target.value })} /></Field>
      {form && (
        <FormSystemNameField formId={form.id} formName={value.name} value={value.systemName} saved={form.system_name ?? null}
          onChange={(systemName) => set({ ...value, systemName })} onValidity={setSystemNameOk} />
      )}
      <div className="flex items-start gap-2 rounded-md bg-subtle p-3">
        <input id={availableId} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={value.available}
          onChange={(e) => set({ ...value, available: e.target.checked })} aria-describedby={`${availableId}-help`} data-testid="form-available" />
        <div className="min-w-0">
          <label htmlFor={availableId} className="block text-ui font-medium">Available forms</label>
          <p id={`${availableId}-help`} className="text-xs text-fg-muted">
            Show this form in the Forms menu for people who have been given access to it: a person, a team they&apos;re in or a role they hold, under <strong>Access</strong>{form ? '' : ' (once the form is created)'}. Every form already has its own page, so there&apos;s nothing else to publish.
            {form && <FormAvailabilityStatus formId={form.id} />}
          </p>
        </div>
      </div>
      {form && (
        <FormAvailabilityHint formId={form.id} available={value.available} busy={turningOn}
          onTurnOn={async () => {
            setTurningOn(true)
            const result = await updateForm(form.id, { available_in_menu: true })
            setTurningOn(false)
            if (!result.ok) { onNotice?.({ tone: 'error', message: result.error }); return }
            set({ ...value, available: true })
            await onSaved?.(`${form.name} now shows in the Forms menu of the people with access`)
          }} />
      )}
      <p className="text-xs text-fg-muted">
        {form ? 'Name, system name, description, tags and Available forms don’t create a new version; field, layout and theme changes do.' : 'Saved when you create the form.'}
      </p>
      {form && (
        <div className="flex justify-end gap-2 pt-1">
          {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>}
          <Button type="submit" size={onCancel ? undefined : 'sm'} loading={saving} disabled={!value.name.trim() || !systemNameOk || saving}>{submitLabel}</Button>
        </div>
      )}
    </form>
  )
}

/** Who may submit the form, its public (anonymous) link, and retention / legal hold. */
export function FormAccessSections({ formId, formName }: { formId: string; formName: string }) {
  return (
    <>
      <section className="border-border" aria-label="Access" data-testid="form-access">
        <ObjectPermissions objectType="form" objectId={formId} objectName={formName} showEditDelete={false} executeLabel="Submit"
          copy={{
            openBadge: 'No one yet', restrictedBadge: 'Given access',
            open: 'No one has been given access to this form yet. Add a role, team or person: with Available forms on, the form shows in their Forms menu (they also need Submit forms).',
            restricted: 'These roles, teams and people have been given access. With Available forms on, the form shows in their Forms menu (they also need Submit forms).',
          }} />
      </section>
      <FormAnonymousSection formId={formId} formName={formName} />
      <FormGovernanceSection formId={formId} formName={formName} />
    </>
  )
}
