'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Ban, CheckCircle2, Clock, Download, Layers, Loader2, RotateCcw, XCircle } from 'lucide-react'
import { listMyJobsAction } from '@/app/actions/user-jobs'
import { unwrapAction } from '@/lib/action-result'
import { usePermissions } from '@/lib/permissions-context'
import { cn } from '@/lib/utils'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { plural } from '@/lib/format/plural'
import { CountBadge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { ProgressBar } from '@/components/ui/progress-bar'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip } from '@/components/ui/tooltip'
import { floatingSurfaceClass } from '@/components/ui/dropdown-menu'
import { isActiveJobStatus, type UserJobView } from '@/lib/user-jobs/types'
import { downloadJobFile, formatBytes, useJobs } from './jobs-provider'

/**
 * Top-bar Jobs indicator: a spinner and count while jobs run, and a panel of
 * recent jobs with progress, Cancel, Retry and Download. Workspace admins
 * (settings.edit) can switch to every job of the workspace.
 */

const STATUS_STYLE: Record<UserJobView['status'], { label: string; text: string; Icon: typeof Clock }> = {
  queued: { label: 'Queued', text: 'text-fg-muted', Icon: Clock },
  running: { label: 'Running', text: 'text-info', Icon: Loader2 },
  succeeded: { label: 'Done', text: 'text-success', Icon: CheckCircle2 },
  failed: { label: 'Failed', text: 'text-danger', Icon: XCircle },
  cancelled: { label: 'Cancelled', text: 'text-fg-muted', Icon: Ban },
}

export function JobsIndicator() {
  const { jobs, activeCount, panelOpen, setPanelOpen, cancel, retry } = useJobs()
  const { can } = usePermissions()
  const [scope, setScope] = useState<'mine' | 'tenant'>('mine')
  const [position, setPosition] = useState({ top: 0, right: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const tenantJobs = useQuery({
    queryKey: ['user-jobs', 'tenant'],
    queryFn: async () => unwrapAction(await listMyJobsAction({ scope: 'tenant', limit: 50 })),
    enabled: panelOpen && scope === 'tenant',
    refetchInterval: panelOpen && scope === 'tenant' ? 5_000 : false,
  })

  useLayoutEffect(() => {
    if (!panelOpen || !buttonRef.current) return
    const update = () => {
      const rect = buttonRef.current!.getBoundingClientRect()
      setPosition({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [panelOpen])

  useEffect(() => {
    if (!panelOpen) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setPanelOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPanelOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [panelOpen, setPanelOpen])

  const list = scope === 'tenant' ? tenantJobs.data ?? [] : jobs
  // Nothing has ever run: keep the top bar quiet.
  if (jobs.length === 0 && !panelOpen) return null

  return (
    <div className="relative">
      <Tooltip content="Background jobs" enabled={!panelOpen}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setPanelOpen(!panelOpen)}
          className="relative inline-flex size-8 items-center justify-center rounded-md text-fg-muted transition-colors duration-[var(--ds-dur-fast)] hover:bg-subtle hover:text-fg aria-expanded:bg-subtle aria-expanded:text-fg"
          aria-label={activeCount ? `Background jobs, ${plural(activeCount, 'job')} running` : 'Background jobs'}
          aria-expanded={panelOpen}
          aria-haspopup="dialog"
          data-testid="jobs-indicator"
        >
          {activeCount > 0 ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Layers className="size-4" aria-hidden />}
          {activeCount > 0 && (
            <CountBadge count={activeCount} max={9} tone="brand" aria-hidden className="absolute -right-1 -top-1 h-4 min-w-4 px-0.5" />
          )}
        </button>
      </Tooltip>

      {panelOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          className={cn('ds-pop fixed z-[1000] flex max-h-[min(560px,calc(100vh-80px))] w-[min(400px,calc(100vw-16px))] flex-col overflow-hidden', floatingSurfaceClass)}
          data-state="open"
          style={{ top: position.top, right: position.right }}
          role="dialog"
          aria-label="Background jobs"
          data-testid="jobs-panel"
        >
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border-subtle pl-4 pr-2">
            <h2 className="text-sm font-semibold text-fg">Background jobs</h2>
            {can('settings.edit') && (
              <SegmentedControl aria-label="Whose jobs" size="sm" value={scope} onValueChange={(v) => setScope(v as 'mine' | 'tenant')}
                options={[{ value: 'mine', text: 'Mine' }, { value: 'tenant', text: 'Workspace' }]} />
            )}
          </div>
          <div className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto scrollbar-thin">
            {list.length === 0 ? (
              scope === 'tenant' && tenantJobs.isLoading
                ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
                : <EmptyState size="sm" icon={Layers} title="No background jobs yet" description="Exports, imports and bulk actions show up here." />
            ) : list.map((job) => (
              <JobRow key={job.id} job={job} mine={scope === 'mine'} onCancel={() => void cancel(job.id)} onRetry={() => void retry(job.id)} />
            ))}
          </div>
          <p className="shrink-0 border-t border-border-subtle px-4 py-2 text-2xs text-fg-muted">
            Finished jobs and their files are kept for 7 days.
          </p>
        </div>,
        document.body,
      )}
    </div>
  )
}

function JobRow({ job, mine, onCancel, onRetry }: { job: UserJobView; mine: boolean; onCancel: () => void; onRetry: () => void }) {
  const style = STATUS_STYLE[job.status]
  const active = isActiveJobStatus(job.status)
  const detail = job.status === 'failed' ? job.error : job.status === 'succeeded' ? job.result?.summary : job.message
  return (
    <div className="px-4 py-3" data-testid="jobs-panel-row" data-status={job.status}>
      <div className="flex items-start gap-2.5">
        <style.Icon className={cn('mt-0.5 size-4 shrink-0', style.text, job.status === 'running' && 'animate-spin')} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui font-medium text-fg">{job.title}</p>
          <p className="text-xs text-fg-muted">
            <span className={style.text}>{style.label}</span>
            {' · '}<Tooltip content={formatAbsolute(job.created_at)}><time dateTime={job.created_at}>{formatRelative(job.created_at)}</time></Tooltip>
            {job.result?.file ? <span className="num">{` · ${formatBytes(job.result.file.size)}`}</span> : ''}
          </p>
          {detail && <p className={cn('mt-0.5 line-clamp-2 text-xs', job.status === 'failed' ? 'text-danger' : 'text-fg-muted')}>{detail}</p>}
          {active && (
            job.progress > 0
              ? <ProgressBar className="mt-1.5" size="sm" value={job.progress} label={`${job.title} progress`} />
              : <Skeleton className="mt-1.5 h-1 w-full rounded-full" aria-label="Waiting to start" />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {mine && job.downloadable && (
            <IconButton size="sm" icon={<Download />} label={`Download ${job.result?.file?.filename ?? 'file'}`} onClick={() => downloadJobFile(job)} data-testid="jobs-panel-download" />
          )}
          {mine && job.retryable && (
            <IconButton size="sm" icon={<RotateCcw />} label="Retry" onClick={onRetry} data-testid="jobs-panel-retry" />
          )}
          {job.cancellable && (
            <IconButton size="sm" variant="danger-ghost" icon={<Ban />} label="Cancel" onClick={onCancel} data-testid="jobs-panel-cancel" />
          )}
        </div>
      </div>
    </div>
  )
}
