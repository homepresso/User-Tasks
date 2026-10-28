"use client"

import { use, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { serverRead } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { Card } from '@/components/ui/card'
import { ArrowLeft, ArrowRight, Clock, MoveRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePermissions } from '@/lib/permissions-context'
import { formatRelativeDate } from '@/lib/utils'

// The process viewer (graph + trace replay) is the bulk of this route's JS;
// its own chunk lets the run header render first.
const MigrateInstancesWizard = dynamic(() => import('@/components/automations/live-instances').then((m) => m.MigrateInstancesWizard))

const ProcessViewer = dynamic(() => import('@/components/automations/process-viewer').then((m) => m.ProcessViewer), {
  loading: () => <PageSkeleton variant="list" />,
})

export default function ProcessViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const searchParams = useSearchParams()
  const focus = searchParams.get('focus')
  const { can } = usePermissions()
  const [moving, setMoving] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['process-view', id],
    queryFn: async () => (await serverRead('automations.processView', { id })).data,
  })

  if (isLoading) return null
  if (!data) return null

  const run = data.run
  const live = run && (run.status === 'waiting_for_event' || run.status === 'paused')

  return (
    <div className="space-y-4">
      {run?.migrated_to_run_id && (
        <MigrationBanner tone="out" href={`/automations/runs/${run.migrated_to_run_id}`} runId={run.migrated_to_run_id} />
      )}
      {run?.migrated_from_run_id && (
        <MigrationBanner tone="in" href={`/automations/runs/${run.migrated_from_run_id}`} runId={run.migrated_from_run_id} />
      )}
      {live && can('workflows.manage_runs') && (
        <div className="flex items-center justify-end gap-2">
          {data.versionNumber != null && (
            <span className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>Running on v{data.versionNumber}</span>
          )}
          <Button size="sm" variant="outline" onClick={() => setMoving(true)}>
            <MoveRight size={14} className="mr-1" /> Move to version…
          </Button>
        </div>
      )}
      {moving && run && (
        <MigrateInstancesWizard workflowId={run.workflow_id} runIds={[run.id]} onClose={() => setMoving(false)} onDone={() => { void refetch() }} />
      )}
      {data.run?.sla_due_at && (
        <Card className="!p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <SlaBadge status={data.run.sla_status} />
            <div style={{ color: 'var(--theme-card-text)' }}>
              <span className="font-medium">{data.run.sla_label ?? 'Workflow SLA'}</span>
              <span style={{ color: 'var(--theme-muted-text)' }}>
                {' '}due {formatRelativeDate(data.run.sla_due_at)}
              </span>
            </div>
            {data.run.sla_warning_at && (
              <div className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                Warning {formatRelativeDate(data.run.sla_warning_at)}
              </div>
            )}
          </div>
        </Card>
      )}
      <ProcessViewer
        workflow={data.workflow}
        run={data.run}
        logs={data.logs}
        focus={focus}
        compareRun={data.compareRun}
      />
    </div>
  )
}

function MigrationBanner({ tone, href, runId }: { tone: 'in' | 'out'; href: string; runId: string }) {
  return (
    <Card className="!p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--theme-card-text)' }}>
        {tone === 'out' ? <ArrowRight size={14} style={{ color: 'var(--status-info)' }} /> : <ArrowLeft size={14} style={{ color: 'var(--status-info)' }} />}
        <span className="font-medium">{tone === 'out' ? 'Migrated to' : 'Migrated from'}</span>
        <Link href={href} className="font-mono text-xs hover:underline" style={{ color: 'var(--theme-primary-text)' }}>run {runId.slice(0, 8)}</Link>
        <span className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
          {tone === 'out' ? 'This instance was closed and continues as a new run on another version.' : 'This run continues an instance moved from another version.'}
        </span>
      </div>
    </Card>
  )
}

function SlaBadge({ status }: { status?: string | null }) {
  const normalized = status ?? 'on_track'
  const colorMap: Record<string, { bg: string; fg: string; label: string }> = {
    breached: { bg: 'var(--status-danger-bg)', fg: 'var(--theme-danger)', label: 'SLA breached' },
    warning: { bg: 'var(--status-warning-bg)', fg: 'var(--theme-warning)', label: 'SLA near' },
    on_track: { bg: 'var(--status-success-bg)', fg: 'var(--theme-success)', label: 'SLA on track' },
    none: { bg: 'var(--theme-surface)', fg: 'var(--theme-muted-text)', label: 'No SLA' },
  }
  const { bg, fg, label } = colorMap[normalized] ?? colorMap.on_track
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium"
      style={{ backgroundColor: bg, color: fg }}
    >
      <Clock size={12} />
      {label}
    </span>
  )
}
