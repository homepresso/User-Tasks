'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { InlineNotice } from '@/components/ui/inline-notice'
import { usePermissions } from '@/lib/permissions-context'
import { describeSchedule, getNextOccurrence, type ScheduleConfig } from '@/lib/workflow-schedule'
import { Clock, Pencil, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Tooltip } from '@/components/ui/tooltip'
import { formatAbsolute, formatRelative } from '@/lib/format/date'

/**
 * Every workflow on a schedule, in one place: what it runs on, when it fires
 * next, when it last fired, and a quick pause/resume. Editing the schedule
 * itself happens on the workflow's trigger node in the builder.
 */

type ScheduledWorkflow = {
  id: string
  name: string
  is_active: boolean | null
  published_version_id: string | null
  schedule_last_fired_at: string | null
  updated_at: string | null
  config: ScheduleConfig | null
}

export default function ScheduledWorkflowsPage() {
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const { data: workflows, isLoading } = useQuery({
    queryKey: ['scheduled-workflows'],
    // The server returns each workflow's schedule trigger config, not its definition.
    queryFn: async (): Promise<ScheduledWorkflow[]> => (await serverRead('automations.scheduled')).data ?? [],
    enabled: can('workflows.view'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const now = useMemo(() => new Date(), [])

  async function toggleActive(workflow: ScheduledWorkflow) {
    setTogglingId(workflow.id)
    setNotice(null)
    try {
      // workflows.activate; audited and queued for GitHub sync.
      const { toggleWorkflow } = await import('@/app/actions/automations')
      await toggleWorkflow(workflow.id, !workflow.is_active)
      queryClient.invalidateQueries({ queryKey: ['scheduled-workflows'] })
      setNotice({ tone: 'success', message: `"${workflow.name}" schedule ${workflow.is_active ? 'paused' : 'resumed'}.` })
    } catch (e: any) {
      setNotice({ tone: 'error', message: e?.message ?? 'Could not update the workflow.' })
    } finally {
      setTogglingId(null)
    }
  }

  if (!can('workflows.view')) {
    return <p className="text-sm text-fg-muted">Not authorized.</p>
  }
  if (isLoading && !workflows) return <PageSkeleton variant="list" />

  const rows = workflows ?? []

  return (
    <div>
      <PageHeader
        title="Scheduled workflows"
        description="Workflows that run automatically on a schedule. Pause or resume them here; edit the schedule on the workflow's trigger."
      />

      <div className="space-y-4">
        {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}

        {rows.length === 0 ? (
          <div className="rounded-lg border border-border bg-panel">
            <EmptyState
              icon={Clock}
              title="No scheduled workflows yet"
              description={'Create a workflow with the "Schedule" trigger, pick when it should run, and it will appear here.'}
            />
          </div>
        ) : (
          <Table containerClassName="max-lg:overflow-x-auto" className="max-lg:min-w-[860px]">
            <THead>
              <tr>
                <TH>Workflow</TH>
                <TH>Schedule</TH>
                <TH>Next run</TH>
                <TH>Last fired</TH>
                <TH>Status</TH>
                <TH><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((workflow) => {
                const nextRun = workflow.config && workflow.is_active ? getNextOccurrence(workflow.config, now) : null
                return (
                  <TR key={workflow.id}>
                    <TD className="max-w-0">
                      <Link href={`/automations/${workflow.id}`} className="block truncate text-ui font-medium text-fg hover:underline">
                        {workflow.name}
                      </Link>
                    </TD>
                    <TD className="text-ui text-fg">
                      {workflow.config ? (
                        <span>{describeSchedule(workflow.config)}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-warning">
                          <TriangleAlert size={14} aria-hidden="true" /> Not configured
                        </span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-ui text-fg-muted">
                      {nextRun ? (
                        <Tooltip content={formatAbsolute(nextRun)}>
                          <span>{formatRelative(nextRun, { now })}</span>
                        </Tooltip>
                      ) : workflow.is_active ? '—' : 'Paused'}
                    </TD>
                    <TD className="whitespace-nowrap text-ui text-fg-muted">
                      {workflow.schedule_last_fired_at ? (
                        <Tooltip content={formatAbsolute(workflow.schedule_last_fired_at)}>
                          <span>{formatRelative(workflow.schedule_last_fired_at)}</span>
                        </Tooltip>
                      ) : 'Never'}
                    </TD>
                    <TD className="w-px whitespace-nowrap">
                      <StatusPill status={workflow.is_active ? 'active' : 'paused'} />
                    </TD>
                    <TD className="w-px whitespace-nowrap text-right">
                      <div className="inline-flex items-center gap-1">
                      {can('workflows.activate') && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={togglingId === workflow.id}
                          loading={togglingId === workflow.id}
                          onClick={() => toggleActive(workflow)}
                        >
                          {workflow.is_active ? 'Pause' : 'Resume'}
                        </Button>
                      )}
                      <Tooltip content="Edit schedule in the builder">
                        <Button asChild size="icon-sm" variant="ghost">
                          <Link href={`/automations/${workflow.id}`} aria-label="Edit schedule in the builder">
                            <Pencil aria-hidden="true" />
                          </Link>
                        </Button>
                      </Tooltip>
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        <p className="text-xs text-fg-muted">
          Schedules are checked by the platform&apos;s scheduler sweep — a workflow fires at most once per scheduled occurrence,
          and the effective precision matches how often the sweep runs.
        </p>
      </div>
    </div>
  )
}
