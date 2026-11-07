'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SearchableEntityPicker } from '@/components/ui/searchable-entity-picker'
import { createOrgUnit } from '@/app/actions/org'
import { pickerItems } from '../shared'
import { flattenTree, parentTree } from '../tree-data'
import { indentLabel, useOrgOptions } from '../use-org-options'
import { useOrgRefresh } from '../use-org-refresh'
import type { OrgUnitNode } from '../types'

const KINDS = ['company', 'division', 'department', 'unit']

function orderedUnits(units: OrgUnitNode[]): OrgUnitNode[] {
  const roots = units.filter((u) => !u.parent_id).map((u) => u.id)
  const byId = new Map(units.map((u) => [u.id, u]))
  return flattenTree(parentTree(units, roots), 'all').map((r) => byId.get(r.id)!).filter(Boolean)
}

export function CreateUnitDialog({ open, parentId, units, onClose, onError }: {
  open: boolean
  parentId: string | null
  units: OrgUnitNode[]
  onClose: () => void
  onError: (message: string) => void
}) {
  const refresh = useOrgRefresh()
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent size="sm" title="New org unit">
        {open && (
          <form key={parentId ?? 'root'} onSubmit={async (e) => {
            e.preventDefault()
            const form = new FormData(e.currentTarget)
            setBusy(true)
            const result = await createOrgUnit({
              name: String(form.get('name') ?? ''),
              kind: String(form.get('kind') ?? '') || 'unit',
              parent_id: String(form.get('parent_id') ?? '') || null,
              description: String(form.get('description') ?? '') || null,
            })
            setBusy(false)
            if (!result.ok) { onError(result.error); return }
            await refresh()
            onClose()
          }}>
            <DialogBody className="space-y-4">
              <Field label="Name" required><Input name="name" required maxLength={200} placeholder="e.g. Finance" autoFocus /></Field>
              <Field label="Kind" description="Company, division, department, unit — or type your own">
                <Input name="kind" list="org-unit-kinds" defaultValue={parentId ? 'department' : 'division'} maxLength={50} />
              </Field>
              <datalist id="org-unit-kinds">{KINDS.map((k) => <option key={k} value={k} />)}</datalist>
              <Field label="Parent" optional>
                <Select name="parent_id" defaultValue={parentId ?? ''}>
                  <option value="">None (top level)</option>
                  {orderedUnits(units).map((u) => <option key={u.id} value={u.id}>{indentLabel(u.name, u.depth)}</option>)}
                </Select>
              </Field>
              <Field label="Description" optional><Textarea name="description" rows={2} maxLength={2000} /></Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
              <Button type="submit" loading={busy}>Create</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function MoveUnitDialog({ unit, units, isInside, onClose, onMove }: {
  unit: OrgUnitNode | null
  units: OrgUnitNode[]
  isInside: (unitId: string, candidate: string | null) => boolean
  onClose: () => void
  onMove: (parentId: string | null) => Promise<boolean>
}) {
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const choices = unit ? orderedUnits(units).filter((u) => !isInside(unit.id, u.id)) : []
  return (
    <Dialog open={!!unit} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent size="sm" title={`Move “${unit?.name ?? ''}”`}>
        <form onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          const ok = await onMove(target || null)
          setBusy(false)
          if (ok) { setTarget(''); onClose() }
        }}>
          <DialogBody>
            <Field label="New parent">
              <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Top level</option>
                {choices.map((u) => <option key={u.id} value={u.id}>{indentLabel(u.name, u.depth)}</option>)}
              </Select>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Move</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function HeadDialog({ unit, onClose, onSave }: { unit: OrgUnitNode | null; onClose: () => void; onSave: (userId: string | null) => Promise<boolean> }) {
  const { people } = useOrgOptions()
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const value = selected ?? unit?.head_user_id ?? ''
  return (
    <Dialog open={!!unit} onOpenChange={(o) => { if (!o) { setSelected(null); onClose() } }}>
      <DialogContent size="sm" title={`Head of “${unit?.name ?? ''}”`}>
        <form onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          const ok = await onSave(value || null)
          setBusy(false)
          if (ok) { setSelected(null); onClose() }
        }}>
          <DialogBody>
            <Field label="Head" optional>
              <div><SearchableEntityPicker items={pickerItems(people)} selectedId={value} placeholder="Search people…" emptyLabel="No matching people" onSelect={(id) => setSelected(id)} /></div>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
