'use client'

import { useState } from 'react'
import { Unlink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { SearchableEntityPicker } from '@/components/ui/searchable-entity-picker'
import { detachPersonProfile, updatePersonProfile } from '@/app/actions/org'
import { pickerItems } from './shared'
import { useOrgRefresh } from './use-org-refresh'
import type { PersonDetail, PersonLike } from './types'

const FIELDS = [
  { key: 'job_title', label: 'Job title' },
  { key: 'department', label: 'Department' },
  { key: 'location', label: 'Location' },
  { key: 'employee_id', label: 'Employee ID' },
  { key: 'cost_center', label: 'Cost centre' },
] as const
type FieldKey = (typeof FIELDS)[number]['key']

/**
 * Edit a person's attributes (org.manage) and manager (org.manage or
 * team.change_roles). Directory-owned attributes are read-only until
 * detached; directory sync then stops updating them.
 */
export function PersonEditForm({ person, people, canEditProfile, canEditManager, onDone }: {
  person: PersonDetail
  people: readonly PersonLike[]
  canEditProfile: boolean
  canEditManager: boolean
  onDone: () => void
}) {
  const refresh = useOrgRefresh()
  const fromDirectory = person.profile_source === 'directory'
  const [values, setValues] = useState<Record<FieldKey, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, person[f.key] ?? ''])) as Record<FieldKey, string>)
  const [managerId, setManagerId] = useState(person.manager_user_id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detached, setDetached] = useState(false)
  const locked = fromDirectory && !detached

  async function detach() {
    setBusy(true)
    setError(null)
    const result = await detachPersonProfile(person.id)
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    setDetached(true)
    await refresh()
  }

  async function save() {
    setBusy(true)
    setError(null)
    const patch: Record<string, string | null> = {}
    if (canEditProfile && !locked) {
      for (const f of FIELDS) if ((person[f.key] ?? '') !== values[f.key]) patch[f.key] = values[f.key].trim() || null
    }
    if (canEditManager && (person.manager_user_id ?? '') !== managerId) patch.manager_user_id = managerId || null
    if (!Object.keys(patch).length) { setBusy(false); onDone(); return }
    const result = await updatePersonProfile(person.id, patch)
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    await refresh()
    onDone()
  }

  const managerOptions = pickerItems(people.filter((p) => p.id !== person.id))

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save() }} data-person-edit={person.id}>
      {error && <InlineNotice tone="danger" message={error} />}
      {canEditProfile && locked && (
        <InlineNotice tone="info" title="From the directory" message="Directory sync manages these attributes. Detach them to edit here; sync then stops updating them."
          actions={<Button type="button" size="sm" variant="secondary" leadingIcon={<Unlink />} loading={busy} onClick={() => void detach()}>Detach to edit</Button>} />
      )}
      {canEditProfile && (
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label} optional>
              <Input value={values[f.key]} disabled={locked || busy} maxLength={f.key === 'employee_id' || f.key === 'cost_center' ? 100 : 200}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
            </Field>
          ))}
        </div>
      )}
      {canEditManager && (
        <Field label="Manager" optional description={person.manager_source === 'directory' ? 'Set by directory sync; a change here is replaced at the next sync while the directory names a manager.' : undefined}>
          <div>
            <SearchableEntityPicker items={managerOptions} selectedId={managerId} placeholder="Search people…" emptyLabel="No matching people"
              onSelect={(id) => setManagerId(id)} />
          </div>
        </Field>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone} disabled={busy}>Cancel</Button>
        <Button type="submit" loading={busy}>Save</Button>
      </div>
    </form>
  )
}
