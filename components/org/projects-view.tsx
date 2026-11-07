'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, FolderKanban, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Switch } from '@/components/ui/switch'
import { Table, TBody, TD, THead, TR } from '@/components/ui/table'
import { AvatarStack, formatDateRange, PersonChip, PROJECT_STATUS_LABEL, ProjectStatusBadge, SortTH, useSorted } from './shared'
import { personName, type ProjectSummaryRow } from './types'

const BOARD_COLUMNS = ['active', 'on_hold', 'completed'] as const

/** A project card: colour, key, status, owner, dates, people and teams. */
export function ProjectCard({ project, teamNames }: { project: ProjectSummaryRow; teamNames: Map<string, string> }) {
  const dates = formatDateRange(project.start_date, project.end_date)
  return (
    <Link href={`/org/projects/${project.id}`} data-project-card={project.id}
      className="block rounded-lg border border-border-subtle bg-panel p-3 shadow-elev-1 transition-colors hover:border-border-strong"
      style={{ borderTop: `3px solid ${project.colour ?? 'var(--ds-border-strong)'}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-fg">{project.name}</p>
          <p className="font-mono text-2xs text-fg-subtle">{project.key}</p>
        </div>
        <ProjectStatusBadge status={project.status} />
      </div>
      {project.description && <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{project.description}</p>}
      <div className="mt-2 space-y-1.5 text-xs text-fg-muted">
        {project.owner && <PersonChip person={project.owner} sub="Owner" />}
        {dates && <p className="flex items-center gap-1"><CalendarDays className="size-3.5" aria-hidden />{dates}</p>}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <AvatarStack people={project.member_preview} total={project.people_count} max={6} />
        <span className="flex items-center gap-0.5 text-xs tabular-nums text-fg-muted"><Users className="size-3" aria-hidden />{project.people_count}</span>
      </div>
      {project.team_ids.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1" aria-label="Teams">
          {project.team_ids.map((id) => teamNames.get(id) ? <li key={id}><Badge tone="neutral">{teamNames.get(id)}</Badge></li> : null)}
        </ul>
      )}
    </Link>
  )
}

/** Projects view: a board by status (or a sortable list). Archived projects behind a toggle. */
export function ProjectsView({ projects, layout, teamNames, showArchived, onShowArchived, canManage }: {
  projects: ProjectSummaryRow[]
  layout: 'chart' | 'list'
  teamNames: Map<string, string>
  showArchived: boolean
  onShowArchived: (value: boolean) => void
  canManage: boolean
}) {
  const archivedToggle = <Switch checked={showArchived} onCheckedChange={onShowArchived} label="Show archived" size="sm" />
  if (!projects.length && !showArchived) {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">{archivedToggle}</div>
        <EmptyState icon={FolderKanban} title="No projects yet" description="Projects bring people and whole teams together around a piece of work."
          action={canManage ? { label: 'Create a project', href: '/org/manage?tab=projects' } : undefined} />
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{archivedToggle}</div>
      {layout === 'list' ? <ProjectsTable projects={projects} /> : (
        <div className="grid gap-4 lg:grid-cols-3" data-projects-board>
          {[...BOARD_COLUMNS, ...(showArchived ? ['archived' as const] : [])].map((status) => {
            const column = projects.filter((p) => p.status === status)
            return (
              <section key={status} aria-label={PROJECT_STATUS_LABEL[status]} className="min-w-0 space-y-2 rounded-lg bg-subtle p-2">
                <h3 className="flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  {PROJECT_STATUS_LABEL[status]} <span className="tabular-nums">{column.length}</span>
                </h3>
                {column.length ? column.map((p) => <ProjectCard key={p.id} project={p} teamNames={teamNames} />) : <p className="px-1 py-4 text-center text-xs text-fg-subtle">None</p>}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ProjectsTable({ projects }: { projects: ProjectSummaryRow[] }) {
  const { sorted, sort, toggle } = useSorted(projects, {
    name: (p) => p.name.toLowerCase(),
    key: (p) => p.key,
    status: (p) => p.status,
    owner: (p) => (p.owner ? personName(p.owner) : null),
    start: (p) => p.start_date,
    end: (p) => p.end_date,
    people: (p) => p.people_count,
  }, 'name')
  return (
    <Table aria-label="Projects">
      <THead>
        <tr>
          <SortTH label="Project" column="name" sort={sort} onSort={toggle} />
          <SortTH label="Key" column="key" sort={sort} onSort={toggle} />
          <SortTH label="Status" column="status" sort={sort} onSort={toggle} />
          <SortTH label="Owner" column="owner" sort={sort} onSort={toggle} />
          <SortTH label="Start" column="start" sort={sort} onSort={toggle} />
          <SortTH label="End" column="end" sort={sort} onSort={toggle} />
          <SortTH label="People" column="people" sort={sort} onSort={toggle} numeric />
        </tr>
      </THead>
      <TBody>
        {sorted.map((p) => (
          <TR key={p.id}>
            <TD><Link href={`/org/projects/${p.id}`} className="font-medium text-primary-text hover:underline">{p.name}</Link></TD>
            <TD className="font-mono text-xs">{p.key}</TD>
            <TD><ProjectStatusBadge status={p.status} /></TD>
            <TD>{p.owner ? personName(p.owner) : <span className="text-fg-subtle">—</span>}</TD>
            <TD>{p.start_date ?? '—'}</TD>
            <TD>{p.end_date ?? '—'}</TD>
            <TD numeric>{p.people_count}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  )
}

/** Team id → name, for chips. */
export function useTeamNames(teams: ReadonlyArray<{ id: string; name: string }> | undefined) {
  return useMemo(() => new Map((teams ?? []).map((t) => [t.id, t.name])), [teams])
}

export function useProjectNames(projects: ReadonlyArray<{ id: string; name: string; key: string }> | undefined) {
  return useMemo(() => new Map((projects ?? []).map((p) => [p.id, { name: p.name, key: p.key }])), [projects])
}

/** Local state for the archived toggle (kept with the view). */
export function useShowArchived() {
  return useState(false)
}
