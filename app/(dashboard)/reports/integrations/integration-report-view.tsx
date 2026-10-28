'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useMemo } from 'react'
import { ReportMetricRow } from '@/components/reports/report-metric-row'
import { ReportChart } from '@/components/reports/lazy-charts'
import { ReportDataTable } from '@/components/reports/report-data-table'
import { ReportExportButton } from '@/components/reports/report-export'

interface Props {
  integrations: any[]
  references: any[]
  connectors: any[]
}

export function IntegrationReportView({ integrations, references, connectors }: Props) {
  const active = integrations.filter(i => i.is_active).length
  const tested = integrations.filter(i => i.last_test_status)
  const passRate = tested.length > 0 ? Math.round(tested.filter(i => i.last_test_status === 'success').length / tested.length * 100) : 0

  // Types pie
  const typeCounts = useMemo(() => {
    const map = new Map<string, number>()
    integrations.forEach(i => {
      const t = (i.type ?? 'unknown').replace(/_/g, ' ')
      map.set(t, (map.get(t) ?? 0) + 1)
    })
    return [...map.entries()].map(([name, value]) => ({ name, value }))
  }, [integrations])

  // Health status
  const healthData = useMemo(() => {
    const success = integrations.filter(i => i.last_test_status === 'success').length
    const failed = integrations.filter(i => i.last_test_status === 'error').length
    const untested = integrations.filter(i => !i.last_test_status).length
    return [
      { name: 'Passing', value: success },
      { name: 'Failing', value: failed },
      { name: 'Untested', value: untested },
    ].filter(d => d.value > 0)
  }, [integrations])

  // References per integration
  const refsPerIntegration = useMemo(() => {
    const map = new Map<string, number>()
    references.forEach(r => {
      map.set(r.integration_id, (map.get(r.integration_id) ?? 0) + 1)
    })
    const intMap = new Map(integrations.map(i => [i.id, i.name]))
    return [...map.entries()]
      .map(([id, value]) => ({ name: intMap.get(id) ?? id.slice(0, 8), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [references, integrations])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/reports" className="p-1.5 rounded-lg hover:bg-[var(--theme-surface)] transition-colors" style={{ color: 'var(--theme-muted-text)' }}>
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>Integration Health</h1>
        </div>
        <ReportExportButton data={integrations} columns={[{ key: 'name', label: 'Name' }, { key: 'type', label: 'Type' }, { key: 'is_active', label: 'Active' }, { key: 'last_test_status', label: 'Status' }]} filename="integration-report" />
      </div>

      <ReportMetricRow metrics={[
        { label: 'Active Integrations', value: active },
        { label: 'Test Pass Rate', value: `${passRate}%` },
        { label: 'References', value: references.length },
        { label: 'Connectors', value: connectors.length },
      ]} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReportChart type="pie" data={typeCounts} title="Integration Types" />
        <ReportChart type="bar" data={healthData} xKey="name" yKeys={['value']} title="Health Status" />
        {refsPerIntegration.length > 0 && <ReportChart type="bar" data={refsPerIntegration} xKey="name" yKeys={['value']} title="References per Integration" />}
      </div>

      <ReportDataTable
        title="All Integrations"
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'type', label: 'Type' },
          { key: 'is_active', label: 'Active', type: 'boolean' },
          { key: 'last_test_status', label: 'Test Status', render: (v: string) => (
            <span style={{ color: v === 'success' ? 'var(--theme-success)' : v === 'error' ? 'var(--theme-danger)' : 'var(--theme-muted-text)' }}>{v ?? 'Untested'}</span>
          )},
          { key: 'last_tested_at', label: 'Last Tested', type: 'date' },
        ]}
        data={integrations}
        rowHref={(row) => row?.id ? `/integrations/${row.id}` : null}
      />
    </div>
  )
}
