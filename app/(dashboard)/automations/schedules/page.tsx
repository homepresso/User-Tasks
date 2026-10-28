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
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
  }
  if (isLoading && !workflows) return <PageSkeleton variant="list" />

  const rows = workflows ?? []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Scheduled Workflows</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
          Workflows that run automatically on a schedule. Pause or resume them here; edit the schedule on the workflow&apos;s trigger.
        </p>
      </div>

      {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}

      {rows.length === 0 ? (
        <div className="rounded-2xl border p-10 text-center" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
          <Clock size={28} className="mx-auto mb-3" style={{ color: 'var(--theme-primary-text)' }} />
          <p className="text-sm font-semibold">No scheduled workflows yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
            Create a workflow with the &quot;Schedule&quot; trigger, pick when it should run, and it will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden max-lg:overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <div
            className="grid text-[10px] font-semibold uppercase tracking-wider max-lg:min-w-[860px]"
            style={{ gridTemplateColumns: '1.4fr 1.2fr 1fr 1fr 90px 90px', backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}
          >
            <div className="px-3 py-2">Workflow</div>
            <div className="px-2 py-2">Schedule</div>
            <div className="px-2 py-2">Next run</div>
            <div className="px-2 py-2">Last fired</div>
            <div className="px-2 py-2">Status</div>
            <div className="px-2 py-2 text-right">Actions</div>
          </div>

          {rows.map((workflow) => {
            const nextRun = workflow.config && workflow.is_active ? getNextOccurrence(workflow.config, now) : null
            return (
              <div
                key={workflow.id}
                className="grid items-center border-t text-xs max-lg:min-w-[860px]"
                style={{ gridTemplateColumns: '1.4fr 1.2fr 1fr 1fr 90px 90px', borderColor: 'var(--theme-surface-border)' }}
              >
                <div className="min-w-0 px-3 py-3">
                  <Link href={`/automations/${workflow.id}`} className="truncate font-medium hover:underline block">
                    {workflow.name}
                  </Link>
                </div>
                <div className="px-2 py-3">
                  {workflow.config ? (
                    <span>{describeSchedule(workflow.config)}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1" style={{ color: 'var(--theme-warning)' }}>
                      <TriangleAlert size={11} /> Not configured
                    </span>
                  )}
                </div>
                <div className="px-2 py-3" style={{ color: 'var(--theme-muted-text)' }}>
                  {nextRun ? nextRun.toLocaleString() : workflow.is_active ? '—' : 'Paused'}
                </div>
                <div className="px-2 py-3" style={{ color: 'var(--theme-muted-text)' }}>
                  {workflow.schedule_last_fired_at ? new Date(workflow.schedule_last_fired_at).toLocaleString() : 'Never'}
                </div>
                <div className="px-2 py-3">
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{
                      backgroundColor: workflow.is_active
                        ? 'color-mix(in srgb, var(--theme-success) 12%, var(--theme-card-bg))'
                        : 'var(--theme-surface)',
                      color: workflow.is_active ? 'var(--theme-success)' : 'var(--theme-muted-text)',
                    }}
                  >
                    {workflow.is_active ? 'Active' : 'Paused'}
                  </span>
                </div>
                <div className="px-2 py-3 flex items-center justify-end gap-1">
                  {can('workflows.activate') && (
                    <button
                      type="button"
                      disabled={togglingId === workflow.id}
                      onClick={() => toggleActive(workflow)}
                      className="rounded-md border px-2 py-1 text-[10px] font-medium transition-colors hover:opacity-80 disabled:opacity-50"
                      style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}
                    >
                      {togglingId === workflow.id ? '…' : workflow.is_active ? 'Pause' : 'Resume'}
                    </button>
                  )}
                  <Link
                    href={`/automations/${workflow.id}`}
                    title="Edit schedule in the builder"
                    className="rounded-md border p-1.5 transition-colors hover:opacity-80"
                    style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}
                  >
                    <Pencil size={11} />
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
        Schedules are checked by the platform&apos;s scheduler sweep — a workflow fires at most once per scheduled occurrence,
        and the effective precision matches how often the sweep runs.
      </p>
    </div>
  )
}
