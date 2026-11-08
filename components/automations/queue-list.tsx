'use client'

import { Fragment, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, FileText, Trash2, ExternalLink, CornerDownRight, Pause, Play, Copy, ChevronDown, ChevronUp, MoveRight, SkipForward } from 'lucide-react'
import dynamic from 'next/dynamic'
import { usePermissions } from '@/lib/permissions-context'
import { Pagination } from '@/components/ui/list-controls'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Checkbox } from '@/components/ui/checkbox'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Badge, StatusPill, Tag } from '@/components/ui/badge'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Card } from '@/components/ui/card'
import { Tooltip } from '@/components/ui/tooltip'
import { formatCount } from '@/lib/format/number'
import { formatDurationMs } from '@/lib/format/duration'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { plural } from '@/lib/format/plural'
import { deleteQueueJob } from '@/app/actions/workflow-queue'
import { runInlineJob, useJobs } from '@/components/jobs/jobs-provider'
import { serverRead } from '@/lib/server-read'
import { QUEUE_PAGE_SIZES, type QueueItem } from '@/lib/automations/queue-filters'

const MigrateInstancesWizard = dynamic(() => import('./live-instances').then((m) => m.MigrateInstancesWizard))

const statusLabels: Record<string, string> = { waiting_for_event: 'Awaiting action', completed: 'Completed', failed: 'Failed', pending: 'Pending', processing: 'Processing', running: 'Running', dead: 'Dead', paused: 'Paused', migrated: 'Migrated', cancelled: 'Cancelled' }

interface QueueListProps {
  /** One page of queue items (filtered, sorted and paged on the server). */
  rows: QueueItem[]
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  /** Shown instead of the rows when the page is empty. */
  empty: ReactNode
}

export function QueueList({ rows, page, pageSize, total, onPageChange, onPageSizeChange, empty }: QueueListProps) {
  const [localJobs, setLocalJobs] = useState<QueueItem[]>(rows)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set())
  const [gotoJob, setGotoJob] = useState<QueueItem | null>(null)
  const [gotoNodeId, setGotoNodeId] = useState('')
  const [gotoLoading, setGotoLoading] = useState(false)
  const [workflowNodes, setWorkflowNodes] = useState<any[]>([])
  const [expandedJob, setExpandedJob] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const [confirmState, setConfirmState] = useState<null | { title: string; description: string; action: () => Promise<void> | void }>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [moveRun, setMoveRun] = useState<{ workflowId: string; runId: string } | null>(null)
  const { can } = usePermissions()
  // Deleting / retrying queue items: workflows.activate (as the server checks), on items in scope.
  const canManageQueue = can('workflows.activate')
  const router = useRouter()
  const jobsApi = useJobs()
  const queryClient = useQueryClient()

  useEffect(() => {
    setLocalJobs(rows)
    // A new page or filter: keep only selections still on screen.
    setSelectedJobs((current) => new Set([...current].filter((id) => rows.some((r) => r.id === id))))
  }, [rows])

  function formatDateTime(iso: string | null) {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }

  function getSlaInfo(run: any) {
    if (!run?.sla_due_at) return null
    const dueAt = new Date(run.sla_due_at)
    const status = String(run.sla_status ?? 'on_track')
    const label = String(run.sla_label ?? '').trim() || 'SLA'
    const relative = formatRelative(run.sla_due_at)
    const dueText = relative.charAt(0).toLowerCase() + relative.slice(1)
    return { label, status, dueText, iso: dueAt.toISOString() }
  }

  function copyValue(label: string, value: string) {
    navigator.clipboard.writeText(value)
    setCopied(label)
    setTimeout(() => setCopied(null), 1500)
  }

  async function openGotoDialog(job: QueueItem) {
    setGotoJob(job)
    setGotoNodeId('')
    setWorkflowNodes([])
    // Fetch the workflow nodes
    try {
      // The nodes of the version the run executes (not the current draft).
      const versionId = job.run?.version_id ?? null
      const { data: definitionNodes } = await serverRead('automations.definitionNodes', { workflowId: job.workflow_id, versionId: versionId ?? undefined })
      if (definitionNodes) {
        const nodes = definitionNodes.filter((n: any) =>
          !['task_created', 'task_received', 'task_submitted', 'task_updated', 'task_completed', 'task_rejected', 'workflow_error', 'retention_policy_review', 'retention_policy_executed',
            'schedule', 'webhook_received', 'middleware_received', 'esign_event'].includes(n.type)
        )
        setWorkflowNodes(nodes)
      }
    } catch {}
  }

  async function handleGoto() {
    if (!gotoJob || !gotoNodeId) return
    setGotoLoading(true)
    try {
      const runId = gotoJob.result?.run_id
      const eventId = gotoJob.run?.event_id ?? gotoJob.result?.event_id
      if (!runId && !eventId) throw new Error('No run ID or event ID found')

      const resp = await fetch('/api/workflows/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resume',
          run_id: runId,
          event_id: eventId,
          goto_node_id: gotoNodeId,
        }),
      })
      const result = await resp.json()
      if (!resp.ok) {
        setNotice({ tone: 'error', message: `Failed: ${result.error}` })
        return
      }
      setGotoJob(null)
      refreshQueue()
    } catch (err: any) {
      setNotice({ tone: 'error', message: `Failed: ${err.message}` })
    }
    setGotoLoading(false)
  }

  /**
   * Delete one queue row (and its run + logs). Queue jobs go through the
   * deleteQueueJob server action (workflows.activate; a job a worker is
   * processing is refused); synthetic `run:` rows have no queue job. Returns
   * an error message, or null when the row is gone.
   */
  async function deleteJob(jobId: string, runId?: string): Promise<string | null> {
    setDeleting(jobId)
    try {
      if (!jobId.startsWith('run:')) {
        const result = await deleteQueueJob(jobId)
        if ('error' in result) return result.error
      }
      if (runId) {
        const resp = await fetch('/api/workflows/cleanup-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ run_id: runId }),
        })
        // 404: the run is already gone, which is what we wanted.
        if (!resp.ok && resp.status !== 404) {
          const body = await resp.json().catch(() => ({}))
          return `Job deleted, but its run could not be removed: ${body.error ?? resp.statusText}`
        }
      }
      setLocalJobs((current) => current.filter((job) => job.id !== jobId))
      setSelectedJobs((current) => {
        const next = new Set(current)
        next.delete(jobId)
        return next
      })
      return null
    } catch (err: any) {
      return err?.message ?? 'Could not delete the job.'
    } finally {
      setDeleting(null)
    }
  }

  function refreshQueue() {
    queryClient.invalidateQueries({ queryKey: ['workflow-queue'] })
    router.refresh()
  }

  async function handleDelete(jobId: string, runId?: string) {
    setConfirmState({
      title: 'Delete job',
      description: 'This will remove the job and all associated logs.',
      action: async () => {
        const error = await deleteJob(jobId, runId)
        refreshQueue()
        setNotice(error ? { tone: 'error', message: error } : { tone: 'success', message: 'Job deleted.' })
      },
    })
  }

  const paginated = localJobs
  const pageAllSelected = paginated.length > 0 && paginated.every((j) => selectedJobs.has(j.id))
  const runIdOf = (jobId: string) => localJobs.find((j) => j.id === jobId)?.result?.run_id ?? null

  /** The row's actions (table and phone card). */
  function renderActions(job: QueueItem) {
    const effectiveStatus = job.effective_status
    const runId = job.result?.run_id
    const eventId = job.run?.event_id ?? job.result?.event_id
    const wf = job.workflow
    return (
      <>
        {(effectiveStatus === 'waiting_for_event' || effectiveStatus === 'processing' || effectiveStatus === 'running') && runId && (
          <IconButton size="sm" label="Pause workflow" icon={<Pause />} onClick={() => setConfirmState({
            title: 'Pause workflow',
            description: 'Pause this workflow run?',
            action: async () => {
              await fetch('/api/workflows/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'pause', run_id: runId }) })
              refreshQueue()
              setNotice({ tone: 'success', message: 'Workflow paused.' })
            },
          })} />
        )}
        {effectiveStatus === 'paused' && (
          <IconButton size="sm" label="Resume workflow" icon={<Play />} onClick={async () => {
            await fetch('/api/workflows/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'resume', run_id: runId }) })
            refreshQueue()
          }} />
        )}
        {effectiveStatus === 'waiting_for_event' && (
          <IconButton size="sm" label="Skip wait and continue" icon={<SkipForward />} onClick={() => {
            if (!eventId) { setNotice({ tone: 'error', message: 'No event ID found' }); return }
            setConfirmState({
              title: 'Skip wait',
              description: 'Skip the current wait state and force the workflow to continue?',
              action: async () => {
                await fetch('/api/workflows/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'resume', event_id: eventId, run_id: runId }) })
                refreshQueue()
                setNotice({ tone: 'success', message: 'Workflow continued.' })
              },
            })
          }} />
        )}
        {(effectiveStatus === 'waiting_for_event' || effectiveStatus === 'paused') && (
          <IconButton size="sm" label="Go to activity" icon={<CornerDownRight />} onClick={() => openGotoDialog(job)} />
        )}
        {runId && (effectiveStatus === 'waiting_for_event' || effectiveStatus === 'paused') && can('workflows.manage_runs') && (
          <IconButton size="sm" label="Move to version…" icon={<MoveRight />} onClick={() => setMoveRun({ workflowId: job.workflow_id, runId })} />
        )}
        {runId && (
          <LinkIconButton href={`/automations/runs/${runId}`} label="Process view" icon={<Eye />} />
        )}
        {runId && (
          <LinkIconButton href={`/automations/runs/${runId}#logs`} label="View logs" icon={<FileText />} />
        )}
        {wf?.id && can('workflows.view') && (
          <LinkIconButton href={`/automations/${wf.id}`} label="Go to workflow designer" icon={<ExternalLink />} />
        )}
        {canManageQueue && (
          <IconButton
            size="sm"
            variant="danger-ghost"
            icon={<Trash2 />}
            onClick={() => handleDelete(job.id, runId)}
            disabled={deleting === job.id || (!job.synthetic_run && job.status === 'processing')}
            label={!job.synthetic_run && job.status === 'processing' ? 'A job that is being processed cannot be deleted' : 'Delete job and logs'}
          />
        )}
      </>
    )
  }

  function renderDetails(job: QueueItem, duration: string | null, sla: ReturnType<typeof getSlaInfo>) {
    const runId = job.result?.run_id
    const eventId = job.run?.event_id ?? job.result?.event_id
    const pausedNodeId = job.run?.paused_node_id
    const runTitle = job.run?.title
    const wf = job.workflow
    return (
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-md border border-border-subtle bg-subtle px-3 py-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
        {runTitle && <div className="col-span-full"><DetailField label="Title" value={runTitle} onCopy={copyValue} copied={copied} /></div>}
        {job.job_id && <DetailField label="Job ID" value={job.job_id} onCopy={copyValue} copied={copied} />}
        {runId && <DetailField label="Run ID" value={runId} onCopy={copyValue} copied={copied} />}
        {eventId && <DetailField label="Event ID" value={eventId} onCopy={copyValue} copied={copied} />}
        <DetailField label="Workflow ID" value={wf?.id ?? job.workflow_id} onCopy={copyValue} copied={copied} />
        <DetailField label="Submitted" value={formatDateTime(job.created_at)} onCopy={copyValue} copied={copied} />
        <DetailField label="Started" value={formatDateTime(job.started_at)} onCopy={copyValue} copied={copied} />
        {job.completed_at && <DetailField label="Completed" value={formatDateTime(job.completed_at)} onCopy={copyValue} copied={copied} />}
        {duration && <DetailField label="Duration" value={duration} onCopy={copyValue} copied={copied} />}
        {sla && <DetailField label="SLA" value={`${sla.label} · ${sla.status}`} onCopy={copyValue} copied={copied} />}
        {sla && <DetailField label="SLA due" value={formatDateTime(sla.iso)} onCopy={copyValue} copied={copied} />}
        <DetailField label="Trigger" value={job.trigger_type?.replace(/_/g, ' ') ?? '—'} onCopy={copyValue} copied={copied} />
        {job.trigger_data?.task_id && <DetailField label="Task ID" value={job.trigger_data.task_id} onCopy={copyValue} copied={copied} />}
        {pausedNodeId && <DetailField label="Paused at node" value={pausedNodeId} onCopy={copyValue} copied={copied} />}
        {job.error && <div className="col-span-full"><DetailField label="Error" value={job.error} onCopy={copyValue} copied={copied} /></div>}
        {job.step_label && <div className="col-span-full"><DetailField label="Current step" value={job.step_label} onCopy={copyValue} copied={copied} /></div>}
        {job.assignee && <DetailField label="Assignee" value={job.assignee.name || job.assignee.email || job.assignee.id} onCopy={copyValue} copied={copied} />}
        {job.started_by && <DetailField label="Started by" value={personName(job.started_by)} onCopy={copyValue} copied={copied} />}
        {job.run?.version_number != null && <DetailField label="Version" value={`v${job.run.version_number}`} onCopy={copyValue} copied={copied} />}
      </div>
    )
  }

  function rowFacts(job: QueueItem) {
    const durationMs = job.started_at && job.completed_at
      ? new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()
      : null
    return { duration: durationMs != null ? formatDurationMs(durationMs) : null, sla: getSlaInfo(job.run) }
  }

  function toggleSelected(id: string) {
    setSelectedJobs((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  return (
    <div className="space-y-3">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      {paginated.length > 0 && (
        <Checkbox
          checked={pageAllSelected}
          onChange={() => {
            const pageIds = paginated.map((j) => j.id)
            if (pageAllSelected) {
              const next = new Set(selectedJobs)
              pageIds.forEach((id) => next.delete(id))
              setSelectedJobs(next)
            } else {
              setSelectedJobs(new Set([...selectedJobs, ...pageIds]))
            }
          }}
          label={<span className="text-xs text-fg-muted">Select this page ({formatCount(paginated.length)})</span>}
        />
      )}

      {/* Bulk actions bar — at top */}
      {selectedJobs.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary bg-primary-wash px-3 py-2">
          <span className="num text-ui font-semibold text-primary-text">
            {formatCount(selectedJobs.size)} selected
          </span>
          <div className="flex-1" />
          <Button size="sm" variant="secondary" leadingIcon={<Pause />}
            onClick={() => setConfirmState({
              title: 'Pause workflows',
              description: `Pause ${plural(selectedJobs.size, 'selected workflow')}?`,
              action: async () => {
                // One `workflow_queue.bulk` job instead of one request per run.
                const items = [...selectedJobs].map((jobId) => ({ job_id: jobId, run_id: runIdOf(jobId) })).filter((item) => item.run_id)
                if (items.length === 0) return
                const outcome = await runInlineJob(jobsApi, 'workflow_queue.bulk', { action: 'pause', items }, { onSuccess: () => refreshQueue() })
                setSelectedJobs(new Set())
                if (outcome.status === 'failed') setNotice({ tone: 'error', message: outcome.error })
                else if (outcome.status === 'done') setNotice({ tone: outcome.counts.failed ? 'warning' : 'success', message: outcome.job.result?.summary ?? 'Selected workflows paused.' })
              },
            })}>
            Pause all
          </Button>
          <Button size="sm" variant="secondary" leadingIcon={<Play />}
            onClick={() => setConfirmState({
              title: 'Resume workflows',
              description: `Resume ${plural(selectedJobs.size, 'selected workflow')}?`,
              action: async () => {
                // One `workflow_queue.bulk` job instead of one request per run.
                const items = [...selectedJobs].map((jobId) => ({ job_id: jobId, run_id: runIdOf(jobId) })).filter((item) => item.run_id)
                if (items.length === 0) return
                const outcome = await runInlineJob(jobsApi, 'workflow_queue.bulk', { action: 'resume', items }, { onSuccess: () => refreshQueue() })
                setSelectedJobs(new Set())
                if (outcome.status === 'failed') setNotice({ tone: 'error', message: outcome.error })
                else if (outcome.status === 'done') setNotice({ tone: outcome.counts.failed ? 'warning' : 'success', message: outcome.job.result?.summary ?? 'Selected workflows resumed.' })
              },
            })}>
            Resume all
          </Button>
          {canManageQueue && <Button size="sm" variant="danger-ghost" leadingIcon={<Trash2 />}
            onClick={() => setConfirmState({
              title: 'Delete jobs',
              description: `Delete ${plural(selectedJobs.size, 'selected job')} and all related logs?`,
              action: async () => {
                // One `workflow_queue.bulk` job: deletes each queue job and its run + logs.
                const ids = [...selectedJobs]
                const items = ids.map((jobId) => ({ job_id: jobId, run_id: runIdOf(jobId) }))
                const outcome = await runInlineJob(jobsApi, 'workflow_queue.bulk', { action: 'delete', items }, { onSuccess: () => refreshQueue() })
                if (outcome.status === 'failed') { setNotice({ tone: 'error', message: outcome.error }); return }
                if (outcome.status === 'background') { setSelectedJobs(new Set()); return }
                const failed = outcome.counts.failed ?? 0
                if (failed < ids.length) setLocalJobs((current) => current.filter((job) => !ids.includes(job.id)))
                setSelectedJobs(new Set())
                setNotice({ tone: failed === 0 ? 'success' : 'warning', message: failed === 0 ? 'Selected jobs deleted.' : (outcome.job.result?.summary ?? `${failed} could not be deleted.`) })
              },
            })}>
            Delete all
          </Button>}
          <Button variant="ghost" size="sm" onClick={() => setSelectedJobs(new Set())}>Clear</Button>
        </div>
      )}

      {paginated.length === 0 ? empty : (
        <>
          {/* Desktop / tablet: the table. */}
          <Table containerClassName="max-md:hidden">
            <THead>
              <tr>
                <TH className="w-10"><span className="sr-only">Select</span></TH>
                <TH className="w-px">Status</TH>
                <TH>Workflow</TH>
                <TH className="max-xl:hidden">Started by</TH>
                <TH>Submitted</TH>
                <TH numeric className="max-xl:hidden">Duration</TH>
                <TH><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {paginated.map((job) => {
                const effectiveStatus = job.effective_status
                const wf = job.workflow
                const { duration, sla } = rowFacts(job)
                const isExpanded = expandedJob === job.id
                const runTitle = job.run?.title
                const isSelected = selectedJobs.has(job.id)
                return (
                  <Fragment key={job.id}>
                    <TR selected={isSelected} className={isExpanded ? 'border-b-0' : undefined}>
                      <TD className="w-10">
                        <Checkbox checked={isSelected} aria-label={`Select ${wf?.name ?? 'job'} ${job.id.slice(0, 8)}`} onChange={() => toggleSelected(job.id)} />
                      </TD>
                      <TD className="w-px whitespace-nowrap">
                        <StatusPill status={effectiveStatus} tone={effectiveStatus === 'dead' ? 'danger' : undefined} label={statusLabels[effectiveStatus] ?? undefined} />
                      </TD>
                      <TD className="min-w-48 max-w-0 py-2">
                        <button type="button" className="block w-full min-w-0 text-left" aria-expanded={isExpanded} onClick={() => setExpandedJob(isExpanded ? null : job.id)}>
                          <span className="block truncate text-ui font-medium text-fg">{wf?.name ?? 'Unknown'}</span>
                          {(runTitle || sla) && (
                            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden">
                              {runTitle && <Tag className="min-w-0 max-w-full truncate">{runTitle}</Tag>}
                              {sla && <span className="shrink-0"><SlaBadge sla={sla} /></span>}
                            </div>
                          )}
                          <RowSubline job={job} />
                        </button>
                      </TD>
                      <TD className="max-w-40 truncate text-ui text-fg-muted max-xl:hidden">{job.started_by ? personName(job.started_by) : '—'}</TD>
                      <TD className="whitespace-nowrap text-ui text-fg-muted">
                        <Tooltip content={formatAbsolute(job.created_at)}>
                          <span>{formatRelative(job.created_at)}</span>
                        </Tooltip>
                        <div className="text-2xs">{job.trigger_type ? humanize(job.trigger_type) : '—'}</div>
                      </TD>
                      <TD numeric className="whitespace-nowrap text-ui text-fg-muted max-xl:hidden">{duration ?? '—'}</TD>
                      <TD className="w-px whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-0.5">
                          {renderActions(job)}
                          <IconButton size="sm" label={isExpanded ? 'Collapse' : 'Details'} icon={isExpanded ? <ChevronUp /> : <ChevronDown />}
                            aria-expanded={isExpanded} onClick={() => setExpandedJob(isExpanded ? null : job.id)} />
                        </div>
                      </TD>
                    </TR>
                    {isExpanded && (
                      <tr className="border-b border-border-subtle last:border-b-0">
                        <td colSpan={7} className="px-3 pb-3">{renderDetails(job, duration, sla)}</td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </TBody>
          </Table>

          {/* Phones: one card per item. */}
          <ul className="space-y-2 md:hidden" aria-label="Queue items">
            {paginated.map((job) => {
              const effectiveStatus = job.effective_status
              const { duration, sla } = rowFacts(job)
              const isExpanded = expandedJob === job.id
              const isSelected = selectedJobs.has(job.id)
              return (
                <li key={job.id}>
                  <Card padding="sm" className={isSelected ? 'border-primary' : undefined}>
                    <div className="flex min-w-0 items-start gap-2">
                      <Checkbox checked={isSelected} aria-label={`Select ${job.workflow?.name ?? 'job'} ${job.id.slice(0, 8)}`} onChange={() => toggleSelected(job.id)} />
                      <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={isExpanded} onClick={() => setExpandedJob(isExpanded ? null : job.id)}>
                        <div className="flex min-w-0 items-center gap-2">
                          <StatusPill status={effectiveStatus} tone={effectiveStatus === 'dead' ? 'danger' : undefined} label={statusLabels[effectiveStatus] ?? undefined} />
                          <span className="ml-auto shrink-0 text-2xs text-fg-muted">{formatRelative(job.created_at)}</span>
                        </div>
                        <p className="mt-1 truncate text-ui font-medium text-fg">{job.workflow?.name ?? 'Unknown'}</p>
                        {job.run?.title && <p className="truncate text-xs text-fg-muted">{job.run.title}</p>}
                        {sla && <div className="mt-1"><SlaBadge sla={sla} /></div>}
                        <RowSubline job={job} />
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-0.5 border-t border-border-subtle pt-1.5">
                      {renderActions(job)}
                      <IconButton size="sm" label={isExpanded ? 'Collapse' : 'Details'} icon={isExpanded ? <ChevronUp /> : <ChevronDown />}
                        aria-expanded={isExpanded} onClick={() => setExpandedJob(isExpanded ? null : job.id)} />
                    </div>
                    {isExpanded && <div className="mt-2">{renderDetails(job, duration, sla)}</div>}
                  </Card>
                </li>
              )
            })}
          </ul>
        </>
      )}


      <ConfirmDialog
        open={Boolean(confirmState)}
        onOpenChange={(open) => { if (!open && !confirmBusy) setConfirmState(null) }}
        title={confirmState?.title ?? 'Confirm action'}
        description={confirmState?.description ?? ''}
        confirmLabel="Confirm"
        destructive={/delete/i.test(confirmState?.title ?? '')}
        busy={confirmBusy}
        onConfirm={async () => {
          if (!confirmState) return
          setConfirmBusy(true)
          try {
            await confirmState.action()
            setConfirmState(null)
          } catch (e: any) {
            setNotice({ tone: 'error', message: e?.message ?? 'Action failed' })
          } finally {
            setConfirmBusy(false)
          }
        }}
      />

      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} pageSizeOptions={QUEUE_PAGE_SIZES} noun="items" />

      {moveRun && (
        <MigrateInstancesWizard workflowId={moveRun.workflowId} runIds={[moveRun.runId]} onClose={() => setMoveRun(null)} onDone={() => refreshQueue()} />
      )}

      {/* Go To Activity Dialog */}
      <Dialog open={Boolean(gotoJob)} onOpenChange={(open) => { if (!open) setGotoJob(null) }}>
        <DialogContent
          size="sm"
          title="Go to activity"
          description="Resume this paused workflow from a different activity. The workflow will jump to the selected node and continue from there."
        >
          <DialogBody>
            <p className="mb-1.5 text-ui font-medium text-fg">Select activity</p>
            {workflowNodes.length === 0 ? (
              <p className="py-2 text-xs text-fg-muted">Loading nodes…</p>
            ) : (
              <div role="listbox" aria-label="Activities" className="max-h-[250px] divide-y divide-border-subtle overflow-y-auto rounded-md border border-border">
                {workflowNodes.map((node: any) => (
                  <button key={node.id} type="button"
                    role="option"
                    aria-selected={gotoNodeId === node.id}
                    onClick={() => setGotoNodeId(node.id)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-ui transition-colors hover:bg-subtle ${gotoNodeId === node.id ? 'bg-primary-wash' : ''}`}>
                    <span className={`size-2 shrink-0 rounded-full ${gotoNodeId === node.id ? 'bg-primary' : 'bg-fg-subtle'}`} aria-hidden="true" />
                    <span className="flex-1 font-medium text-fg">{node.label}</span>
                    <span className="font-mono text-2xs text-fg-muted">{node.type}</span>
                  </button>
                ))}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button size="sm" variant="secondary" onClick={() => setGotoJob(null)}>Cancel</Button>
            <Button size="sm" onClick={handleGoto} disabled={!gotoNodeId || gotoLoading} loading={gotoLoading} leadingIcon={gotoLoading ? undefined : <CornerDownRight />}>
              {gotoLoading ? 'Redirecting…' : 'Go to activity'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** An icon-only link styled as IconButton (aria-label + Tooltip). */
function LinkIconButton({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Tooltip content={label}>
      <Button asChild variant="ghost" size="icon-sm">
        <Link href={href} aria-label={label}>
          <span className="inline-flex [&>svg]:size-[var(--btn-icon)]" aria-hidden="true">{icon}</span>
        </Link>
      </Button>
    </Tooltip>
  )
}

function humanize(value: string): string {
  const s = value.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function DetailField({ label, value, onCopy, copied }: { label: string; value: string; onCopy: (label: string, value: string) => void; copied: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="shrink-0 font-medium text-fg-muted">{label}:</span>
      <span className="truncate font-mono text-fg">{value}</span>
      <IconButton size="sm" label={copied === label ? 'Copied' : `Copy ${label.toLowerCase()}`} icon={<Copy className={copied === label ? 'text-success' : undefined} />}
        onClick={() => onCopy(label, value)} className="size-6 shrink-0" />
    </div>
  )
}

function personName(p: { id: string; name: string | null; email: string | null }): string {
  return p.name || p.email || p.id.slice(0, 8)
}

function SlaBadge({ sla }: { sla: { label: string; status: string; dueText: string; iso: string } }) {
  return (
    <Tooltip content={`${sla.label} due ${formatAbsolute(sla.iso)}`}>
      <Badge tone={sla.status === 'breached' ? 'danger' : sla.status === 'warning' ? 'warning' : 'brand'} className="max-w-48">
        {sla.label}: {sla.status === 'breached' ? 'breached' : `due ${sla.dueText}`}
      </Badge>
    </Tooltip>
  )
}

/** The second line: the error, else the current step (and who has it), else the short id. */
function RowSubline({ job }: { job: QueueItem }) {
  if (job.error) return <div className="mt-0.5 truncate font-mono text-2xs text-danger">{job.error}</div>
  if (job.step_label && ['waiting_for_event', 'paused', 'running', 'processing'].includes(job.effective_status)) {
    return (
      <div className="mt-0.5 truncate text-2xs text-fg-muted">
        <span className="font-medium">At:</span> {job.step_label}
        {job.assignee && <> · {personName(job.assignee)}</>}
      </div>
    )
  }
  return <div className="mt-0.5 font-mono text-2xs text-fg-muted">{job.id.replace(/^run:/, '').slice(0, 8)}</div>
}
