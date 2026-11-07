'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Star, X } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { SearchableEntityPicker } from '@/components/ui/searchable-entity-picker'
import { addOrgUnitMember, removeOrgUnitMember } from '@/app/actions/org'
import { PersonChip, pickerItems, SourceBadge } from '../shared'
import { useOrgOptions } from '../use-org-options'
import { useOrgRefresh } from '../use-org-refresh'
import { personName } from '../types'

/** A unit's direct members, with add (role, primary) and remove. */
export function UnitMembersPanel({ unitId, onError }: { unitId: string; onError: (message: string) => void }) {
  const refresh = useOrgRefresh()
  const { people } = useOrgOptions()
  const { data } = useQuery({ queryKey: ['org', 'unit', unitId], queryFn: () => serverQuery('org.unit', { unitId }) })
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState('')
  const [primary, setPrimary] = useState(true)
  const [busy, setBusy] = useState(false)

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    const result = await fn()
    setBusy(false)
    if (!result.ok) { onError(result.error ?? 'Something went wrong'); return false }
    await refresh()
    return true
  }

  if (!data) return <div className="px-10 py-2"><Skeleton className="h-10 w-full" /></div>
  const memberIds = new Set(data.members.map((m) => m.id))
  return (
    <div className="space-y-2 bg-subtle px-4 py-3 sm:pl-12" data-unit-members={unitId}>
      {data.members.length ? (
        <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {data.members.map((m) => (
            <li key={m.id} className="flex items-center gap-1 rounded-md border border-border-subtle bg-panel p-1.5">
              <PersonChip person={m} sub={m.role ?? m.job_title} className="flex-1" />
              {m.is_primary && <Star className="size-3.5 text-warning" aria-label="Primary unit" />}
              <SourceBadge source={m.source} />
              <IconButton size="sm" variant="ghost" label={`Remove ${personName(m)}`} icon={<X />} disabled={busy} onClick={() => void act(() => removeOrgUnitMember(unitId, m.id))} />
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-fg-subtle">No direct members.</p>}
      <form className="grid gap-2 sm:grid-cols-[1fr_10rem_auto_auto] sm:items-center" onSubmit={async (e) => {
        e.preventDefault()
        if (!userId) return
        if (await act(() => addOrgUnitMember(unitId, userId, { role: role || null, is_primary: primary }))) { setUserId(''); setRole('') }
      }}>
        <SearchableEntityPicker items={pickerItems(people.filter((p) => !memberIds.has(p.id)))} selectedId={userId} placeholder="Add a member…" emptyLabel="No matching people" onSelect={(id) => setUserId(id)} />
        <Input size="sm" aria-label="Role in unit" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (optional)" maxLength={100} />
        <Checkbox checked={primary} onChange={(e) => setPrimary(e.target.checked)} label="Primary unit" />
        <Button size="sm" type="submit" disabled={!userId || busy}>Add</Button>
      </form>
    </div>
  )
}
