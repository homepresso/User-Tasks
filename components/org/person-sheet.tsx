'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Pencil } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ColourDot, PersonChip, ProjectStatusBadge, SourceBadge } from './shared'
import { PersonEditForm } from './person-edit-form'
import { personName, type PersonLike } from './types'

/**
 * A person in context (org chart, lists): attributes, manager chain,
 * direct reports, peers, teams, org units and projects. Editable with
 * org.manage (attributes) / team.change_roles (manager).
 */
export function PersonSheet({ userId, onClose, onNavigate, people, canEditProfile, canEditManager }: {
  userId: string | null
  onClose: () => void
  /** Open another person (chain, reports, peers). */
  onNavigate: (id: string) => void
  /** Everyone, for the manager picker. */
  people: readonly PersonLike[]
  canEditProfile: boolean
  canEditManager: boolean
}) {
  const [editing, setEditing] = useState(false)
  const { data, isLoading, error } = useQuery({
    queryKey: ['org', 'person', userId],
    queryFn: () => serverQuery('org.person', { userId: userId! }),
    enabled: !!userId,
  })
  const canEdit = canEditProfile || canEditManager

  return (
    <Sheet open={!!userId} onOpenChange={(open) => { if (!open) { setEditing(false); onClose() } }}>
      <SheetContent size="md" title={data ? personName(data) : 'Person'} description={data?.job_title ?? undefined}>
        {isLoading || !data ? (
          error ? <InlineNotice tone="danger" message={error instanceof Error ? error.message : 'Could not load this person'} /> : (
            <div className="space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-24 w-full" /></div>
          )
        ) : editing ? (
          <PersonEditForm person={data} people={people} canEditProfile={canEditProfile} canEditManager={canEditManager} onDone={() => setEditing(false)} />
        ) : (
          <div className="space-y-5 text-sm" data-person-sheet={data.id}>
            <div className="flex items-start gap-3">
              <Avatar name={personName(data)} src={data.avatar_url} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-fg">{personName(data)}</p>
                {data.email && <p className="truncate text-xs text-fg-muted">{data.email}</p>}
                <div className="mt-1 flex flex-wrap gap-1"><SourceBadge source={data.profile_source} /></div>
              </div>
              {canEdit && <Button size="sm" variant="secondary" leadingIcon={<Pencil />} onClick={() => setEditing(true)}>Edit</Button>}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Attr label="Job title" value={data.job_title} />
              <Attr label="Department" value={data.department} />
              <Attr label="Location" value={data.location} />
              <Attr label="Employee ID" value={data.employee_id} />
              <Attr label="Cost centre" value={data.cost_center} />
              <Attr label="Reports" value={data.total_report_count ? `${data.direct_report_count} direct · ${data.total_report_count} total` : 'None'} />
            </dl>

            <Section title="Reports to">
              {data.manager_chain.length ? (
                <nav aria-label="Manager chain" className="flex flex-wrap items-center gap-1">
                  {[...data.manager_chain].reverse().map((m, i, all) => (
                    <span key={m.id} className="flex items-center gap-1">
                      <button type="button" onClick={() => onNavigate(m.id)} className="rounded px-1 text-primary-text hover:underline">{personName(m)}</button>
                      {i < all.length - 1 && <ChevronRight className="size-3 text-fg-subtle" aria-hidden />}
                    </span>
                  ))}
                </nav>
              ) : <Empty>No manager</Empty>}
              {data.manager_source === 'directory' && <p className="mt-1 text-xs text-fg-muted">Manager set by directory sync.</p>}
            </Section>

            <PeopleList title={`Direct reports (${data.direct_reports.length})`} people={data.direct_reports} onNavigate={onNavigate} empty="No direct reports" />
            <PeopleList title={`Peers (${data.peers.length})`} people={data.peers} onNavigate={onNavigate} empty="No peers" max={8} />

            <Section title="Teams">
              {data.teams.length ? (
                <ul className="space-y-1">
                  {data.teams.map((t) => (
                    <li key={t.id} className="flex items-center gap-2">
                      <ColourDot colour={t.colour} />
                      <span className="text-fg">{t.path.length ? `${t.path.join(' › ')} › ` : ''}{t.name}</span>
                      {t.is_lead && <Badge tone="brand">Lead</Badge>}
                      {t.role && t.role !== 'member' && !t.is_lead && <span className="text-xs text-fg-muted">{t.role}</span>}
                    </li>
                  ))}
                </ul>
              ) : <Empty>Not in a team</Empty>}
            </Section>

            <Section title="Org units">
              {data.org_units.length ? (
                <ul className="space-y-1">
                  {data.org_units.map((u) => (
                    <li key={u.id} className="flex flex-wrap items-center gap-2">
                      <span className="text-fg">{u.path.length ? `${u.path.join(' › ')} › ` : ''}{u.name}</span>
                      {u.is_primary && <Badge tone="neutral">Primary</Badge>}
                      {u.is_head && <Badge tone="brand">Head</Badge>}
                    </li>
                  ))}
                </ul>
              ) : <Empty>No org unit</Empty>}
            </Section>

            {data.projects && (
              <Section title="Projects">
                {data.projects.length ? (
                  <ul className="space-y-1.5">
                    {data.projects.map((p) => (
                      <li key={p.id} className="flex items-center gap-2">
                        <ColourDot colour={p.colour} />
                        <Link href={`/org/projects/${p.id}`} className="truncate text-primary-text hover:underline">{p.name}</Link>
                        <span className="font-mono text-2xs text-fg-subtle">{p.key}</span>
                        <ProjectStatusBadge status={p.status} />
                        {p.role && <span className="text-xs text-fg-muted">{p.role}</span>}
                        {!p.direct && <span className="text-xs text-fg-subtle">via team</span>}
                      </li>
                    ))}
                  </ul>
                ) : <Empty>No projects</Empty>}
              </Section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Attr({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="truncate text-fg">{value || '—'}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h3>
      {children}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-fg-subtle">{children}</p>
}

function PeopleList({ title, people, onNavigate, empty, max = 20 }: { title: string; people: PersonLike[]; onNavigate: (id: string) => void; empty: string; max?: number }) {
  return (
    <Section title={title}>
      {people.length ? (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {people.slice(0, max).map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onNavigate(p.id)} className="w-full rounded-md p-1 text-left hover:bg-subtle">
                <PersonChip person={p} />
              </button>
            </li>
          ))}
          {people.length > max && <li className="self-center text-xs text-fg-muted">+{people.length - max} more</li>}
        </ul>
      ) : <Empty>{empty}</Empty>}
    </Section>
  )
}
