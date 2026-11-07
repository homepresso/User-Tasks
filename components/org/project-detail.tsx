'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Building2, CalendarDays, Crown, Pencil, Trash2, UserPlus, Users, X } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { usePermissions } from '@/lib/permissions-context'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SearchableEntityPicker } from '@/components/ui/searchable-entity-picker'
import { addProjectMember, archiveProject, attachProjectTeam, deleteProject, detachProjectTeam, removeProjectMember } from '@/app/actions/org'
import { formatDateRange, PersonChip, pickerItems, ProjectStatusBadge } from './shared'
import { ProjectFormDialog, type ProjectFormValues } from './project-form-dialog'
import { indentLabel, useOrgOptions } from './use-org-options'
import { useOrgRefresh } from './use-org-refresh'
import { personName, type ProjectDetail } from './types'

/** /org/projects/[id]: a project, its people drawn as a team, and (projects.manage) its editing. */
export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const { can } = usePermissions()
  const router = useRouter()
  const refresh = useOrgRefresh()
  const canManage = can('projects.manage')
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['org', 'project', projectId], queryFn: () => serverQuery('org.project', { projectId }) })
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (isLoading && !data) return <PageSkeleton variant="detail" />
  if (error || !data) {
    return <EmptyState variant="error" title="Couldn’t load this project" description={error instanceof Error ? error.message : undefined} action={{ label: 'Try again', onClick: () => void refetch() }} />
  }

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    setNotice(null)
    const result = await fn()
    setBusy(false)
    if (!result.ok) { setNotice(result.error ?? 'Something went wrong'); return false }
    await refresh()
    return true
  }

  const archived = data.status === 'archived'
  const dates = formatDateRange(data.start_date, data.end_date)

  return (
    <div className="space-y-5" data-project-page={data.id}>
      <PageHeader
        title={<span className="flex items-center gap-2"><span aria-hidden className="size-3 rounded-full" style={{ background: data.colour ?? 'var(--ds-border-strong)' }} />{data.name}</span>}
        badge={<ProjectStatusBadge status={data.status} />}
        description={data.description ?? undefined}
        breadcrumbs={[{ label: 'Organization', href: '/org' }, { label: 'Projects', href: '/org?view=projects' }, { label: data.key }]}
        actions={canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" leadingIcon={<Pencil />} onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="secondary" leadingIcon={archived ? <ArchiveRestore /> : <Archive />} loading={busy}
              onClick={() => void run(() => archiveProject(data.id, !archived))}>{archived ? 'Restore' : 'Archive'}</Button>
            <IconButton variant="danger-ghost" label="Delete project" icon={<Trash2 />} onClick={() => setConfirmDelete(true)} />
          </div>
        ) : undefined}
      />
      {notice && <InlineNotice tone="danger" message={notice} />}

      <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
        <Meta label="Key"><span className="font-mono">{data.key}</span></Meta>
        {data.sponsor && <Meta label="Sponsor"><PersonChip person={data.sponsor} sub={null} /></Meta>}
        {dates && <Meta label="Dates"><span className="flex items-center gap-1"><CalendarDays className="size-3.5 text-fg-muted" aria-hidden />{dates}</span></Meta>}
        {data.org_unit && <Meta label="Org unit"><span className="flex items-center gap-1"><Building2 className="size-3.5 text-fg-muted" aria-hidden />{data.org_unit.name}</span></Meta>}
        {data.team && <Meta label="Owning team">{data.team.name}</Meta>}
        <Meta label="People"><span className="flex items-center gap-1"><Users className="size-3.5 text-fg-muted" aria-hidden />{data.people_count}</span></Meta>
      </dl>

      <ProjectTeamVisual project={data} canManage={canManage} busy={busy} run={run} />

      <ProjectFormDialog open={editing} onOpenChange={setEditing} initial={toForm(data)} />
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} destructive busy={busy}
        title={`Delete “${data.name}”?`} description="The project, its member list and team links are removed. People and teams are not affected."
        confirmLabel="Delete project"
        onConfirm={async () => { if (await run(() => deleteProject(data.id))) router.push('/org?view=projects') }} />
    </div>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs text-fg-muted">{label}</dt><dd className="mt-0.5 text-fg">{children}</dd></div>
}

function toForm(p: ProjectDetail): ProjectFormValues {
  return {
    id: p.id, name: p.name, key: p.key, description: p.description ?? '', status: p.status, owner_user_id: p.owner?.id ?? '', sponsor_user_id: p.sponsor?.id ?? '',
    team_id: p.team?.id ?? '', org_unit_id: p.org_unit?.id ?? '', start_date: p.start_date ?? '', end_date: p.end_date ?? '', colour: p.colour ?? '',
  }
}

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>) => Promise<boolean>

/** The project's team: owner on top, then direct members (role, allocation), then attached teams as clusters. */
function ProjectTeamVisual({ project, canManage, busy, run }: { project: ProjectDetail; canManage: boolean; busy: boolean; run: Run }) {
  const direct = project.members.filter((m) => m.direct)
  const options = useOrgOptions()
  const [adding, setAdding] = useState({ userId: '', role: 'Member', allocation: '' })
  const [teamId, setTeamId] = useState('')
  const attachable = options.teams.filter((t) => !project.team_ids.includes(t.id))

  return (
    <section aria-label="Project team" className="space-y-4" data-project-team>
      <div className="flex flex-col items-center gap-2">
        {project.owner ? (
          <Card padding="sm" className="w-64 border-primary/40 text-center">
            <p className="mb-1 flex items-center justify-center gap-1 text-2xs font-semibold uppercase tracking-wide text-fg-muted"><Crown className="size-3 text-warning" aria-hidden />Owner</p>
            <div className="flex justify-center"><PersonChip person={project.owner} /></div>
          </Card>
        ) : <p className="text-xs text-fg-subtle">No owner</p>}
        <span aria-hidden className="h-5 w-px bg-border-strong" />
      </div>

      <Card padding="md">
        <h2 className="mb-3 flex items-center justify-between text-sm font-semibold text-fg">Members <span className="text-xs font-normal text-fg-muted">{direct.length}</span></h2>
        {direct.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {direct.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-md border border-border-subtle p-2" data-project-member={m.id}>
                <PersonChip person={m} sub={[m.role, m.allocation_percent !== null ? `${m.allocation_percent}%` : null].filter(Boolean).join(' · ')} className="flex-1" />
                {m.via_team_ids.length > 0 && <Badge tone="neutral" title="Also in an attached team">+team</Badge>}
                {canManage && <IconButton size="sm" variant="ghost" label={`Remove ${personName(m)}`} icon={<X />} disabled={busy} onClick={() => void run(() => removeProjectMember(project.id, m.id))} />}
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-fg-subtle">No direct members{project.teams.length ? ' — everyone comes from the attached teams' : ''}.</p>}
        {canManage && (
          <form className="mt-3 grid gap-2 border-t border-border-subtle pt-3 sm:grid-cols-[1fr_10rem_6rem_auto]" onSubmit={async (e) => {
            e.preventDefault()
            if (!adding.userId) return
            const ok = await run(() => addProjectMember(project.id, adding.userId, { role: adding.role, allocation_percent: adding.allocation === '' ? null : Number(adding.allocation) }))
            if (ok) setAdding({ userId: '', role: 'Member', allocation: '' })
          }}>
            <SearchableEntityPicker items={pickerItems(options.people)} selectedId={adding.userId} placeholder="Add a person…" emptyLabel="No matching people" onSelect={(id) => setAdding((a) => ({ ...a, userId: id }))} />
            <Input size="sm" aria-label="Role" value={adding.role} onChange={(e) => setAdding((a) => ({ ...a, role: e.target.value }))} placeholder="Role" maxLength={100} list="project-roles" />
            <datalist id="project-roles"><option value="Lead" /><option value="Member" /><option value="Reviewer" /><option value="Stakeholder" /></datalist>
            <Input size="sm" aria-label="Allocation %" type="number" min={0} max={100} value={adding.allocation} onChange={(e) => setAdding((a) => ({ ...a, allocation: e.target.value }))} placeholder="%" />
            <Button size="sm" type="submit" leadingIcon={<UserPlus />} disabled={!adding.userId || busy}>Add</Button>
          </form>
        )}
      </Card>

      <div className="space-y-2">
        <h2 className="flex items-center justify-between text-sm font-semibold text-fg">Teams <span className="text-xs font-normal text-fg-muted">{project.teams.length}</span></h2>
        {project.teams.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {project.teams.map((t) => (
              <Card key={t.id} padding="md" style={{ borderLeft: `4px solid ${t.colour ?? 'var(--ds-border-strong)'}` }} data-project-team-card={t.id}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-fg">{t.name}</p>
                    <p className="text-xs text-fg-muted">{t.member_count} people{t.is_owning_team ? ' · owning team' : ''}{t.lead ? ` · lead ${personName(t.lead)}` : ''}</p>
                  </div>
                  {canManage && !t.is_owning_team && <IconButton size="sm" variant="ghost" label={`Detach ${t.name}`} icon={<X />} disabled={busy} onClick={() => void run(() => detachProjectTeam(project.id, t.id))} />}
                </div>
                {t.members.length ? (
                  <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {t.members.slice(0, 24).map((m) => <li key={m.id}><PersonChip person={m} sub={m.role && m.role !== 'member' ? m.role : m.job_title} /></li>)}
                    {t.members.length > 24 && <li className="text-xs text-fg-muted">+{t.members.length - 24} more</li>}
                  </ul>
                ) : <p className="mt-2 text-xs text-fg-subtle">No members</p>}
              </Card>
            ))}
          </div>
        ) : <p className="text-xs text-fg-subtle">No teams attached. Attach a team to bring all of its members (and its sub-teams’) onto the project.</p>}
        {canManage && attachable.length > 0 && (
          <form className="flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); if (teamId && await run(() => attachProjectTeam(project.id, teamId))) setTeamId('') }}>
            <Select size="sm" aria-label="Team to attach" value={teamId} onChange={(e) => setTeamId(e.target.value)} wrapperClassName="w-64">
              <option value="">Choose a team…</option>
              {attachable.map((t) => <option key={t.id} value={t.id}>{indentLabel(t.name, t.depth)}</option>)}
            </Select>
            <Button size="sm" variant="secondary" type="submit" disabled={!teamId || busy}>Attach team</Button>
          </form>
        )}
      </div>
    </section>
  )
}
