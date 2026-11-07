'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Building2, Crown, UsersRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TBody, TD, THead, TR } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { AvatarStack, KindBadge, SortTH, useSorted } from './shared'
import { personName, type TeamNode, type TeamTreeData } from './types'

/** Nesting shown inside one card; deeper sub-teams are listed as chips. */
const MAX_NEST = 3

/**
 * Teams view: each top-level team is a card with its colour, kind, lead,
 * members, org unit and projects; sub-teams sit inside their parent's card.
 */
export function TeamsView({ data, layout, projectNames, onPerson }: {
  data: TeamTreeData
  layout: 'chart' | 'list'
  projectNames: Map<string, { name: string; key: string }>
  onPerson: (id: string) => void
}) {
  const byId = useMemo(() => new Map(data.teams.map((t) => [t.id, t])), [data])
  if (!data.teams.length) {
    return <EmptyState icon={UsersRound} title="No teams yet" description="Teams group people for task routing and projects." action={{ label: 'Create a team', href: '/org/manage?tab=teams' }} />
  }
  if (layout === 'list') return <TeamsTable teams={data.teams} byId={byId} />
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" data-teams-view>
      {data.roots.map((id) => byId.get(id)).filter((t): t is TeamNode => !!t).map((team) => (
        <TeamCluster key={team.id} team={team} byId={byId} depth={0} projectNames={projectNames} onPerson={onPerson} />
      ))}
    </div>
  )
}

function TeamCluster({ team, byId, depth, projectNames, onPerson }: {
  team: TeamNode
  byId: Map<string, TeamNode>
  depth: number
  projectNames: Map<string, { name: string; key: string }>
  onPerson: (id: string) => void
}) {
  const children = team.child_ids.map((id) => byId.get(id)).filter((t): t is TeamNode => !!t)
  return (
    <section
      aria-label={`${team.name} team`}
      data-team-card={team.id}
      className={cn('rounded-lg border border-border-subtle bg-panel', depth === 0 ? 'p-4 shadow-elev-1' : 'p-3')}
      style={{ borderLeft: `4px solid ${team.colour ?? 'var(--ds-border-strong)'}` }}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className={cn('truncate font-semibold text-fg', depth === 0 ? 'text-base' : 'text-sm')}>{team.name}</h3>
          {team.description && depth === 0 && <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{team.description}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          <KindBadge kind={team.kind} />
          <span className="text-xs tabular-nums text-fg-muted" title={`${team.member_count} in this team · ${team.total_member_count} including sub-teams`}>{team.total_member_count}</span>
        </div>
      </header>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-muted">
        {team.lead ? (
          <button type="button" onClick={() => onPerson(team.lead!.id)} className="flex items-center gap-1 hover:text-fg">
            <Crown className="size-3.5 text-warning" aria-hidden /> {personName(team.lead)}
          </button>
        ) : <span className="text-fg-subtle">No lead</span>}
        {team.org_unit_name && <span className="flex items-center gap-1"><Building2 className="size-3.5" aria-hidden />{team.org_unit_name}</span>}
      </div>
      <div className="mt-2">
        <AvatarStack people={team.member_preview} total={team.member_count} max={8} />
      </div>
      {team.project_ids.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1" aria-label="Projects">
          {team.project_ids.map((id) => {
            const p = projectNames.get(id)
            return p ? <li key={id}><Link href={`/org/projects/${id}`}><Badge tone="brand" className="hover:underline">{p.key} · {p.name}</Badge></Link></li> : null
          })}
        </ul>
      )}
      {children.length > 0 && (
        depth < MAX_NEST ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {children.map((c) => <TeamCluster key={c.id} team={c} byId={byId} depth={depth + 1} projectNames={projectNames} onPerson={onPerson} />)}
          </div>
        ) : (
          <p className="mt-2 text-xs text-fg-muted">Sub-teams: {children.map((c) => c.name).join(', ')}</p>
        )
      )}
    </section>
  )
}

function TeamsTable({ teams, byId }: { teams: TeamNode[]; byId: Map<string, TeamNode> }) {
  const { sorted, sort, toggle } = useSorted(teams, {
    name: (t) => t.name.toLowerCase(),
    kind: (t) => t.kind,
    parent: (t) => (t.parent_id ? byId.get(t.parent_id)?.name ?? '' : null),
    lead: (t) => (t.lead ? personName(t.lead) : null),
    unit: (t) => t.org_unit_name,
    members: (t) => t.total_member_count,
  }, 'name')
  return (
    <Table aria-label="Teams">
      <THead>
        <tr>
          <SortTH label="Team" column="name" sort={sort} onSort={toggle} />
          <SortTH label="Kind" column="kind" sort={sort} onSort={toggle} />
          <SortTH label="Parent" column="parent" sort={sort} onSort={toggle} />
          <SortTH label="Lead" column="lead" sort={sort} onSort={toggle} />
          <SortTH label="Org unit" column="unit" sort={sort} onSort={toggle} />
          <SortTH label="Members" column="members" sort={sort} onSort={toggle} numeric />
        </tr>
      </THead>
      <TBody>
        {sorted.map((t) => (
          <TR key={t.id}>
            <TD><span className="flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-full" style={{ background: t.colour ?? 'var(--ds-border-strong)' }} /><span className="font-medium text-fg">{t.name}</span></span></TD>
            <TD className="capitalize">{t.kind}</TD>
            <TD>{t.parent_id ? byId.get(t.parent_id)?.name : <span className="text-fg-subtle">—</span>}</TD>
            <TD>{t.lead ? personName(t.lead) : <span className="text-fg-subtle">—</span>}</TD>
            <TD>{t.org_unit_name ?? <span className="text-fg-subtle">—</span>}</TD>
            <TD numeric>{t.member_count} / {t.total_member_count}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  )
}
