'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Unlink } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { SearchableEntityPicker } from '@/components/ui/searchable-entity-picker'
import { Table, TBody, TD, TH, THead, TR, TableEmpty, TableSkeleton } from '@/components/ui/table'
import { detachPersonProfile, updatePersonProfile } from '@/app/actions/org'
import { PersonChip, pickerItems, SourceBadge } from '../shared'
import { useOrgRefresh } from '../use-org-refresh'
import { personName, type ChartPerson } from '../types'
import { InlineText } from './inline-text'

const PAGE = 50
const FIELDS = [
  { key: 'job_title', label: 'Job title', max: 200 },
  { key: 'department', label: 'Department', max: 200 },
  { key: 'location', label: 'Location', max: 200 },
  { key: 'employee_id', label: 'Employee ID', max: 100 },
  { key: 'cost_center', label: 'Cost centre', max: 100 },
] as const

/**
 * Manage → People: every member's attributes and manager, edited in place.
 * Rows the directory owns are locked until detached.
 */
export function PeopleEditor({ canEditProfile, canEditManager }: { canEditProfile: boolean; canEditManager: boolean }) {
  const refresh = useOrgRefresh()
  const { data, isLoading } = useQuery({ queryKey: ['org', 'chart'], queryFn: () => serverQuery('org.chart') })
  const people = useMemo(() => data?.people ?? [], [data])
  const names = useMemo(() => new Map(people.map((p) => [p.id, personName(p)])), [people])
  const departments = useMemo(() => Array.from(new Set(people.map((p) => p.department).filter((d): d is string => !!d))).sort(), [people])
  const [query, setQuery] = useState('')
  const [department, setDepartment] = useState('')
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pickingFor, setPickingFor] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return people.filter((p) => (!department || p.department === department)
      && (!q || `${p.display_name ?? ''} ${p.email ?? ''} ${p.job_title ?? ''} ${p.employee_id ?? ''}`.toLowerCase().includes(q)))
  }, [people, query, department])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const rows = filtered.slice(page * PAGE, page * PAGE + PAGE)

  async function save(userId: string, patch: Record<string, string | null>) {
    setError(null)
    const result = await updatePersonProfile(userId, patch)
    if (!result.ok) { setError(result.error); return false }
    await refresh()
    return true
  }

  async function detach(p: ChartPerson) {
    setError(null)
    const result = await detachPersonProfile(p.id)
    if (!result.ok) setError(result.error)
    else await refresh()
  }

  return (
    <div className="space-y-3" data-people-editor>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput size="sm" value={query} onValueChange={(v) => { setQuery(v); setPage(0) }} placeholder="Find people" aria-label="Find people" wrapperClassName="w-full sm:w-72" />
        <Select size="sm" aria-label="Department" value={department} onChange={(e) => { setDepartment(e.target.value); setPage(0) }} wrapperClassName="w-48">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
        <span className="text-xs text-fg-muted">{filtered.length} people</span>
      </div>
      {error && <InlineNotice tone="danger" message={error} onDismiss={() => setError(null)} />}
      <Table aria-label="People attributes">
        <THead>
          <tr>
            <TH>Person</TH>
            {FIELDS.map((f) => <TH key={f.key}>{f.label}</TH>)}
            <TH>Manager</TH>
            <TH><span className="sr-only">Source</span></TH>
          </tr>
        </THead>
        <TBody>
          {isLoading ? <TableSkeleton columns={FIELDS.length + 3} /> : rows.length === 0 ? (
            <TableEmpty colSpan={FIELDS.length + 3} variant="no-results" title="No one matches" />
          ) : rows.map((p) => {
            const locked = p.profile_source === 'directory'
            return (
              <TR key={p.id} data-people-editor-row={p.id}>
                <TD className="min-w-48"><PersonChip person={p} sub={p.email} /></TD>
                {FIELDS.map((f) => (
                  <TD key={f.key} className="min-w-32">
                    <InlineText value={p[f.key] ?? ''} maxLength={f.max} label={`${f.label} of ${personName(p)}`}
                      disabled={!canEditProfile || locked} onSave={(value) => save(p.id, { [f.key]: value || null })} />
                  </TD>
                ))}
                <TD className="min-w-48">
                  {canEditManager && pickingFor === p.id ? (
                    <div className="flex items-start gap-1">
                      <div className="flex-1">
                        <SearchableEntityPicker items={pickerItems(people.filter((x) => x.id !== p.id))} selectedId="" placeholder="Search…" emptyLabel="No matches"
                          onSelect={async (id) => { if (await save(p.id, { manager_user_id: id || null })) setPickingFor(null) }} />
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setPickingFor(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <span className="flex items-center gap-1">
                      <button type="button" disabled={!canEditManager} onClick={() => setPickingFor(p.id)}
                        className="truncate rounded px-1 text-left text-sm hover:bg-subtle disabled:hover:bg-transparent" aria-label={`Manager of ${personName(p)}`}>
                        {p.manager_user_id ? names.get(p.manager_user_id) : <span className="text-fg-subtle">None</span>}
                      </button>
                      {canEditManager && p.manager_user_id && <Button size="sm" variant="link" onClick={() => void save(p.id, { manager_user_id: null })}>Clear</Button>}
                    </span>
                  )}
                </TD>
                <TD>
                  {locked ? (
                    <span className="flex items-center gap-1">
                      <SourceBadge source="directory" />
                      {canEditProfile && <Button size="sm" variant="ghost" leadingIcon={<Unlink />} onClick={() => void detach(p)}>Detach</Button>}
                    </span>
                  ) : null}
                </TD>
              </TR>
            )
          })}
        </TBody>
      </Table>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-fg-muted">
          <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((x) => x - 1)}>Previous</Button>
          <span>Page {page + 1} of {pages}</span>
          <Button size="sm" variant="secondary" disabled={page >= pages - 1} onClick={() => setPage((x) => x + 1)}>Next</Button>
        </div>
      )}
    </div>
  )
}
