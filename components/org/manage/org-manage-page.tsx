'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Network } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { usePermissions } from '@/lib/permissions-context'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { TeamList } from '@/components/team/team-list'
import { CreateTeamDialog } from '@/components/team/create-team-dialog'
import { OrgImportPanel } from '@/components/org/org-import-panel'
import { PeopleEditor } from './people-editor'
import { UnitsEditor } from './units-editor'
import { ProjectsEditor } from './projects-editor'

type Tab = 'people' | 'units' | 'teams' | 'projects' | 'import'

/** /org/manage — the organization editor (org.manage, projects.manage, team management). */
export function OrgManagePage() {
  const { can, canAny } = usePermissions()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const canOrg = can('org.manage')
  const canTeams = canAny('team.invite', 'team.remove')
  const tabs = useMemo(() => {
    const out: Array<{ value: Tab; label: string }> = []
    if (canOrg || can('team.change_roles')) out.push({ value: 'people', label: 'People' })
    if (canOrg) out.push({ value: 'units', label: 'Org units' })
    if (canTeams) out.push({ value: 'teams', label: 'Teams' })
    if (can('projects.manage')) out.push({ value: 'projects', label: 'Projects' })
    if (canOrg || can('org.view')) out.push({ value: 'import', label: 'Import / export' })
    return out
  }, [can, canOrg, canTeams])
  const requested = params.get('tab') as Tab | null
  const tab = tabs.find((t) => t.value === requested)?.value ?? tabs[0]?.value

  const teams = useQuery({ queryKey: ['teams'], queryFn: () => serverQuery('settings.teams'), enabled: tab === 'teams' && can('team.view_members') })

  if (!tab) return <EmptyState variant="error" title="Not authorized" description="You can’t manage the organization structure." />

  return (
    <div className="space-y-4" data-org-manage>
      <PageHeader
        className="mb-2"
        title="Manage organization"
        description="People attributes and reporting lines, org units, teams and projects; import from CSV or export."
        breadcrumbs={[{ label: 'Organization', href: '/org' }, { label: 'Manage' }]}
        actions={<Button asChild variant="secondary" leadingIcon={<Network />}><Link href="/org">View chart</Link></Button>}
        tabs={(
          <Tabs idBase="org-manage" items={tabs} value={tab}
            onValueChange={(v) => { const next = new URLSearchParams(params.toString()); next.set('tab', v); router.replace(`${pathname}?${next.toString()}`, { scroll: false }) }} />
        )}
      />
      {tab === 'people' && <PeopleEditor canEditProfile={canOrg} canEditManager={canAny('org.manage', 'team.change_roles')} />}
      {tab === 'units' && <UnitsEditor />}
      {tab === 'teams' && (
        <div className="space-y-3">
          <div className="flex justify-end"><CreateTeamDialog teams={teams.data ?? []} /></div>
          <TeamList teams={teams.data ?? []} canManage={canTeams} />
        </div>
      )}
      {tab === 'projects' && <ProjectsEditor />}
      {tab === 'import' && <OrgImportPanel canManage={canOrg} />}
    </div>
  )
}
