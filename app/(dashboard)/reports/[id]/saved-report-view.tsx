'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Pencil, Trash2, Share2, Star, StarOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ReportChart } from '@/components/reports/lazy-charts'
import { ReportDataTable } from '@/components/reports/report-data-table'
import { ReportExportButton } from '@/components/reports/report-export'
import { ExportAssetButton } from '@/components/shared/config-transfer'
import { REPORT_SOURCES, buildJoinedReportColumns, resolveDrillHref } from '@/lib/report-sources'
import { deleteReport, toggleFavorite, toggleShare } from '@/app/actions/reports'

interface Props {
  report: any
}

export function SavedReportView({ report }: Props) {
  const router = useRouter()
  const config = report.config ?? {}
  const { data: reportSources } = useQuery({
    queryKey: ['report-sources'],
    queryFn: async () => {
      const res = await fetch('/api/v1/reports/sources')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load report sources')
      return (json.sources ?? []) as any[]
    },
  })
  const allSources = reportSources && reportSources.length > 0 ? reportSources : REPORT_SOURCES
  const sourceDef = allSources.find((s: any) => s.key === config.data_source)
  const isDynamic = config.data_source?.startsWith('custom_table_')
  const displayColumns = useMemo(() => {
    const baseColumns = sourceDef?.columns ?? []
    return buildJoinedReportColumns(baseColumns, config.joins ?? [], allSources)
  }, [sourceDef, config.joins, allSources])

  const [data, setData] = useState<any[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchData = useCallback(async () => {
    if (!config.data_source) {
      setError('Report has no data source configured')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/reports/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const json = await res.json()
      if (!mountedRef.current) return
      if (!res.ok) throw new Error(json.error ?? 'Query failed')
      setData(json.data)
    } catch (err: any) {
      if (!mountedRef.current) return
      setError(err.message)
    }
    if (mountedRef.current) setLoading(false)
  }, [config])

  useEffect(() => { fetchData() }, [fetchData])

  const columns = data && data.length > 0
    ? (() => {
        const configuredColumns = Array.isArray(config.columns) ? config.columns as string[] : []
        const sourceColumns = displayColumns
        const fallbackColumns = Object.keys(data[0])
          .filter(k => k !== '_count' && typeof data[0][k] !== 'object')
          .map(k => {
            const col = sourceColumns.find((c) => c.key === k)
            return { key: k, label: col?.label ?? k.replace(/^data_/, '').replace(/_/g, ' '), type: col?.type }
          })

        if ((config.group_by?.length ?? 0) > 0 || (config.aggregations?.length ?? 0) > 0) {
          return fallbackColumns
        }

        if (configuredColumns.length > 0) {
          return configuredColumns.map((key) => {
            const col = sourceColumns.find((sourceCol) => sourceCol.key === key)
            return {
              key,
              label: col?.label ?? key.replace(/^data_/, '').replace(/_/g, ' '),
              type: col?.type,
            }
          })
        }

        return fallbackColumns
      })()
    : []

  const viz = config.visualization ?? 'table'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/reports" className="p-1.5 rounded-lg hover:bg-[var(--theme-surface)] transition-colors" style={{ color: 'var(--theme-muted-text)' }}>
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>{report.name}</h1>
            {report.description && <p className="text-xs mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>{report.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { toggleFavorite(report.id); router.refresh() }} className="p-2 rounded-lg hover:bg-[var(--theme-surface)]" style={{ color: 'var(--theme-muted-text)' }} title="Favorite">
            {report.is_favorite ? <Star size={16} className="text-amber-500 fill-amber-500" /> : <StarOff size={16} />}
          </button>
          <button onClick={() => { toggleShare(report.id); router.refresh() }} className="p-2 rounded-lg hover:bg-[var(--theme-surface)]" style={{ color: report.is_shared ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }} title="Share">
            <Share2 size={16} />
          </button>
          <Link href={`/reports/builder?edit=${report.id}`}>
            <Button size="sm" variant="outline"><Pencil size={13} className="mr-1" /> Edit</Button>
          </Link>
          {data && data.length > 0 && (
            <ReportExportButton data={data} columns={columns.map(c => ({ key: c.key, label: c.label }))} filename={report.name} />
          )}
          <ExportAssetButton ids={[report.id]} name={report.name} label="Export definition" />
          <button
            onClick={async () => { if (confirm('Delete this report?')) { await deleteReport(report.id); router.push('/reports') } }}
            className="p-2 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {loading && <div className="text-center py-16 text-sm" style={{ color: 'var(--theme-muted-text)' }}>Loading report data...</div>}
      {error && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{
            borderColor: 'var(--status-error)',
            backgroundColor: 'var(--status-error-bg)',
            color: 'var(--status-error)',
          }}
        >
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {viz !== 'table' && columns.length > 0 && (
            <ReportChart
              type={viz}
              data={data}
              xKey={columns[0]?.key || 'name'}
              yKeys={[columns.find(c => c.type === 'number')?.key || columns[1]?.key || 'value']}
              nameKey={columns[0]?.key || 'name'}
              valueKey={columns.find(c => c.type === 'number')?.key || 'value'}
              height={400}
              title={config.chart_style?.chart_title}
              style={config.chart_style}
            />
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
              {data.length} row{data.length !== 1 ? 's' : ''}
              {isDynamic && <span className="ml-1.5 px-1 py-0.5 rounded bg-purple-50 text-purple-600 text-[9px]">Data Table</span>}
            </span>
          </div>

          <ReportDataTable
            columns={columns.map(c => ({ key: c.key, label: c.label, type: c.type as any }))}
            data={data}
            pageSize={25}
            rowHref={config.drill_target?.href_template
              ? (row) => resolveDrillHref(config.drill_target.href_template, row)
              : undefined}
          />
        </>
      )}

      {data && data.length === 0 && !loading && (
        <div className="text-center py-16 text-sm" style={{ color: 'var(--theme-muted-text)' }}>
          No data returned. Try adjusting your filters.
        </div>
      )}
    </div>
  )
}
