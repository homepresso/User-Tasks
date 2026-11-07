'use client'

/**
 * A wizard form's results page (/forms/results/<project id>): summary cards
 * (responses, this week, pending, approval rate or average score), responses
 * over time and answered per question, a survey chart per question
 * (components/forms/survey-charts — aggregated on the server), and every response in a table
 * with search, a status filter, order and paging. Data comes from
 * lib/services/form-wizard getWizardResults, which decides who may see it
 * (the owner, the roles / teams chosen in the wizard, forms.edit).
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { SearchInput } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ReportMetricRow } from '@/components/reports/report-metric-row'
import { CompletionChart, ResponseTrendChart, SurveyStatChart } from '@/components/forms/survey-charts/survey-charts'
import type { WizardResults } from '@/lib/services/form-wizard'
import { getWizardResults } from '@/app/actions/form-wizard'

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'danger' | 'warning' | 'info'> = {
  Submitted: 'neutral', Pending: 'info', Approved: 'success', Declined: 'danger', 'Changes requested': 'warning',
}

function cell(value: unknown): string {
  if (value == null || value === '') return '—'
  if (Array.isArray(value)) return value.map((v) => (v && typeof v === 'object' ? String((v as { name?: string }).name ?? 'file') : String(v))).join(', ') || '—'
  if (typeof value === 'object') return JSON.stringify(value)
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) { const d = new Date(text); if (!Number.isNaN(d.getTime())) return d.toLocaleString() }
  return text
}

export function WizardResultsView({ projectId }: { projectId: string }) {
  const [data, setData] = useState<WizardResults | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [page, setPage] = useState(1)

  useEffect(() => {
    let live = true
    const timer = setTimeout(async () => {
      const res = await getWizardResults(projectId, { search: search || undefined, status: status || undefined, sort, page, page_size: 25 })
      if (!live) return
      if (res.ok) { setData(res.data); setError(null) } else setError(res.error)
    }, search ? 250 : 0)
    return () => { live = false; clearTimeout(timer) }
  }, [projectId, search, status, sort, page])

  if (error && !data) return <InlineNotice tone="danger" title="Results not available" message={error} />
  if (!data) return <PageSkeleton variant="dashboard" />
  const s = data.summary
  const metrics = [
    { label: 'Responses', value: s.total },
    { label: 'This week', value: s.this_week, ...(s.last_week ? { trend: Math.round(((s.this_week - s.last_week) / s.last_week) * 100), subtitle: 'vs last week' } : {}) },
    ...(data.approval ? [
      { label: 'Waiting for a decision', value: s.pending, tone: s.pending ? 'warning' as const : 'default' as const },
      { label: 'Approval rate', value: s.approval_rate == null ? '—' : `${s.approval_rate}%`, hint: 'Approved out of everything decided (approved, declined or sent back for changes)' },
    ] : []),
    ...(data.quiz ? [{ label: 'Average score', value: s.average_score == null ? '—' : `${s.average_score.toFixed(1)} / ${data.quiz.max}` }] : []),
  ]
  const pages = Math.max(1, Math.ceil(data.total / data.page_size))
  return (
    <div className="space-y-4" data-testid="wizard-results">
      <PageHeader
        title={data.project.name}
        description={data.project.description ?? 'Responses to this form'}
        breadcrumbs={data.can_edit ? [{ label: 'My forms', href: '/forms/wizard' }, { label: 'Results' }] : undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {data.links && <Button asChild size="sm" variant="secondary"><Link href={data.links.form}>Open the form</Link></Button>}
            {data.can_edit && data.links && <Button asChild size="sm" variant="secondary" leadingIcon={<Pencil />}><Link href={data.links.edit}>Edit with the wizard</Link></Button>}
          </div>
        }
      />
      <ReportMetricRow metrics={metrics} />
      {s.total > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <ResponseTrendChart trend={data.trend ?? []} />
          {(data.completion?.length ?? 0) > 0 && <CompletionChart completion={data.completion} total={s.total} />}
        </div>
      )}
      {data.charts.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {data.charts.map((c) => <SurveyStatChart key={c.key} stat={c} className={c.kind === 'matrix' || c.kind === 'nps' ? 'md:col-span-2' : undefined} />)}
        </div>
      )}
      <Card padding="none">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <SearchInput value={search} onValueChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search responses" aria-label="Search responses" wrapperClassName="min-w-48 flex-1" />
          {data.statuses.length > 0 && (
            <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} options={[{ value: '', label: 'Any status' }, ...data.statuses.map((x) => ({ value: x, label: x }))]} wrapperClassName="w-44" />
          )}
          <Select aria-label="Order" value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'oldest')} options={[{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }]} wrapperClassName="w-40" />
        </div>
        {data.rows.length === 0 ? (
          <EmptyState title={data.summary.total ? 'No responses match' : 'No responses yet'} description={data.summary.total ? 'Try another search or status.' : 'Share the form: responses appear here as they come in.'} variant="first-run" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="wizard-responses">
              <thead className="bg-subtle text-left text-xs text-fg-muted">
                <tr>{data.columns.map((c) => <th key={c.key} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{c.label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    {data.columns.map((c) => (
                      <td key={c.key} className="max-w-64 truncate px-3 py-2 align-top">
                        {c.key === 'status' && r.values.status ? <Badge tone={STATUS_TONE[String(r.values.status)] ?? 'neutral'}>{String(r.values.status)}</Badge>
                          : c.key === 'submitted_at' ? cell(r.values.submitted_at ?? r.created_at)
                            : cell(r.values[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-border p-3 text-xs text-fg-muted">
            <span>{data.total} responses · page {data.page} of {pages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
