'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Switch } from '@/components/ui/switch'
import { Table, TBody, TD, TDActions, TH, THead, TR, TableEmpty, TableSkeleton } from '@/components/ui/table'
import { archiveProject } from '@/app/actions/org'
import { formatDateRange, ProjectStatusBadge, SortTH, useSorted } from '../shared'
import { EMPTY_PROJECT, ProjectFormDialog, type ProjectFormValues } from '../project-form-dialog'
import { useOrgRefresh } from '../use-org-refresh'
import { personName, type ProjectSummaryRow } from '../types'

/** Manage → Projects: create, edit and archive projects (members and teams on each project's page). */
export function ProjectsEditor() {
  const refresh = useOrgRefresh()
  const [showArchived, setShowArchived] = useState(false)
  const { data, isLoading } = useQuery({ queryKey: ['org', 'projects', showArchived], queryFn: () => serverQuery('org.projects', { includeArchived: showArchived }) })
  const [editing, setEditing] = useState<ProjectFormValues | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { sorted, sort, toggle } = useSorted(data?.projects ?? [], {
    name: (p) => p.name.toLowerCase(),
    status: (p) => p.status,
    owner: (p) => (p.owner ? personName(p.owner) : null),
    people: (p) => p.people_count,
  }, 'name')

  async function setArchived(p: ProjectSummaryRow, archived: boolean) {
    setError(null)
    const result = await archiveProject(p.id, archived)
    if (!result.ok) setError(result.error)
    else await refresh()
  }

  return (
    <div className="space-y-3" data-projects-editor>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Switch checked={showArchived} onCheckedChange={setShowArchived} label="Show archived" size="sm" />
        <Button leadingIcon={<Plus />} onClick={() => setEditing(EMPTY_PROJECT)}>New project</Button>
      </div>
      {error && <InlineNotice tone="danger" message={error} onDismiss={() => setError(null)} />}
      <Table aria-label="Projects">
        <THead>
          <tr>
            <SortTH label="Project" column="name" sort={sort} onSort={toggle} />
            <SortTH label="Status" column="status" sort={sort} onSort={toggle} />
            <SortTH label="Owner" column="owner" sort={sort} onSort={toggle} />
            <TH>Dates</TH>
            <SortTH label="People" column="people" sort={sort} onSort={toggle} numeric />
            <TH><span className="sr-only">Actions</span></TH>
          </tr>
        </THead>
        <TBody>
          {isLoading ? <TableSkeleton columns={6} /> : sorted.length === 0 ? (
            <TableEmpty colSpan={6} title="No projects yet" action={{ label: 'New project', onClick: () => setEditing(EMPTY_PROJECT) }} />
          ) : sorted.map((p) => (
            <TR key={p.id}>
              <TD>
                <Link href={`/org/projects/${p.id}`} className="font-medium text-primary-text hover:underline">{p.name}</Link>
                <span className="ml-2 font-mono text-2xs text-fg-subtle">{p.key}</span>
              </TD>
              <TD><ProjectStatusBadge status={p.status} /></TD>
              <TD>{p.owner ? personName(p.owner) : <span className="text-fg-subtle">—</span>}</TD>
              <TD className="text-xs text-fg-muted">{formatDateRange(p.start_date, p.end_date) || '—'}</TD>
              <TD numeric>{p.people_count}</TD>
              <TDActions>
                <IconButton size="sm" variant="ghost" label={`Edit ${p.name}`} icon={<Pencil />} onClick={() => setEditing({
                  id: p.id, name: p.name, key: p.key, description: p.description ?? '', status: p.status, owner_user_id: p.owner?.id ?? '', sponsor_user_id: p.sponsor?.id ?? '',
                  team_id: p.team?.id ?? '', org_unit_id: p.org_unit?.id ?? '', start_date: p.start_date ?? '', end_date: p.end_date ?? '', colour: p.colour ?? '',
                })} />
                {p.status === 'archived'
                  ? <IconButton size="sm" variant="ghost" label={`Restore ${p.name}`} icon={<ArchiveRestore />} onClick={() => void setArchived(p, false)} />
                  : <IconButton size="sm" variant="ghost" label={`Archive ${p.name}`} icon={<Archive />} onClick={() => void setArchived(p, true)} />}
              </TDActions>
            </TR>
          ))}
        </TBody>
      </Table>
      <ProjectFormDialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null) }} initial={editing ?? undefined} />
    </div>
  )
}
