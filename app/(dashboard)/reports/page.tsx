"use client"

import { useState, useEffect } from 'react'
import { serverQuery } from '@/lib/server-read'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePermissions } from '@/lib/permissions-context'
import { ReportHub } from '@/components/reports/report-hub'
import { IndividualReportView, ProcessesHubView } from '@/components/reports/lazy-charts'
import { Button } from '@/components/ui/button'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { ImportConfigButton } from '@/components/shared/config-transfer'
import { BarChart3 } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs } from '@/components/ui/tabs'
import { Select } from '@/components/ui/select'
import Link from 'next/link'

const TAB_STORAGE_KEY = 'reports_active_tab'
const HUB_RANGES = [7, 30, 90, 180] as const
type HubRange = (typeof HUB_RANGES)[number]
type ReportsTab = 'general' | 'workflows' | 'individual'

export default function ReportsPage() {
  const { userId, can } = usePermissions()
  const queryClient = useQueryClient()

  // Workflows is the default landing tab — most users come to /reports to
  // check how their automations are running, not to browse saved reports.
  // We still persist the last-used tab so returning users don't get bounced
  // out of whatever view they were using.
  // The Workflows tab is workspace-wide run analytics: workflows.view_runs.
  const canRunAnalytics = can('workflows.view_runs')
  const [tab, setTab] = useState<ReportsTab>(canRunAnalytics ? 'workflows' : 'individual')
  const [range, setRange] = useState<HubRange>(90)

  // Restore last-used tab from localStorage on mount
  useEffect(() => {
    try {
      const savedTab = localStorage.getItem(TAB_STORAGE_KEY)
      if (savedTab === 'general' || (savedTab === 'workflows' && canRunAnalytics) || savedTab === 'individual') {
        setTab(savedTab)
      }
    } catch {}
  }, [canRunAnalytics])

  // Persist active tab to localStorage
  useEffect(() => {
    try { localStorage.setItem(TAB_STORAGE_KEY, tab) } catch {}
  }, [tab])

  const { data: savedReports, isLoading: isReportsLoading } = useQuery({
    queryKey: ['reports'],
    queryFn: () => serverQuery('reports.list'),
    enabled: can('reports.view'),
  })

  // The signed-in user's own report (the server reads it for the session user).
  const { data: individualReport, isLoading: isIndividualLoading } = useQuery({
    queryKey: ['reports', 'individual', userId],
    queryFn: () => serverQuery('reports.individual'),
    enabled: can('reports.view') && !!userId,
  })

  if (!can('reports.view')) {
    return <p className="text-sm text-fg-muted">Not authorized.</p>
  }

  if (isReportsLoading && !savedReports) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        description="How your workflows run, what each person is working on, and the reports your team has saved."
        actions={
          <>
            {tab === 'workflows' && (
              <Select
                aria-label="Period"
                value={String(range)}
                onChange={(e) => setRange(Number(e.target.value) as HubRange)}
                options={HUB_RANGES.map((r) => ({ value: String(r), label: `Last ${r} days` }))}
                wrapperClassName="w-36"
              />
            )}
            {can('reports.create') && <ImportConfigButton onImported={() => { setTab('general'); void queryClient.invalidateQueries({ queryKey: ['reports'] }) }} />}
            {can('reports.create') && (
              <Button asChild leadingIcon={<BarChart3 />}>
                <Link href="/reports/builder">New report</Link>
              </Button>
            )}
          </>
        }
        tabs={
          <Tabs
            aria-label="Reports"
            idBase="reports"
            value={tab}
            onValueChange={(v) => setTab(v as ReportsTab)}
            items={[
              ...(canRunAnalytics ? [{ value: 'workflows', label: 'Workflows' }] : []),
              { value: 'individual', label: 'People' },
              { value: 'general', label: 'General', count: savedReports?.length || undefined },
            ]}
          />
        }
      />

      {/* Workflows: the aggregate process hub (KPIs, trend, workflow table). */}
      {tab === 'workflows' && canRunAnalytics && <ProcessesHubView embedded range={range} />}

      {tab === 'individual' && (
        isIndividualLoading && !individualReport ? (
          <PageSkeleton variant="list" />
        ) : (
          <IndividualReportView
            assignedTasks={individualReport?.assignedTasks ?? []}
            completedTasks={individualReport?.completedTasks ?? []}
            escalations={individualReport?.escalations ?? []}
            lifecycleEvents={individualReport?.lifecycleEvents ?? []}
          />
        )
      )}

      {tab === 'general' && (
        <ReportHub savedReports={savedReports ?? []} userId={userId ?? ''} />
      )}
    </div>
  )
}
