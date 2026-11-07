import type { ReadData } from '@/lib/server-read'

/** Row shapes of the Organization page reads (lib/services/ui-reads/org.ts). */
export type OrgChartData = ReadData<'org.chart'>
export type ChartPerson = OrgChartData['people'][number]
export type PersonDetail = ReadData<'org.person'>
export type OrgUnitTreeData = ReadData<'org.units'>
export type OrgUnitNode = OrgUnitTreeData['units'][number]
export type OrgUnitDetail = ReadData<'org.unit'>
export type TeamTreeData = ReadData<'org.teams'>
export type TeamNode = TeamTreeData['teams'][number]
export type ProjectsData = ReadData<'org.projects'>
export type ProjectSummaryRow = ProjectsData['projects'][number]
export type ProjectDetail = ReadData<'org.project'>

export interface PersonLike {
  id: string
  display_name: string | null
  email: string | null
  avatar_url?: string | null
  job_title?: string | null
  department?: string | null
}

export type OrgView = 'people' | 'units' | 'teams' | 'projects'
export type OrgLayout = 'chart' | 'list'

export function personName(p: Pick<PersonLike, 'display_name' | 'email'> | null | undefined): string {
  return p?.display_name || p?.email || 'Unknown'
}
