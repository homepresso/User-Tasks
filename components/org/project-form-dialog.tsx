'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SearchableEntityPicker } from '@/components/ui/searchable-entity-picker'
import { createProject, updateProject } from '@/app/actions/org'
import { pickerItems, PROJECT_STATUS_LABEL } from './shared'
import { indentLabel, useOrgOptions } from './use-org-options'
import { useOrgRefresh } from './use-org-refresh'

export interface ProjectFormValues {
  id?: string
  name: string
  key: string
  description: string
  status: string
  owner_user_id: string
  sponsor_user_id: string
  team_id: string
  org_unit_id: string
  start_date: string
  end_date: string
  colour: string
}

export const EMPTY_PROJECT: ProjectFormValues = {
  name: '', key: '', description: '', status: 'active', owner_user_id: '', sponsor_user_id: '', team_id: '', org_unit_id: '', start_date: '', end_date: '', colour: '',
}

const SWATCHES = ['#2563EB', '#16A34A', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#4B5563']

/** Create or edit a project (projects.manage). Creating opens the new project. */
export function ProjectFormDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (open: boolean) => void; initial?: ProjectFormValues }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" title={initial?.id ? 'Edit project' : 'New project'}>
        {open && <ProjectForm initial={initial ?? EMPTY_PROJECT} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function ProjectForm({ initial, onDone }: { initial: ProjectFormValues; onDone: () => void }) {
  const router = useRouter()
  const refresh = useOrgRefresh()
  const options = useOrgOptions()
  const [v, setV] = useState<ProjectFormValues>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (key: keyof ProjectFormValues, value: string) => setV((cur) => ({ ...cur, [key]: value }))
  const people = pickerItems(options.people)

  async function submit() {
    setBusy(true)
    setError(null)
    const input = {
      name: v.name,
      key: v.key.trim() || null,
      description: v.description || null,
      status: v.status as 'active',
      owner_user_id: v.owner_user_id || null,
      sponsor_user_id: v.sponsor_user_id || null,
      team_id: v.team_id || null,
      org_unit_id: v.org_unit_id || null,
      start_date: v.start_date || null,
      end_date: v.end_date || null,
      colour: v.colour || null,
    }
    const result = initial.id ? await updateProject(initial.id, input) : await createProject(input)
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    await refresh()
    onDone()
    if (!initial.id && result.data && typeof result.data === 'object' && 'id' in result.data) router.push(`/org/projects/${(result.data as { id: string }).id}`)
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <DialogBody className="space-y-4">
        {error && <InlineNotice tone="danger" message={error} />}
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <Field label="Name" required><Input value={v.name} onChange={(e) => set('name', e.target.value)} required maxLength={200} placeholder="e.g. Mobile app relaunch" /></Field>
          <Field label="Key" optional description={initial.id ? undefined : 'Generated when empty'}><Input value={v.key} onChange={(e) => set('key', e.target.value.toUpperCase())} maxLength={40} placeholder="MAR" className="font-mono" /></Field>
        </div>
        <Field label="Description" optional><Textarea value={v.description} onChange={(e) => set('description', e.target.value)} rows={2} maxLength={5000} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Status">
            <Select value={v.status} onChange={(e) => set('status', e.target.value)} options={Object.entries(PROJECT_STATUS_LABEL).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Colour" optional>
            <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Colour">
              <Swatch colour="" selected={!v.colour} onSelect={() => set('colour', '')} label="None" />
              {SWATCHES.map((c) => <Swatch key={c} colour={c} selected={v.colour.toUpperCase() === c} onSelect={() => set('colour', c)} label={c} />)}
            </div>
          </Field>
          <Field label="Owner" optional>
            <div><SearchableEntityPicker items={people} selectedId={v.owner_user_id} placeholder="Search people…" emptyLabel="No matching people" onSelect={(id) => set('owner_user_id', id)} /></div>
          </Field>
          <Field label="Sponsor" optional>
            <div><SearchableEntityPicker items={people} selectedId={v.sponsor_user_id} placeholder="Search people…" emptyLabel="No matching people" onSelect={(id) => set('sponsor_user_id', id)} /></div>
          </Field>
          <Field label="Owning team" optional>
            <Select value={v.team_id} onChange={(e) => set('team_id', e.target.value)}>
              <option value="">None</option>
              {options.teams.map((t) => <option key={t.id} value={t.id}>{indentLabel(t.name, t.depth)}</option>)}
            </Select>
          </Field>
          <Field label="Org unit" optional>
            <Select value={v.org_unit_id} onChange={(e) => set('org_unit_id', e.target.value)}>
              <option value="">None</option>
              {options.units.map((u) => <option key={u.id} value={u.id}>{indentLabel(u.name, u.depth)}</option>)}
            </Select>
          </Field>
          <Field label="Start date" optional><Input type="date" value={v.start_date} onChange={(e) => set('start_date', e.target.value)} /></Field>
          <Field label="End date" optional><Input type="date" value={v.end_date} min={v.start_date || undefined} onChange={(e) => set('end_date', e.target.value)} /></Field>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={busy}>Cancel</Button>
        <Button type="submit" loading={busy}>{initial.id ? 'Save' : 'Create project'}</Button>
      </DialogFooter>
    </form>
  )
}

export function Swatch({ colour, selected, onSelect, label }: { colour: string; selected: boolean; onSelect: () => void; label: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={typeof label === 'string' ? label : undefined} onClick={onSelect}
      className={`size-6 rounded-full border ${selected ? 'ring-2 ring-primary ring-offset-1' : 'border-border'}`}
      style={{ background: colour || 'repeating-linear-gradient(45deg, var(--ds-border) 0 3px, transparent 3px 6px)' }} />
  )
}
