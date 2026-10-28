'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { ReportMetricRow } from '@/components/reports/report-metric-row'
import { ReportChart } from '@/components/reports/lazy-charts'
import { ReportDataTable } from '@/components/reports/report-data-table'
import { ReportExportButton } from '@/components/reports/report-export'
import { ReportDateFilter, getDateFrom } from '@/components/reports/report-filters'

interface Props {
  policies: any[]
  reviews: any[]
  executions: any[]
  tables: any[]
  rows: any[]
  roles: any[]
}

export function RetentionReportView({ policies, reviews, executions, tables, rows, roles }: Props) {
  const [days, setDays] = useState(30)
  const dateFrom = getDateFrom(days)

  const filteredReviews = useMemo(() => {
    if (!dateFrom) return reviews
    return reviews.filter((row) => row.review_date && new Date(row.review_date) >= dateFrom)
  }, [reviews, dateFrom])

  const filteredExecutions = useMemo(() => {
    if (!dateFrom) return executions
    return executions.filter((row) => row.executed_at && new Date(row.executed_at) >= dateFrom)
  }, [executions, dateFrom])

  const governedAssets = tables.length + rows.length + roles.length
  const overdueReviews = filteredReviews.filter((row) => row.review_date && new Date(row.review_date) < new Date() && String(row.status ?? '').toLowerCase() !== 'completed').length
  const successfulExecutions = filteredExecutions.filter((row) => ['completed', 'success'].includes(String(row.result_status ?? '').toLowerCase())).length

  const coverageByPolicy = useMemo(() => {
    const map = new Map<string, number>()
    const add = (policyId: string | null | undefined, label: string) => {
      if (!policyId) return
      map.set(label, (map.get(label) ?? 0) + 1)
    }
    const policyLookup = new Map(policies.map((policy) => [policy.id, policy.name]))
    tables.forEach((row) => add(row.retention_policy_id, policyLookup.get(row.retention_policy_id) ?? 'Unknown policy'))
    rows.forEach((row) => add(row.retention_policy_id, policyLookup.get(row.retention_policy_id) ?? 'Unknown policy'))
    roles.forEach((row) => add(row.retention_policy_id, policyLookup.get(row.retention_policy_id) ?? 'Unknown policy'))
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10)
  }, [policies, tables, rows, roles])

  const reviewStatusData = useMemo(() => {
    const map = new Map<string, number>()
    filteredReviews.forEach((row) => {
      const key = row.status || 'open'
      map.set(key, (map.get(key) ?? 0) + 1)
    })
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [filteredReviews])

  const recentRows = filteredExecutions.slice(0, 100).map((row) => ({
    id: row.id,
    policy_name: Array.isArray(row.retention_policy) ? row.retention_policy[0]?.name : row.retention_policy?.name,
    action_type: row.action_type,
    target_type: row.target_type,
    asset_name: row.asset_name,
    result_status: row.result_status,
    executed_at: row.executed_at,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/reports" className="p-1.5 rounded-lg hover:bg-[var(--theme-surface)] transition-colors" style={{ color: 'var(--theme-muted-text)' }}>
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>Retention Policies</h1>
        </div>
        <div className="flex items-center gap-3">
          <ReportDateFilter days={days} onDaysChange={setDays} />
          <ReportExportButton data={recentRows} columns={[
            { key: 'policy_name', label: 'Policy' },
            { key: 'action_type', label: 'Action' },
            { key: 'target_type', label: 'Target Type' },
            { key: 'asset_name', label: 'Asset' },
            { key: 'result_status', label: 'Result' },
            { key: 'executed_at', label: 'Executed' },
          ]} filename="retention-report" />
        </div>
      </div>

      <ReportMetricRow metrics={[
        { label: 'Policies', value: policies.length },
        { label: 'Governed Assets', value: governedAssets },
        { label: 'Overdue Reviews', value: overdueReviews },
        { label: 'Successful Executions', value: successfulExecutions },
      ]} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReportChart type="bar" data={coverageByPolicy} xKey="name" yKeys={['value']} title="Assets by Retention Policy" />
        <ReportChart type="pie" data={reviewStatusData} title="Retention Review Status" />
      </div>

      <ReportDataTable
        title="Recent Retention Executions"
        columns={[
          { key: 'policy_name', label: 'Policy' },
          { key: 'action_type', label: 'Action' },
          { key: 'target_type', label: 'Target Type' },
          { key: 'asset_name', label: 'Asset' },
          { key: 'result_status', label: 'Result' },
          { key: 'executed_at', label: 'Executed', type: 'date' },
        ]}
        data={recentRows}
        rowHref={() => '/settings/governance?tab=retention'}
      />
    </div>
  )
}
