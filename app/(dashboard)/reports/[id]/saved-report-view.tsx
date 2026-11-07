'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, FileDown, MoreHorizontal, Pencil, Trash2, Share2, Star, StarOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { PageHeader } from '@/components/ui/page-header'
import { Badge, Tag } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Skeleton } from '@/components/ui/skeleton'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { plural } from '@/lib/format/plural'
import { ReportChart, ReportSummaryCharts } from '@/components/reports/lazy-charts'
import type { ReportChartResult } from '@/lib/report-charts'
import { ReportDataTable } from '@/components/reports/report-data-table'
import { ReportExportButton } from '@/components/reports/report-export'
import { ExportAssetDialog } from '@/components/shared/config-transfer'
import { REPORT_SOURCES, buildJoinedReportColumns, resolveDrillHref, reportResultColumnLabel } from '@/lib/report-sources'
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
  // Columns as the report service resolved them (a workflow's variable
  // columns carry their labels and types only there).
  const [resolvedColumns, setResolvedColumns] = useState<Array<{ key: string; label: string; type?: string }>>([])
  const [chartResults, setChartResults] = useState<ReportChartResult[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
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
      // Summary chart time buckets follow the viewer's own time zone.
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const res = await fetch(`/api/v1/reports/preview${timezone ? `?timezone=${encodeURIComponent(timezone)}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const json = await res.json()
      if (!mountedRef.current) return
      if (!res.ok) throw new Error(json.error ?? 'Query failed')
      setData(json.data)
      setChartResults(Array.isArray(json.charts) ? json.charts : null)
      setResolvedColumns(Array.isArray(json.available_columns) ? json.available_columns : [])
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
        const sourceColumns = [...resolvedColumns, ...displayColumns]
        const fallbackColumns = Object.keys(data[0])
          .filter(k => k !== '_count' && typeof data[0][k] !== 'object')
          .map(k => {
            const col = sourceColumns.find((c) => c.key === k)
            return { key: k, label: reportResultColumnLabel(k, sourceColumns), type: col?.type ?? (/^(COUNT|SUM|AVG)_/.test(k) ? 'number' : undefined) }
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
  const chartSpecs = Array.isArray(config.charts) ? config.charts : []

  async function onDelete() {
    setDeleting(true)
    try {
      await deleteReport(report.id)
      router.push('/reports')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: report.name }]}
        title={report.name}
        description={report.description || undefined}
        badge={report.is_shared ? <Badge tone="info">Shared</Badge> : undefined}
        actions={
          <>
            <Button asChild variant="secondary" leadingIcon={<Pencil />}>
              <Link href={`/reports/builder?edit=${report.id}`}>Edit</Link>
            </Button>
            {data && data.length > 0 && (
              <ReportExportButton data={data} columns={columns.map(c => ({ key: c.key, label: c.label }))} filename={report.name} />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="More actions" icon={<MoreHorizontal />} variant="secondary" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem icon={<FileDown />} onSelect={() => setExportOpen(true)}>Export definition</DropdownMenuItem>
                <DropdownMenuItem icon={<Share2 />} onSelect={async () => { await toggleShare(report.id); router.refresh() }}>
                  {report.is_shared ? 'Stop sharing' : 'Share with workspace'}
                </DropdownMenuItem>
                <DropdownMenuItem icon={report.is_favorite ? <StarOff /> : <Star />} onSelect={async () => { await toggleFavorite(report.id); router.refresh() }}>
                  {report.is_favorite ? 'Unpin' : 'Pin'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem danger icon={<Trash2 />} onSelect={() => setConfirmDelete(true)}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <ExportAssetDialog ids={[report.id]} name={report.name} open={exportOpen} onOpenChange={setExportOpen} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        destructive
        title={`Delete '${report.name}'?`}
        description="The saved report is removed for everyone it is shared with. Its data is not affected."
        confirmLabel="Delete report"
        busy={deleting}
        onConfirm={onDelete}
      />

      {chartSpecs.length > 0 && !error && (
        <ReportSummaryCharts specs={chartSpecs} results={loading ? null : chartResults} loading={loading} />
      )}

      {loading && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading report data">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {error && <InlineNotice tone="danger" title="Couldn't run this report" message={error} actions={<Button size="sm" variant="ghost" onClick={() => void fetchData()}>Try again</Button>} />}

      {data && !loading && data.length > 0 && (
        <>
          {viz !== 'table' && columns.length > 0 && (
            <ReportChart
              type={viz}
              data={data}
              xKey={columns[0]?.key || 'name'}
              yKeys={[columns.find(c => c.type === 'number')?.key || columns[1]?.key || 'value']}
              nameKey={columns[0]?.key || 'name'}
              valueKey={columns.find(c => c.type === 'number')?.key || 'value'}
              height={360}
              title={config.chart_style?.chart_title}
              style={config.chart_style}
              seriesLabels={Object.fromEntries(columns.map((c) => [c.key, c.label]))}
            />
          )}

          <div className="space-y-2">
            <p className="flex items-center gap-2 text-xs text-fg-muted">
              <span className="num">{plural(data.length, 'row')}</span>
              {isDynamic && <Tag>Data table</Tag>}
            </p>
            <ReportDataTable
              columns={columns.map(c => ({ key: c.key, label: c.label, type: c.type as 'text' | 'number' | 'date' | 'boolean' | undefined }))}
              data={data}
              pageSize={25}
              rowHref={config.drill_target?.href_template
                ? (row) => resolveDrillHref(config.drill_target.href_template, row)
                : undefined}
            />
          </div>
        </>
      )}

      {data && data.length === 0 && !loading && (
        <EmptyState
          size="md"
          variant="no-results"
          icon={BarChart3}
          title="This report returned no rows"
          description="Try widening its filters in the report builder."
          action={{ label: 'Edit report', href: `/reports/builder?edit=${report.id}` }}
        />
      )}
    </div>
  )
}
