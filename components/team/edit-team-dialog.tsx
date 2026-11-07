'use client'

import { useState } from 'react'
import { updateTeamDetails } from '@/app/actions/teams'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TeamDetailsFields } from './team-details-fields'

export interface EditableTeam {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  lead_user_id: string | null
  org_unit_id: string | null
  colour: string | null
  kind: string
}

/** Edit a team: name, description, parent, lead, org unit, colour, kind (team.invite). */
export function EditTeamDialog({ team, teams, onClose, onSaved }: {
  team: EditableTeam | null
  teams: ReadonlyArray<{ id: string; name: string; parent_id: string | null }>
  onClose: () => void
  onSaved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A team can't move under itself or its sub-teams.
  const below = new Set<string>()
  if (team) {
    let frontier = [team.id]
    while (frontier.length) {
      frontier.forEach((id) => below.add(id))
      frontier = teams.filter((t) => t.parent_id && frontier.includes(t.parent_id) && !below.has(t.id)).map((t) => t.id)
    }
  }
  return (
    <Dialog open={!!team} onOpenChange={(open) => { if (!open) { setError(null); onClose() } }}>
      <DialogContent size="md" title={`Edit ${team?.name ?? 'team'}`}>
        {team && (
          <form key={team.id} onSubmit={async (e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            const str = (k: string) => String(f.get(k) ?? '').trim()
            setBusy(true)
            setError(null)
            const result = await updateTeamDetails(team.id, {
              name: str('name'),
              description: str('description') || null,
              parent_id: str('parent_id') || null,
              lead_user_id: str('lead_user_id') || null,
              org_unit_id: str('org_unit_id') || null,
              colour: str('colour') || null,
              kind: str('kind') || 'team',
            })
            setBusy(false)
            if (!result.ok) { setError(result.error); return }
            onSaved()
            onClose()
          }}>
            <DialogBody className="space-y-4">
              {error && <InlineNotice tone="danger" message={error} />}
              <Field label="Name" required><Input name="name" defaultValue={team.name} required maxLength={200} /></Field>
              <Field label="Description" optional><Textarea name="description" defaultValue={team.description ?? ''} rows={2} /></Field>
              <Field label="Parent team" optional>
                <Select name="parent_id" defaultValue={team.parent_id ?? ''}>
                  <option value="">None (top level)</option>
                  {teams.filter((t) => !below.has(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
              <TeamDetailsFields defaults={team} />
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
              <Button type="submit" loading={busy}>Save</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
