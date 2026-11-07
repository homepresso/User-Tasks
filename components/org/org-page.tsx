'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { LayoutList, Network, Settings2 } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { usePermissions } from '@/lib/permissions-context'
import { useDashboardAuth } from '@/lib/dashboard-auth-context'
import { useIsMobile } from '@/hooks/use-mobile'
import { PageHeader } from '@/components/ui/page-header'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PeopleChart } from './people-chart'
import { PeopleTable } from './people-table'
import { PersonSheet } from './person-sheet'
import { UnitsView } from './units-view'
import { UnitSheet } from './unit-sheet'
import { TeamsView } from './teams-view'
import { ProjectsView, useProjectNames, useTeamNames } from './projects-view'
import type { OrgLayout, OrgView } from './types'

const VIEW_LABEL: Record<OrgView, string> = { people: 'People', units: 'Org units', teams: 'Teams', projects: 'Projects' }

/**
 * /org — the Organization page: People (org chart), Org units, Teams and
 * Projects, each as a chart or an accessible list (?view=, ?layout=).
 */
export function OrgPage() {
  const { can, canAny } = usePermissions()
  const { userId } = useDashboardAuth()
  const mobile = useIsMobile()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const canOrg = can('org.view')
  const canProjects = can('projects.view')
  const canTeams = canOrg || can('team.view_members')
  const views = useMemo(() => (['people', 'units', 'teams', 'projects'] as OrgView[]).filter((v) => (v === 'projects' ? canProjects : v === 'teams' ? canTeams : canOrg)), [canOrg, canProjects, canTeams])
  const requested = params.get('view') as OrgView | null
  const view: OrgView | undefined = requested && views.includes(requested) ? requested : views[0]
  const layout: OrgLayout = params.get('layout') === 'list' ? 'list' : 'chart'

  const setParam = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(params.toString())
    next.set(key, value)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [params, pathname, router])

  const [personId, setPersonId] = useState<string | null>(null)
  const [unitId, setUnitId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const chart = useQuery({ queryKey: ['org', 'chart'], queryFn: () => serverQuery('org.chart'), enabled: canOrg })
  const units = useQuery({ queryKey: ['org', 'units'], queryFn: () => serverQuery('org.units'), enabled: canOrg && view === 'units' })
  const teams = useQuery({ queryKey: ['org', 'teams'], queryFn: () => serverQuery('org.teams'), enabled: canTeams && (view === 'teams' || view === 'projects') })
  const projects = useQuery({
    queryKey: ['org', 'projects', showArchived],
    queryFn: () => serverQuery('org.projects', { includeArchived: showArchived }),
    enabled: canProjects && (view === 'projects' || view === 'teams'),
  })
  const teamNames = useTeamNames(teams.data?.teams)
  const projectNames = useProjectNames(projects.data?.projects)

  if (!view) {
    return <EmptyState variant="error" title="Not authorized" description="You don’t have access to the organization structure." />
  }

  const canManage = canAny('org.manage', 'projects.manage', 'team.invite')
  const people = chart.data?.people ?? []
  const loading = (q: { isLoading: boolean; data?: unknown }) => q.isLoading && !q.data
  const errorOf = (q: { error: unknown }) => (q.error instanceof Error ? q.error.message : q.error ? 'Could not load' : null)
  const active = view === 'people' ? chart : view === 'units' ? units : view === 'teams' ? teams : projects

  return (
    <div className="space-y-4" data-org-page>
      <PageHeader
        className="mb-2"
        title="Organization"
        description="Reporting lines, org units, teams and projects in this workspace."
        actions={canManage ? <Button asChild variant="secondary" leadingIcon={<Settings2 />}><Link href="/org/manage">Manage</Link></Button> : undefined}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl aria-label="View" value={view} onValueChange={(v) => setParam('view', v)}
          options={views.map((v) => ({ value: v, text: VIEW_LABEL[v] }))} />
        <SegmentedControl aria-label="Layout" size="sm" value={layout} onValueChange={(v) => setParam('layout', v)}
          options={[{ value: 'chart', text: 'Chart', icon: <Network className="size-3.5" /> }, { value: 'list', text: 'List', icon: <LayoutList className="size-3.5" /> }]} />
      </div>

      {errorOf(active) ? (
        <EmptyState variant="error" title="Couldn’t load the organization" description={errorOf(active) ?? undefined} action={{ label: 'Try again', onClick: () => void active.refetch() }} />
      ) : loading(active) ? (
        <Skeleton className="h-[60vh] w-full" />
      ) : view === 'people' && chart.data ? (
        people.length === 0 ? <EmptyState title="No members yet" /> : layout === 'list'
          ? <PeopleTable people={people} onSelect={setPersonId} />
          : <PeopleChart people={people} roots={chart.data.roots} meId={userId} selectedId={personId} onSelect={setPersonId} mobile={mobile} />
      ) : view === 'units' && units.data ? (
        <UnitsView data={units.data} layout={layout} mobile={mobile} selectedId={unitId} onSelect={setUnitId} />
      ) : view === 'teams' && teams.data ? (
        <TeamsView data={teams.data} layout={layout} projectNames={projectNames} onPerson={setPersonId} />
      ) : view === 'projects' && projects.data ? (
        <ProjectsView projects={projects.data.projects} layout={layout} teamNames={teamNames} showArchived={showArchived} onShowArchived={setShowArchived} canManage={can('projects.manage')} />
      ) : null}

      <PersonSheet userId={personId} onClose={() => setPersonId(null)} onNavigate={setPersonId} people={people}
        canEditProfile={can('org.manage')} canEditManager={canAny('org.manage', 'team.change_roles')} />
      <UnitSheet unitId={unitId} onClose={() => setUnitId(null)} onNavigate={setUnitId} onPerson={canOrg ? (id) => { setUnitId(null); setPersonId(id) } : undefined} />
    </div>
  )
}
