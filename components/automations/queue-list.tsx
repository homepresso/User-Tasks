'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, FileText, Trash2, ExternalLink, CornerDownRight, Pause, Play, Copy, ChevronDown, ChevronUp, MoveRight, SkipForward, ArrowUp, ArrowDown } from 'lucide-react'
import dynamic from 'next/dynamic'
import { usePermissions } from '@/lib/permissions-context'
import { SearchBar, FilterChips, Pagination, useListControls } from '@/components/ui/list-controls'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Badge, CountBadge, StatusPill, Tag } from '@/components/ui/badge'
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from '@/components/ui/table'
import { Tooltip } from '@/components/ui/tooltip'
import { floatingSurfaceClass, menuItemClass } from '@/components/ui/dropdown-menu'
import { formatCount } from '@/lib/format/number'
import { formatDurationMs } from '@/lib/format/duration'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { plural } from '@/lib/format/plural'
import { deleteQueueJob } from '@/app/actions/workflow-queue'
import { runInlineJob, useJobs } from '@/components/jobs/jobs-provider'
import { serverRead } from '@/lib/server-read'

const MigrateInstancesWizard = dynamic(() => import('./live-instances').then((m) => m.MigrateInstancesWizard))

const statusLabels: Record<string, string> = { waiting_for_event: 'Awaiting action', completed: 'Completed', failed: 'Failed', pending: 'Pending', processing: 'Processing', dead: 'Dead', paused: 'Paused', migrated: 'Migrated' }
const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' }, { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' }, { value: 'waiting', label: 'Awaiting action' },
  { value: 'paused', label: 'Paused' }, { value: 'migrated', label: 'Migrated' }, { value: 'failed', label: 'Failed' }, { value: 'dead', label: 'Dead' },
]
const TRIGGER_OPTIONS = [
  { value: 'task_created', label: 'Task created' }, { value: 'task_updated', label: 'Task updated' },
  { value: 'task_completed', label: 'Task completed' }, { value: 'task_rejected', label: 'Task rejected' },
  { value: 'workflow_error', label: 'Workflow error' }, { value: 'retention_policy_review', label: 'Policy review' }, { value: 'retention_policy_executed', label: 'Policy executed' }, { value: 'webhook_received', label: 'Webhook' }, { value: 'esign_event', label: 'E-signature event' },
  { value: 'middleware_received', label: 'Middleware' },
]

type SortField = 'created_at' | 'started_at' | 'status'
type SortDir = 'asc' | 'desc'

interface QueueListProps {
  jobs: any[]
  runs?: Record<string, any> // run_id -> run record
}

export function QueueList({ jobs, runs }: QueueListProps) {
  const [localJobs, setLocalJobs] = useState(jobs)
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [triggerFilter, setTriggerFilter] = useState<string[]>([])
  const [workflowFilter, setWorkflowFilter] = useState('')
  const [workflowAutocompleteOpen, setWorkflowAutocompleteOpen] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set())
  const [gotoJob, setGotoJob] = useState<any>(null)
  const [gotoNodeId, setGotoNodeId] = useState('')
  const [gotoLoading, setGotoLoading] = useState(false)
  const [workflowNodes, setWorkflowNodes] = useState<any[]>([])
  const [expandedJob, setExpandedJob] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const [confirmState, setConfirmState] = useState<null | { title: string; description: string; action: () => Promise<void> | void }>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const workflowAutocompleteRef = useRef<HTMLDivElement | null>(null)
  const [moveRun, setMoveRun] = useState<{ workflowId: string; runId: string } | null>(null)
  const { can } = usePermissions()
  // Deleting / retrying queue items: workflows.activate (as the server checks), on items in scope.
  const canManageQueue = can('workflows.activate')
  const router = useRouter()
  const jobsApi = useJobs()
  const queryClient = useQueryClient()

  useEffect(() => {
    setLocalJobs(jobs)
  }, [jobs])

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

  async function openGotoDialog(job: any) {
    setGotoJob(job)
    setGotoNodeId('')
    setWorkflowNodes([])
    // Fetch the workflow nodes
    try {
      // The nodes of the version the run executes (not the current draft).
      const versionId = job.result?.run_id ? runs?.[job.result.run_id]?.version_id : null
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
      const eventId = (runId && runs?.[runId]?.event_id) ?? gotoJob.result?.event_id
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
      router.refresh()
    } catch (err: any) {
      setNotice({ tone: 'error', message: `Failed: ${err.message}` })
    }
    setGotoLoading(false)
  }

  // Determine the effective status for each job (check actual run status)
  function getEffectiveStatus(job: any): string {
    const runId = job.result?.run_id
    if (runId && runs?.[runId]) {
      // We have the live run status — use it
      const runStatus = runs[runId].status
      if (runStatus === 'waiting_for_event' || runStatus === 'paused') return runStatus
      return runStatus
    }
    // No live run data — use job status (don't trust stale result.status)
    return job.status
  }

  const workflowNames = [...new Set(
    localJobs
      .map((job) => String((job.workflow as any)?.name ?? '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b))

  const workflowSuggestions = useMemo(() => {
    const q = workflowFilter.trim().toLowerCase()
    const matches = !q
      ? workflowNames
      : workflowNames.filter((name) => name.toLowerCase().includes(q))
    return matches.slice(0, 8)
  }, [workflowFilter, workflowNames])

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!workflowAutocompleteRef.current?.contains(event.target as Node)) {
        setWorkflowAutocompleteOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  const filtered = localJobs.filter(job => {
    const effectiveStatus = getEffectiveStatus(job)
    const workflowName = String((job.workflow as any)?.name ?? '')
    if (statusFilter.length) {
      const match = statusFilter.some(f =>
        f === 'waiting' ? effectiveStatus === 'waiting_for_event'
          : f === 'paused' ? effectiveStatus === 'paused'
          : effectiveStatus === f || job.status === f
      )
      if (!match) return false
    }
    if (workflowFilter.trim() && !workflowName.toLowerCase().includes(workflowFilter.trim().toLowerCase())) return false
    if (triggerFilter.length && !triggerFilter.includes(job.trigger_type)) return false
    if (dateFrom && new Date(job.created_at) < new Date(dateFrom)) return false
    if (dateTo && new Date(job.created_at) > new Date(dateTo + 'T23:59:59')) return false
    return true
  })

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortField === 'created_at') return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    if (sortField === 'started_at') return dir * ((a.started_at ? new Date(a.started_at).getTime() : 0) - (b.started_at ? new Date(b.started_at).getTime() : 0))
    if (sortField === 'status') return dir * (getEffectiveStatus(a).localeCompare(getEffectiveStatus(b)))
    return 0
  })

  const { search, setSearch, page, setPage, pageSize, setPageSize, paginated, total } = useListControls(
    sorted,
    (job, q) => {
      const wf = (job.workflow as any)?.name ?? ''
      const title = (job.result?.run_id && runs?.[job.result.run_id]?.title) ?? ''
      return wf.toLowerCase().includes(q) || title.toLowerCase().includes(q) || (job.error ?? '').toLowerCase().includes(q) || (job.trigger_type ?? '').includes(q)
    },
    25,
  )

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
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

  const pageAllSelected = paginated.length > 0 && paginated.every((j: any) => selectedJobs.has(j.id))

  return (
    <div className="space-y-3">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <SearchBar value={search} onChange={setSearch} placeholder="Search jobs…" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Checkbox
            checked={pageAllSelected}
            onChange={() => {
              const pageIds = paginated.map((j: any) => j.id)
              const allSelected = pageIds.every((id: string) => selectedJobs.has(id))
              if (allSelected) {
                // Deselect only this page's items
                const next = new Set(selectedJobs)
                pageIds.forEach((id: string) => next.delete(id))
                setSelectedJobs(next)
              } else {
                // Add this page's items to selection
                setSelectedJobs(new Set([...selectedJobs, ...pageIds]))
              }
            }}
            label={<span className="text-xs text-fg-muted">Page ({formatCount(paginated.length)})</span>}
          />
          <Button variant="link" size="sm" onClick={() => setSelectedJobs(new Set(sorted.map((j: any) => j.id)))}>
            All {formatCount(sorted.length)}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <FilterChips label="Status" options={STATUS_OPTIONS} selected={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1) }} />
        <FilterChips label="Trigger" options={TRIGGER_OPTIONS} selected={triggerFilter} onChange={(v) => { setTriggerFilter(v); setPage(1) }} />
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 font-medium text-fg-muted">Workflow:</span>
          <div ref={workflowAutocompleteRef} className="relative w-full max-w-sm">
            <Input
              size="sm"
              value={workflowFilter}
              onChange={e => { setWorkflowFilter(e.target.value); setPage(1) }}
              onFocus={() => setWorkflowAutocompleteOpen(true)}
              placeholder="Search workflow names…"
              aria-label="Filter by workflow"
              className="pr-16"
            />
            <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1">
              {workflowFilter && <CountBadge count={workflowSuggestions.length} tone="brand" />}
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={`text-fg-muted transition-transform ${workflowAutocompleteOpen ? 'rotate-180' : ''}`}
              />
            </div>

            {workflowAutocompleteOpen && (
              <div className={`absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden ${floatingSurfaceClass}`}>
                {workflowSuggestions.length > 0 ? (
                  <div className="max-h-56 overflow-y-auto p-1">
                    {workflowSuggestions.map((name) => {
                      const isExact = name.toLowerCase() === workflowFilter.trim().toLowerCase()
                      return (
                        <button
                          key={name}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setWorkflowFilter(name)
                            setWorkflowAutocompleteOpen(false)
                            setPage(1)
                          }}
                          className={`${menuItemClass} w-full ${isExact ? 'bg-primary-wash' : ''}`}
                        >
                          <span className="truncate font-medium">{name}</span>
                          {isExact && <Badge tone="brand" className="ml-auto">Selected</Badge>}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="px-3 py-2.5 text-xs text-fg-muted">
                    No workflows match this search yet.
                  </div>
                )}
              </div>
            )}
          </div>
          {workflowFilter && (
            <Button variant="ghost" size="sm" onClick={() => { setWorkflowFilter(''); setWorkflowAutocompleteOpen(false); setPage(1) }}>
              Clear
            </Button>
          )}
        </div>

        {/* Date filters */}
        <div className="flex min-w-0 max-w-full items-center gap-2">
          <span className="font-medium text-fg-muted">Date:</span>
          <Input size="sm" type="date" aria-label="From date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }}
            className="w-36 min-w-0 shrink" />
          <span className="text-fg-muted">to</span>
          <Input size="sm" type="date" aria-label="To date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }}
            className="w-36 min-w-0 shrink" />
          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(''); setDateTo('') }}>Clear</Button>
          )}
        </div>

        {/* Sort controls */}
        <div className="flex items-center gap-1">
          <span className="mr-1 font-medium text-fg-muted">Sort by:</span>
          {[
            { field: 'created_at' as SortField, label: 'Created' },
            { field: 'started_at' as SortField, label: 'Started' },
            { field: 'status' as SortField, label: 'Status' },
          ].map(s => (
            <Button key={s.field} type="button" size="sm" variant={sortField === s.field ? 'secondary' : 'ghost'}
              aria-pressed={sortField === s.field}
              onClick={() => toggleSort(s.field)}
              trailingIcon={sortField === s.field ? (sortDir === 'asc' ? <ArrowUp /> : <ArrowDown />) : undefined}>
              {s.label}
            </Button>
          ))}
        </div>
      </div>

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
                const items = [...selectedJobs].map((jobId) => ({ job_id: jobId, run_id: jobs.find((j: any) => j.id === jobId)?.result?.run_id ?? null })).filter((item) => item.run_id)
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
                const items = [...selectedJobs].map((jobId) => ({ job_id: jobId, run_id: jobs.find((j: any) => j.id === jobId)?.result?.run_id ?? null })).filter((item) => item.run_id)
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
                const items = ids.map((jobId) => ({ job_id: jobId, run_id: jobs.find((j: any) => j.id === jobId)?.result?.run_id ?? null }))
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

      <Table>
        <THead>
          <tr>
            <TH className="w-10"><span className="sr-only">Select</span></TH>
            <TH className="w-px">Status</TH>
            <TH>Workflow</TH>
            <TH>Trigger</TH>
            <TH>Submitted</TH>
            <TH numeric>Duration</TH>
            <TH><span className="sr-only">Actions</span></TH>
          </tr>
        </THead>
        <TBody>
          {paginated.length === 0 ? (
            <TableEmpty colSpan={7} variant="no-results" title="No jobs match your filters" />
          ) : paginated.map((job: any) => {
            const effectiveStatus = getEffectiveStatus(job)
            const wf = job.workflow as any
            const durationMs = job.started_at && job.completed_at
              ? new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()
              : null
            const duration = durationMs != null ? formatDurationMs(durationMs) : null
            const runId = job.result?.run_id

            const isExpanded = expandedJob === job.id
            const eventId = (runId && runs?.[runId]?.event_id) ?? job.result?.event_id
            const pausedNodeId = runId && runs?.[runId]?.paused_node_id
            const runTitle = runId && runs?.[runId]?.title
            const sla = runId ? getSlaInfo(runs?.[runId]) : null
            const isSelected = selectedJobs.has(job.id)

            return (
              <Fragment key={job.id}>
                <TR selected={isSelected} className={isExpanded ? 'border-b-0' : undefined}>
                  <TD className="w-10">
                    <Checkbox checked={isSelected} aria-label={`Select ${wf?.name ?? 'job'} ${job.id.slice(0, 8)}`}
                      onChange={() => setSelectedJobs(prev => { const next = new Set(prev); next.has(job.id) ? next.delete(job.id) : next.add(job.id); return next })} />
                  </TD>
                  <TD className="w-px whitespace-nowrap">
                    <StatusPill status={effectiveStatus} tone={effectiveStatus === 'dead' ? 'danger' : undefined} label={statusLabels[effectiveStatus] ?? undefined} />
                  </TD>
                  <TD className="max-w-0 py-2">
                    <button type="button" className="block w-full min-w-0 text-left" aria-expanded={isExpanded} onClick={() => setExpandedJob(isExpanded ? null : job.id)}>
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-ui font-medium text-fg">{wf?.name ?? 'Unknown'}</span>
                        {runTitle && <Tag className="max-w-48 truncate">{runTitle}</Tag>}
                        {sla && (
                          <Tooltip content={`${sla.label} due ${formatAbsolute(sla.iso)}`}>
                            <Badge tone={sla.status === 'breached' ? 'danger' : sla.status === 'warning' ? 'warning' : 'brand'} className="max-w-48">
                              {sla.label}: {sla.status === 'breached' ? 'breached' : `due ${sla.dueText}`}
                            </Badge>
                          </Tooltip>
                        )}
                      </div>
                      {job.error ? (
                        <div className="mt-0.5 truncate font-mono text-2xs text-danger">{job.error}</div>
                      ) : (
                        <div className="mt-0.5 font-mono text-2xs text-fg-muted">{job.id.slice(0, 8)}</div>
                      )}
                    </button>
                  </TD>
                  <TD className="whitespace-nowrap text-ui text-fg-muted">{job.trigger_type ? humanize(job.trigger_type) : '—'}</TD>
                  <TD className="whitespace-nowrap text-ui text-fg-muted">
                    <Tooltip content={formatAbsolute(job.created_at)}>
                      <span>{formatRelative(job.created_at)}</span>
                    </Tooltip>
                  </TD>
                  <TD numeric className="whitespace-nowrap text-ui text-fg-muted">{duration ?? '—'}</TD>
                  <TD className="w-px whitespace-nowrap text-right">
                    {/* Actions */}
                    <div className="inline-flex items-center gap-0.5">
                      {(effectiveStatus === 'waiting_for_event' || effectiveStatus === 'processing') && (
                        <IconButton size="sm" label="Pause workflow" icon={<Pause />} onClick={() => setConfirmState({
                          title: 'Pause workflow',
                          description: 'Pause this workflow run?',
                          action: async () => {
                            await fetch('/api/workflows/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'pause', run_id: runId }) })
                            router.refresh()
                            setNotice({ tone: 'success', message: 'Workflow paused.' })
                          },
                        })} />
                      )}
                      {effectiveStatus === 'paused' && (
                        <IconButton size="sm" label="Resume workflow" icon={<Play />} onClick={async () => {
                          await fetch('/api/workflows/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'resume', run_id: runId }) })
                          router.refresh()
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
                              router.refresh()
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
                      <IconButton size="sm" label={isExpanded ? 'Collapse' : 'Details'} icon={isExpanded ? <ChevronUp /> : <ChevronDown />}
                        aria-expanded={isExpanded} onClick={() => setExpandedJob(isExpanded ? null : job.id)} />
                    </div>
                  </TD>
                </TR>

                {/* Expanded detail panel */}
                {isExpanded && (
                  <tr className="border-b border-border-subtle last:border-b-0">
                    <td colSpan={7} className="px-3 pb-3">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-border-subtle bg-subtle px-3 py-2 text-xs sm:grid-cols-3">
                        {runTitle && <div className="col-span-full"><DetailField label="Title" value={runTitle} onCopy={copyValue} copied={copied} /></div>}
                        <DetailField label="Job ID" value={job.id} onCopy={copyValue} copied={copied} />
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
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </TBody>
      </Table>

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

      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />

      {moveRun && (
        <MigrateInstancesWizard workflowId={moveRun.workflowId} runIds={[moveRun.runId]} onClose={() => setMoveRun(null)} onDone={() => router.refresh()} />
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
