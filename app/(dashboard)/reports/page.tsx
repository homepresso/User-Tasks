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
import { BarChart3, Workflow, UserCircle2 } from 'lucide-react'
import Link from 'next/link'

const TAB_STORAGE_KEY = 'reports_active_tab'

export default function ReportsPage() {
  const { userId, can } = usePermissions()
  const queryClient = useQueryClient()

  // Workflows is the default landing tab — most users come to /reports to
  // check how their automations are running, not to browse saved reports.
  // We still persist the last-used tab so returning users don't get bounced
  // out of whatever view they were using.
  const [tab, setTab] = useState<'general' | 'workflows' | 'individual'>('workflows')

  // Restore last-used tab from localStorage on mount
  useEffect(() => {
    try {
      const savedTab = localStorage.getItem(TAB_STORAGE_KEY)
      if (savedTab === 'general' || savedTab === 'workflows' || savedTab === 'individual') {
        setTab(savedTab)
      }
    } catch {}
  }, [])

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
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
  }

  if (isReportsLoading && !savedReports) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>Reports</h1>
        <div className="flex items-center gap-2">
          {can('reports.create') && <ImportConfigButton onImported={() => { setTab('general'); void queryClient.invalidateQueries({ queryKey: ['reports'] }) }} />}
          <Link href="/reports/builder">
            <Button size="sm"><BarChart3 size={14} className="mr-1" /> Custom Report</Button>
          </Link>
        </div>
      </div>

      {/* Tab bar — Workflows | Individual | General. Workflows is the default
          landing view (most common reason users visit /reports). General
          sits behind it for saved reports. */}
      <div className="flex rounded-lg overflow-hidden border w-fit" style={{ borderColor: 'var(--theme-surface-border)' }}>
        <button onClick={() => setTab('workflows')}
          className="px-4 py-2 text-xs font-medium flex items-center gap-1.5 transition-colors"
          style={{ backgroundColor: tab === 'workflows' ? 'var(--theme-primary)' : 'transparent', color: tab === 'workflows' ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}>
          <Workflow size={13} /> Workflows
        </button>
        <button onClick={() => setTab('individual')}
          className="px-4 py-2 text-xs font-medium flex items-center gap-1.5 transition-colors"
          style={{ backgroundColor: tab === 'individual' ? 'var(--theme-primary)' : 'transparent', color: tab === 'individual' ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}>
          <UserCircle2 size={13} /> Individual
        </button>
        <button onClick={() => setTab('general')}
          className="px-4 py-2 text-xs font-medium flex items-center gap-1.5 transition-colors"
          style={{ backgroundColor: tab === 'general' ? 'var(--theme-primary)' : 'transparent', color: tab === 'general' ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}>
          <BarChart3 size={13} /> General
        </button>
      </div>

      {/* Workflows tab — aggregate process hub. Shows KPI tiles, trend
          chart, and a searchable / filterable / sortable workflow table.
          Users click a row to drill into /reports/workflows/[id] for
          per-workflow stats + the full instance list. This is the default
          landing view so users land straight on their automation health. */}
      {tab === 'workflows' && (
        <ProcessesHubView embedded />
      )}

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

      {/* General tab */}
      {tab === 'general' && (
        <ReportHub savedReports={savedReports ?? []} userId={userId ?? ''} />
      )}
    </div>
  )
}
