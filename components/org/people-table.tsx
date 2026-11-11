'use client'

import { useMemo, useState } from 'react'
import { SearchInput } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Table, TBody, TD, THead, TR, TableEmpty } from '@/components/ui/table'
import { PersonChip, SortTH, useSorted } from './shared'
import { personName, type ChartPerson } from './types'

const PAGE = 100

/** People view, list layout: an accessible, sortable table of everyone. */
export function PeopleTable({ people, onSelect }: { people: ChartPerson[]; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const names = useMemo(() => new Map(people.map((p) => [p.id, personName(p)])), [people])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people
    return people.filter((p) => `${p.display_name ?? ''} ${p.email ?? ''} ${p.job_title ?? ''} ${p.department ?? ''} ${p.location ?? ''}`.toLowerCase().includes(q))
  }, [people, query])
  const { sorted, sort, toggle } = useSorted(filtered, {
    name: (p) => personName(p).toLowerCase(),
    title: (p) => p.job_title,
    department: (p) => p.department,
    location: (p) => p.location,
    manager: (p) => (p.manager_user_id ? names.get(p.manager_user_id) ?? '' : null),
    reports: (p) => p.total_reports,
  }, 'name')

  return (
    <div className="space-y-2">
      <SearchInput size="sm" value={query} onValueChange={(v) => { setQuery(v); setLimit(PAGE) }} placeholder="Filter people" aria-label="Filter people" wrapperClassName="w-full sm:w-72" />
      <Table aria-label="People" stickyFirstColumn>
        <THead>
          <tr>
            <SortTH label="Name" column="name" sort={sort} onSort={toggle} col="title" />
            <SortTH label="Job title" column="title" sort={sort} onSort={toggle} col="name" />
            <SortTH label="Department" column="department" sort={sort} onSort={toggle} col="text" />
            <SortTH label="Location" column="location" sort={sort} onSort={toggle} col="text" />
            <SortTH label="Manager" column="manager" sort={sort} onSort={toggle} col="people" />
            <SortTH label="Reports" column="reports" sort={sort} onSort={toggle} numeric col="number" />
          </tr>
        </THead>
        <TBody>
          {sorted.length === 0 ? (
            <TableEmpty colSpan={6} variant={query ? 'no-results' : 'first-run'} title={query ? `No one matches “${query}”` : 'No members yet'} />
          ) : sorted.slice(0, limit).map((p) => (
            <TR key={p.id} interactive onClick={() => onSelect(p.id)} data-person-row={p.id}>
              <TD><button type="button" className="text-left" onClick={(e) => { e.stopPropagation(); onSelect(p.id) }}><PersonChip person={p} sub={p.email} /></button></TD>
              <TD>{p.job_title || <span className="text-fg-subtle">—</span>}</TD>
              <TD>{p.department || <span className="text-fg-subtle">—</span>}</TD>
              <TD>{p.location || <span className="text-fg-subtle">—</span>}</TD>
              <TD>{p.manager_user_id ? names.get(p.manager_user_id) ?? '—' : <span className="text-fg-subtle">—</span>}</TD>
              <TD numeric>{p.direct_reports ? `${p.direct_reports} / ${p.total_reports}` : '—'}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {sorted.length > limit && (
        <div className="flex items-center justify-between text-xs text-fg-muted">
          <span>Showing {limit} of {sorted.length}</span>
          <Button size="sm" variant="secondary" onClick={() => setLimit((l) => l + PAGE * 5)}>Show more</Button>
        </div>
      )}
    </div>
  )
}
