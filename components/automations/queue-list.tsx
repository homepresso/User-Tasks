'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Clock, CheckCircle, XCircle, AlertTriangle, RefreshCw, Eye, FileText, Trash2, ExternalLink, ArrowUpDown, CornerDownRight, X, Loader2, Pause, Play, Copy, ChevronDown, ChevronUp, MoveRight } from 'lucide-react'
import dynamic from 'next/dynamic'
import { usePermissions } from '@/lib/permissions-context'
import { formatRelativeDate } from '@/lib/utils'
import { SearchBar, FilterChips, Pagination, useListControls } from '@/components/ui/list-controls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { deleteQueueJob } from '@/app/actions/workflow-queue'
import { runInlineJob, useJobs } from '@/components/jobs/jobs-provider'
import { serverRead } from '@/lib/server-read'

const MigrateInstancesWizard = dynamic(() => import('./live-instances').then((m) => m.MigrateInstancesWizard))

const statusIcons: Record<string, any> = { pending: Clock, processing: RefreshCw, completed: CheckCircle, failed: XCircle, dead: AlertTriangle, waiting_for_event: Clock, paused: Pause, migrated: CornerDownRight }
const statusColors: Record<string, string> = { pending: 'var(--status-todo)', processing: 'var(--status-info)', completed: 'var(--status-done)', failed: 'var(--status-progress)', dead: 'var(--status-blocked)', waiting_for_event: 'var(--status-progress)', paused: 'var(--status-todo)', migrated: 'var(--status-info)' }
const statusLabels: Record<string, string> = { waiting_for_event: 'Awaiting Action', completed: 'Completed', failed: 'Failed', pending: 'Pending', processing: 'Processing', dead: 'Dead', paused: 'Paused', migrated: 'Migrated' }
const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' }, { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' }, { value: 'waiting', label: 'Awaiting Action' },
  { value: 'paused', label: 'Paused' }, { value: 'migrated', label: 'Migrated' }, { value: 'failed', label: 'Failed' }, { value: 'dead', label: 'Dead' },
]
const TRIGGER_OPTIONS = [
  { value: 'task_created', label: 'Task Created' }, { value: 'task_updated', label: 'Task Updated' },
  { value: 'task_completed', label: 'Task Completed' }, { value: 'task_rejected', label: 'Task Rejected' },
  { value: 'workflow_error', label: 'Workflow Error' }, { value: 'retention_policy_review', label: 'Policy Review' }, { value: 'retention_policy_executed', label: 'Policy Executed' }, { value: 'webhook_received', label: 'Webhook' },
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
    const dueText = formatRelativeDate(run.sla_due_at)
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
            'schedule', 'webhook_received', 'middleware_received'].includes(n.type)
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
      title: 'Delete Job',
      description: 'This will remove the job and all associated logs.',
      action: async () => {
        const error = await deleteJob(jobId, runId)
        refreshQueue()
        setNotice(error ? { tone: 'error', message: error } : { tone: 'success', message: 'Job deleted.' })
      },
    })
  }

  return (
    <div className="space-y-3">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <SearchBar value={search} onChange={setSearch} placeholder="Search jobs..." />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-1.5 text-[10px] cursor-pointer" style={{ color: 'var(--theme-muted-text)' }}>
            <input type="checkbox"
              checked={paginated.length > 0 && paginated.every((j: any) => selectedJobs.has(j.id))}
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
              className="rounded" />
            Page ({paginated.length})
          </label>
          <button onClick={() => setSelectedJobs(new Set(sorted.map((j: any) => j.id)))}
            className="text-[10px] underline" style={{ color: 'var(--theme-primary-text)' }}>
            All {sorted.length}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <FilterChips label="Status" options={STATUS_OPTIONS} selected={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1) }} />
        <FilterChips label="Trigger" options={TRIGGER_OPTIONS} selected={triggerFilter} onChange={(v) => { setTriggerFilter(v); setPage(1) }} />
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span style={{ color: 'var(--theme-muted-text)' }}>Workflow:</span>
        <div ref={workflowAutocompleteRef} className="relative w-full max-w-sm">
          <Input
            value={workflowFilter}
            onChange={e => { setWorkflowFilter(e.target.value); setPage(1) }}
            onFocus={() => setWorkflowAutocompleteOpen(true)}
            placeholder="Search workflow names..."
            className="!text-xs !h-8 pr-16"
          />
          <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1">
            {workflowFilter && (
              <span className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                {workflowSuggestions.length}
              </span>
            )}
            <ChevronDown
              size={12}
              style={{ color: 'var(--theme-muted-text)' }}
              className={workflowAutocompleteOpen ? 'rotate-180 transition-transform' : 'transition-transform'}
            />
          </div>

          {workflowAutocompleteOpen && (
            <div
              className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border shadow-xl"
              style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
            >
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
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:opacity-90"
                        style={{
                          backgroundColor: isExact ? 'var(--theme-primary-light)' : 'transparent',
                          color: 'var(--theme-card-text)',
                        }}
                      >
                        <span className="truncate font-medium">{name}</span>
                        {isExact && (
                          <span className="ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                            style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }}>
                            Selected
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="px-3 py-2.5 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                  No workflows match this search yet.
                </div>
              )}
            </div>
          )}
        </div>
        {workflowFilter && (
          <button
            onClick={() => { setWorkflowFilter(''); setWorkflowAutocompleteOpen(false); setPage(1) }}
            className="text-[10px] underline"
            style={{ color: 'var(--theme-muted-text)' }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Date filters */}
      <div className="flex items-center gap-2 text-xs">
        <span style={{ color: 'var(--theme-muted-text)' }}>Date:</span>
        <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }}
          className="!text-xs !h-7 !w-32" />
        <span style={{ color: 'var(--theme-muted-text)' }}>to</span>
        <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }}
          className="!text-xs !h-7 !w-32" />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo('') }}
            className="text-[10px] underline" style={{ color: 'var(--theme-muted-text)' }}>Clear</button>
        )}
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
        <span>Sort by:</span>
        {[
          { field: 'created_at' as SortField, label: 'Created' },
          { field: 'started_at' as SortField, label: 'Started' },
          { field: 'status' as SortField, label: 'Status' },
        ].map(s => (
          <button key={s.field} onClick={() => toggleSort(s.field)}
            className="px-2 py-0.5 rounded transition-colors"
            style={{
              backgroundColor: sortField === s.field ? 'var(--theme-primary-light)' : 'transparent',
              color: sortField === s.field ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
            }}>
            {s.label} {sortField === s.field && (sortDir === 'asc' ? '↑' : '↓')}
          </button>
        ))}
      </div>

      {/* Bulk actions bar — at top */}
      {selectedJobs.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-4 py-2 rounded-lg" style={{ backgroundColor: 'var(--theme-primary-light)', border: '1px solid var(--theme-primary)' }}>
          <span className="text-xs font-semibold" style={{ color: 'var(--theme-primary-text)' }}>
            {selectedJobs.size} selected
          </span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" className="!text-[10px] !h-6"
            onClick={() => setConfirmState({
              title: 'Pause Workflows',
              description: `Pause ${selectedJobs.size} selected workflow${selectedJobs.size !== 1 ? 's' : ''}?`,
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
            <Pause size={10} className="mr-1" /> Pause All
          </Button>
          <Button size="sm" variant="outline" className="!text-[10px] !h-6"
            onClick={() => setConfirmState({
              title: 'Resume Workflows',
              description: `Resume ${selectedJobs.size} selected workflow${selectedJobs.size !== 1 ? 's' : ''}?`,
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
            <Play size={10} className="mr-1" /> Resume All
          </Button>
          <Button size="sm" variant="outline" className="!text-[10px] !h-6 !text-[color:var(--theme-danger)]"
            onClick={() => setConfirmState({
              title: 'Delete Jobs',
              description: `Delete ${selectedJobs.size} selected job${selectedJobs.size !== 1 ? 's' : ''} and all related logs?`,
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
            <Trash2 size={10} className="mr-1" /> Delete All
          </Button>
          <button onClick={() => setSelectedJobs(new Set())}
            className="text-[10px] underline ml-2" style={{ color: 'var(--theme-muted-text)' }}>Clear</button>
        </div>
      )}

      {paginated.length === 0 ? (
        <p className="text-sm py-4 text-center" style={{ color: 'var(--theme-muted-text)' }}>No jobs match your filters</p>
      ) : (
        <div className="space-y-1">
          {paginated.map((job: any) => {
            const effectiveStatus = getEffectiveStatus(job)
            const Icon = statusIcons[effectiveStatus] ?? Clock
            const color = statusColors[effectiveStatus] ?? 'var(--theme-muted-text)'
            const wf = job.workflow as any
            const duration = job.started_at && job.completed_at
              ? `${((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000).toFixed(1)}s`
              : null
            const runId = job.result?.run_id

            const isExpanded = expandedJob === job.id
            const eventId = (runId && runs?.[runId]?.event_id) ?? job.result?.event_id
            const pausedNodeId = runId && runs?.[runId]?.paused_node_id
            const runTitle = runId && runs?.[runId]?.title
            const sla = runId ? getSlaInfo(runs?.[runId]) : null

            return (
              <div key={job.id} className="rounded-lg overflow-hidden" style={{ backgroundColor: selectedJobs.has(job.id) ? 'var(--theme-primary-light)' : 'var(--theme-surface)' }}>
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <input type="checkbox" checked={selectedJobs.has(job.id)}
                    onChange={() => setSelectedJobs(prev => { const next = new Set(prev); next.has(job.id) ? next.delete(job.id) : next.add(job.id); return next })}
                    className="rounded shrink-0" />
                  <Icon size={14} style={{ color }} className={effectiveStatus === 'waiting_for_event' ? 'animate-pulse' : ''} />
                  <button className="flex-1 min-w-0 text-left" onClick={() => setExpandedJob(isExpanded ? null : job.id)}>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{wf?.name ?? 'Unknown'}</p>
                      {runTitle && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded truncate max-w-48"
                          style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                          {runTitle}
                        </span>
                      )}
                      {sla && (
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded truncate max-w-48"
                          style={{
                            backgroundColor:
                              sla.status === 'breached' ? 'var(--status-danger-bg)'
                                : sla.status === 'warning' ? 'var(--status-warning-bg)'
                                  : 'var(--theme-primary-light)',
                            color:
                              sla.status === 'breached' ? 'var(--theme-danger)'
                                : sla.status === 'warning' ? 'var(--theme-warning)'
                                  : 'var(--theme-primary-text)',
                          }}
                          title={`${sla.label} due ${sla.iso}`}
                        >
                          {sla.label}: {sla.status === 'breached' ? 'breached' : `due ${sla.dueText}`}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] flex-wrap" style={{ color: 'var(--theme-muted-text)' }}>
                      <span>{formatDateTime(job.created_at)}</span>
                      <span>·</span>
                      <span className="capitalize">{job.trigger_type?.replace(/_/g, ' ')}</span>
                      {duration && (<><span>·</span><span>{duration}</span></>)}
                      <span>·</span>
                      <span className="font-mono">{job.id.slice(0, 8)}</span>
                    </div>
                  </button>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${effectiveStatus === 'waiting_for_event' ? 'animate-pulse' : ''}`}
                    style={{ backgroundColor: `color-mix(in srgb, ${color} 8%, transparent)`, color }}>
                    {statusLabels[effectiveStatus] ?? effectiveStatus}
                  </span>
                  {job.error && (
                    <span className="text-[10px] truncate max-w-32 shrink-0" style={{ color: 'var(--theme-danger)' }} title={job.error}>
                      {job.error}
                    </span>
                  )}
                  {/* Actions */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    {(effectiveStatus === 'waiting_for_event' || effectiveStatus === 'processing') && (
                      <button onClick={() => setConfirmState({
                        title: 'Pause Workflow',
                        description: 'Pause this workflow run?',
                        action: async () => {
                          await fetch('/api/workflows/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'pause', run_id: runId }) })
                          router.refresh()
                          setNotice({ tone: 'success', message: 'Workflow paused.' })
                        },
                      })}
                        className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-chart-6-text)' }} title="Pause workflow">
                        <Pause size={14} />
                      </button>
                    )}
                    {effectiveStatus === 'paused' && (
                      <button onClick={async () => {
                        await fetch('/api/workflows/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'resume', run_id: runId }) })
                        router.refresh()
                      }}
                        className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-success)' }} title="Resume workflow">
                        <Play size={14} />
                      </button>
                    )}
                    {effectiveStatus === 'waiting_for_event' && (
                      <button onClick={() => {
                        if (!eventId) { setNotice({ tone: 'error', message: 'No event ID found' }); return }
                        setConfirmState({
                          title: 'Skip Wait',
                          description: 'Skip the current wait state and force the workflow to continue?',
                          action: async () => {
                            await fetch('/api/workflows/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'resume', event_id: eventId, run_id: runId }) })
                            router.refresh()
                            setNotice({ tone: 'success', message: 'Workflow continued.' })
                          },
                        })
                      }}
                        className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-success)' }} title="Skip wait and continue">
                        <Play size={14} />
                      </button>
                    )}
                    {(effectiveStatus === 'waiting_for_event' || effectiveStatus === 'paused') && (
                      <button onClick={() => openGotoDialog(job)}
                        className="p-1 rounded hover:opacity-70" style={{ color: 'var(--status-info)' }} title="Go To Activity">
                        <CornerDownRight size={14} />
                      </button>
                    )}
                    {runId && (effectiveStatus === 'waiting_for_event' || effectiveStatus === 'paused') && can('workflows.manage_runs') && (
                      <button onClick={() => setMoveRun({ workflowId: job.workflow_id, runId })}
                        className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-primary-text)' }} title="Move to version…">
                        <MoveRight size={14} />
                      </button>
                    )}
                    {runId && (
                      <Link href={`/automations/runs/${runId}`}
                        className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-primary-text)' }} title="Process view">
                        <Eye size={14} />
                      </Link>
                    )}
                    {runId && (
                      <Link href={`/automations/runs/${runId}#logs`}
                        className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }} title="View logs">
                        <FileText size={14} />
                      </Link>
                    )}
                    {wf?.id && (
                      <Link href={`/automations/${wf.id}`}
                        className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }} title="Go to workflow designer">
                        <ExternalLink size={14} />
                      </Link>
                    )}
                    <button
                      onClick={() => handleDelete(job.id, runId)}
                      disabled={deleting === job.id || (!job.synthetic_run && job.status === 'processing')}
                      className="p-1 rounded hover:text-[color:var(--theme-danger)] transition-colors disabled:opacity-30"
                      style={{ color: 'var(--theme-muted-text)' }}
                      title={!job.synthetic_run && job.status === 'processing' ? 'A job that is being processed cannot be deleted' : 'Delete job and logs'}
                    >
                      <Trash2 size={14} />
                    </button>
                    <button onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                      className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }} title={isExpanded ? 'Collapse' : 'Details'}>
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                </div>

                {/* Expanded detail panel */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-0">
                    <div className="rounded-lg px-3 py-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-[11px]"
                      style={{ backgroundColor: 'var(--theme-bg)', border: '1px solid var(--theme-surface-border)' }}>
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
                      {sla && <DetailField label="SLA Due" value={formatDateTime(sla.iso)} onCopy={copyValue} copied={copied} />}
                      <DetailField label="Trigger" value={job.trigger_type?.replace(/_/g, ' ') ?? '—'} onCopy={copyValue} copied={copied} />
                      {job.trigger_data?.task_id && <DetailField label="Task ID" value={job.trigger_data.task_id} onCopy={copyValue} copied={copied} />}
                      {pausedNodeId && <DetailField label="Paused At Node" value={pausedNodeId} onCopy={copyValue} copied={copied} />}
                      {job.error && <div className="col-span-full"><DetailField label="Error" value={job.error} onCopy={copyValue} copied={copied} /></div>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmState)}
        onOpenChange={(open) => { if (!open && !confirmBusy) setConfirmState(null) }}
        title={confirmState?.title ?? 'Confirm Action'}
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

      {/* Bulk actions bar removed from here — now above the job list */}

      {moveRun && (
        <MigrateInstancesWizard workflowId={moveRun.workflowId} runIds={[moveRun.runId]} onClose={() => setMoveRun(null)} onDone={() => router.refresh()} />
      )}

      {/* Go To Activity Dialog */}
      {gotoJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'var(--theme-overlay)' }}>
          <div className="w-full max-w-md max-h-[70vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
            <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
              <div className="flex items-center gap-2">
                <CornerDownRight size={14} style={{ color: 'var(--status-info)' }} />
                <span className="text-sm font-semibold">Go To Activity</span>
              </div>
              <button onClick={() => setGotoJob(null)} className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                Resume this paused workflow from a different activity. The workflow will jump to the selected node and continue from there.
              </p>
              <div>
                <label className="text-xs font-medium block mb-1">Select Activity</label>
                {workflowNodes.length === 0 ? (
                  <p className="text-xs py-2" style={{ color: 'var(--theme-muted-text)' }}>Loading nodes...</p>
                ) : (
                  <div className="max-h-[250px] overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--theme-surface-border)' }}>
                    {workflowNodes.map((node: any) => (
                      <button key={node.id} type="button"
                        onClick={() => setGotoNodeId(node.id)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:opacity-80 transition-colors"
                        style={{
                          backgroundColor: gotoNodeId === node.id ? 'var(--theme-primary-light)' : 'transparent',
                          borderBottom: '1px solid var(--theme-surface-border)',
                        }}>
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: gotoNodeId === node.id ? 'var(--theme-primary)' : 'var(--theme-muted-text)' }} />
                        <span className="font-medium flex-1">{node.label}</span>
                        <span className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>{node.type}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3" style={{ borderTop: '1px solid var(--theme-surface-border)' }}>
              <Button size="sm" variant="ghost" onClick={() => setGotoJob(null)}>Cancel</Button>
              <Button size="sm" onClick={handleGoto} disabled={!gotoNodeId || gotoLoading}>
                {gotoLoading ? <Loader2 size={14} className="mr-1 animate-spin" /> : <CornerDownRight size={14} className="mr-1" />}
                {gotoLoading ? 'Redirecting...' : 'Go To Activity'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailField({ label, value, onCopy, copied }: { label: string; value: string; onCopy: (label: string, value: string) => void; copied: string | null }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <span className="shrink-0 font-medium" style={{ color: 'var(--theme-muted-text)' }}>{label}:</span>
      <span className="truncate font-mono">{value}</span>
      <button onClick={() => onCopy(label, value)} className="shrink-0 p-0.5 rounded hover:opacity-70" style={{ color: copied === label ? 'var(--theme-success)' : 'var(--theme-muted-text)' }} title="Copy">
        <Copy size={10} />
      </button>
    </div>
  )
}
