"use client"

import { use, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { serverRead } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { ArrowLeft, ArrowRight, Clock, MoveRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Badge, StatusPill, type Tone } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import { usePermissions } from '@/lib/permissions-context'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { FollowButton } from '@/components/home/shared'
import { RunWaitingChip } from '@/components/automations/run-task-links'

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
  const runId: string | undefined = data?.run?.id
  // Follow / Unfollow (Home → Following).
  const { data: followed, refetch: refetchFollowed } = useQuery({
    queryKey: ['home', 'followedRunIds', runId],
    enabled: Boolean(runId),
    queryFn: async () => (await serverRead('home.followedRunIds', { ids: [runId!] })).data ?? [],
  })

  if (isLoading) return null
  if (!data) return null

  const run = data.run
  const workflow = data.workflow
  const live = run && (run.status === 'waiting_for_event' || run.status === 'paused')
  const shortId = run ? String(run.id).slice(0, 8) : null

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Workflows', href: '/automations' },
          { label: workflow?.name ?? 'Workflow', href: workflow?.id ? `/automations/${workflow.id}` : undefined },
          { label: shortId ? `Run ${shortId}` : 'Run' },
        ]}
        title={workflow?.name ?? 'Workflow'}
        badge={run ? <StatusPill status={run.status} /> : undefined}
        description={run ? (
          <>
            Run <span className="font-mono">{shortId}</span>
            {' · '}
            <Tooltip content={formatAbsolute(run.started_at)}>
              <span>{formatRelative(run.started_at)}</span>
            </Tooltip>
            {live && can('workflows.manage_runs') && data.versionNumber != null && <> · Running on v{data.versionNumber}</>}
          </>
        ) : 'No run data'}
        actions={run ? (
          <>
            {live && can('workflows.manage_runs') && (
              <Button size="sm" variant="secondary" leadingIcon={<MoveRight />} onClick={() => setMoving(true)}>
                Move to version…
              </Button>
            )}
            <FollowButton runId={run.id} following={(followed ?? []).includes(run.id)} onChange={() => { void refetchFollowed() }} />
          </>
        ) : undefined}
      />
      <div className="space-y-4">
        {live && <RunWaitingChip tasks={data.tasks} />}
        {run?.migrated_to_run_id && (
          <MigrationBanner tone="out" href={`/automations/runs/${run.migrated_to_run_id}`} runId={run.migrated_to_run_id} />
        )}
        {run?.migrated_from_run_id && (
          <MigrationBanner tone="in" href={`/automations/runs/${run.migrated_from_run_id}`} runId={run.migrated_from_run_id} />
        )}
        {moving && run && (
          <MigrateInstancesWizard workflowId={run.workflow_id} runIds={[run.id]} onClose={() => setMoving(false)} onDone={() => { void refetch() }} />
        )}
        {data.run?.sla_due_at && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-panel px-4 py-3 text-sm">
            <SlaBadge status={data.run.sla_status} />
            <div className="text-fg">
              <span className="font-medium">{data.run.sla_label ?? 'Workflow SLA'}</span>
              <Tooltip content={formatAbsolute(data.run.sla_due_at)}>
                <span className="text-fg-muted">
                  {' '}due {lowerFirst(formatRelative(data.run.sla_due_at))}
                </span>
              </Tooltip>
            </div>
            {data.run.sla_warning_at && (
              <Tooltip content={formatAbsolute(data.run.sla_warning_at)}>
                <div className="text-xs text-fg-muted">
                  Warning {lowerFirst(formatRelative(data.run.sla_warning_at))}
                </div>
              </Tooltip>
            )}
          </div>
        )}
        <ProcessViewer
          workflow={data.workflow}
          run={data.run}
          logs={data.logs}
          focus={focus}
          compareRun={data.compareRun}
          tasks={data.tasks ?? []}
        />
      </div>
    </div>
  )
}

/** "Yesterday" → "yesterday" mid-sentence (dates like "27 Oct" are unchanged). */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

function MigrationBanner({ tone, href, runId }: { tone: 'in' | 'out'; href: string; runId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2.5 text-sm text-fg">
      {tone === 'out' ? <ArrowRight size={14} className="text-info" aria-hidden="true" /> : <ArrowLeft size={14} className="text-info" aria-hidden="true" />}
      <span className="font-medium">{tone === 'out' ? 'Migrated to' : 'Migrated from'}</span>
      <Link href={href} className="font-mono text-xs text-primary-text hover:underline">run {runId.slice(0, 8)}</Link>
      <span className="text-xs text-fg-muted">
        {tone === 'out' ? 'This instance was closed and continues as a new run on another version.' : 'This run continues an instance moved from another version.'}
      </span>
    </div>
  )
}

const SLA_BADGE: Record<string, { tone: Tone; label: string }> = {
  breached: { tone: 'danger', label: 'SLA breached' },
  warning: { tone: 'warning', label: 'SLA near' },
  on_track: { tone: 'success', label: 'SLA on track' },
  none: { tone: 'neutral', label: 'No SLA' },
}

function SlaBadge({ status }: { status?: string | null }) {
  const { tone, label } = SLA_BADGE[status ?? 'on_track'] ?? SLA_BADGE.on_track
  return (
    <Badge tone={tone} pill>
      <Clock size={12} aria-hidden="true" />
      {label}
    </Badge>
  )
}
