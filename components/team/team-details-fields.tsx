'use client'

import { useState } from 'react'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SearchableEntityPicker } from '@/components/ui/searchable-entity-picker'
import { Swatch } from '@/components/org/project-form-dialog'
import { pickerItems } from '@/components/org/shared'
import { indentLabel, useOrgOptions } from '@/components/org/use-org-options'

export const TEAM_SWATCHES = ['#2563EB', '#16A34A', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#4B5563']

/**
 * Team lead, org unit, colour and kind — shared by Create team and Edit team.
 * Renders named inputs (lead_user_id, org_unit_id, colour, kind) so it works
 * inside a FormData form.
 */
export function TeamDetailsFields({ defaults }: { defaults?: { lead_user_id?: string | null; org_unit_id?: string | null; colour?: string | null; kind?: string | null } }) {
  const options = useOrgOptions()
  const [lead, setLead] = useState(defaults?.lead_user_id ?? '')
  const [colour, setColour] = useState(defaults?.colour ?? '')
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind" description="Team, squad, guild or your own">
          <Input name="kind" list="team-kinds" defaultValue={defaults?.kind ?? 'team'} maxLength={50} />
        </Field>
        <Field label="Org unit" optional>
          <Select name="org_unit_id" defaultValue={defaults?.org_unit_id ?? ''}>
            <option value="">None</option>
            {options.units.map((u) => <option key={u.id} value={u.id}>{indentLabel(u.name, u.depth)}</option>)}
          </Select>
        </Field>
      </div>
      <datalist id="team-kinds"><option value="team" /><option value="squad" /><option value="guild" /></datalist>
      <Field label="Team lead" optional>
        <div>
          <input type="hidden" name="lead_user_id" value={lead} />
          <SearchableEntityPicker items={pickerItems(options.people)} selectedId={lead} placeholder="Search people…" emptyLabel="No matching people" onSelect={(id) => setLead(id)} />
        </div>
      </Field>
      <Field label="Colour" optional>
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Colour">
          <input type="hidden" name="colour" value={colour} />
          <Swatch colour="" selected={!colour} onSelect={() => setColour('')} label="None" />
          {TEAM_SWATCHES.map((c) => <Swatch key={c} colour={c} selected={colour.toUpperCase() === c} onSelect={() => setColour(c)} label={c} />)}
        </div>
      </Field>
    </>
  )
}
