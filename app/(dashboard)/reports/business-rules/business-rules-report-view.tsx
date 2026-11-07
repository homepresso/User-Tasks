'use client'

import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { ReportMetricRow } from '@/components/reports/report-metric-row'
import { ReportChart } from '@/components/reports/lazy-charts'
import { ReportDataTable } from '@/components/reports/report-data-table'
import { ReportExportButton } from '@/components/reports/report-export'
import { ReportDateFilter, getDateFrom } from '@/components/reports/report-filters'

interface Props {
  logs: any[]
  tables: any[]
}

export function BusinessRulesReportView({ logs, tables }: Props) {
  const [days, setDays] = useState(30)
  const dateFrom = getDateFrom(days)

  const filtered = useMemo(() => {
    if (!dateFrom) return logs
    return logs.filter((row) => row.created_at && new Date(row.created_at) >= dateFrom)
  }, [logs, dateFrom])

  const matchedCount = filtered.filter((row) => row.metadata?.matched === true).length
  const uniqueRules = new Set(filtered.map((row) => row.metadata?.decision_table_id).filter(Boolean)).size
  const uniqueWorkflows = new Set(filtered.map((row) => row.workflow_id).filter(Boolean)).size
  const avgDuration = filtered.length > 0
    ? Math.round(filtered.reduce((sum, row) => sum + Number(row.duration_ms ?? 0), 0) / filtered.length)
    : 0

  const byRule = useMemo(() => {
    const map = new Map<string, number>()
    filtered.forEach((row) => {
      const name = row.metadata?.decision_table_name || 'Unknown rule'
      map.set(name, (map.get(name) ?? 0) + 1)
    })
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10)
  }, [filtered])

  const byBranch = useMemo(() => {
    const map = new Map<string, number>()
    filtered.forEach((row) => {
      const label = row.metadata?.rule_label || (row.metadata?.matched ? 'Matched' : 'No match')
      map.set(label, (map.get(label) ?? 0) + 1)
    })
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10)
  }, [filtered])

  const detailRows = filtered.slice(0, 100).map((row) => ({
    id: row.id,
    decision_table_name: row.metadata?.decision_table_name ?? 'Unknown rule',
    rule_label: row.metadata?.rule_label ?? '—',
    matched: row.metadata?.matched === true ? 'Matched' : 'No match',
    workflow_name: row.workflow?.name ?? '—',
    run_title: row.run?.title ?? '—',
    run_status: row.run?.status ?? '—',
    duration_ms: row.duration_ms ?? 0,
    created_at: row.created_at,
    decision_table_id: row.metadata?.decision_table_id ?? null,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Business rules' }]}
        title="Business rules"
        description="How often each decision table runs and what it decides."
        className="mb-0"
        actions={
          <>
            <ReportDateFilter days={days} onDaysChange={setDays} />
            <ReportExportButton data={detailRows} columns={[
            { key: 'decision_table_name', label: 'Rule' },
            { key: 'rule_label', label: 'Matched branch' },
            { key: 'workflow_name', label: 'Workflow' },
            { key: 'run_status', label: 'Run status' },
            { key: 'duration_ms', label: 'Duration (ms)' },
            { key: 'created_at', label: 'Executed' },
            ]} filename="business-rules-report" />
          </>
        }
      />

      <ReportMetricRow metrics={[
        { label: 'Executions', value: filtered.length },
        { label: 'Rules hit', value: uniqueRules },
        { label: 'Workflows using rules', value: uniqueWorkflows },
        { label: 'Avg duration', value: `${avgDuration}ms` },
      ]} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReportChart type="bar" data={byRule} xKey="name" yKeys={['value']} title="Executions by business rule" />
        <ReportChart type="pie" data={byBranch} title="Matched branch distribution" />
      </div>

      <ReportDataTable
        title={`Execution Detail (${tables.length} rules configured)`}
        columns={[
          { key: 'decision_table_name', label: 'Rule' },
          { key: 'rule_label', label: 'Matched branch' },
          { key: 'matched', label: 'Result' },
          { key: 'workflow_name', label: 'Workflow' },
          { key: 'run_title', label: 'Run' },
          { key: 'run_status', label: 'Run status' },
          { key: 'duration_ms', label: 'Duration (ms)' },
          { key: 'created_at', label: 'Executed', type: 'date' },
        ]}
        data={detailRows}
        rowHref={(row) => row?.decision_table_id ? `/automations/rules/${row.decision_table_id}` : null}
      />
    </div>
  )
}
