'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Ban, CheckCircle2, Clock, Download, Layers, Loader2, RotateCcw, XCircle } from 'lucide-react'
import { listMyJobsAction } from '@/app/actions/user-jobs'
import { unwrapAction } from '@/lib/action-result'
import { usePermissions } from '@/lib/permissions-context'
import { formatRelativeDate } from '@/lib/utils'
import { isActiveJobStatus, type UserJobView } from '@/lib/user-jobs/types'
import { downloadJobFile, formatBytes, useJobs } from './jobs-provider'

/**
 * Top-bar Jobs indicator: a spinner and count while jobs run, and a panel of
 * recent jobs with progress, Cancel, Retry and Download. Workspace admins
 * (settings.edit) can switch to every job of the workspace.
 */

const STATUS_STYLE: Record<UserJobView['status'], { label: string; color: string; Icon: typeof Clock }> = {
  queued: { label: 'Queued', color: 'var(--theme-muted-text)', Icon: Clock },
  running: { label: 'Running', color: 'var(--theme-primary-text)', Icon: Loader2 },
  succeeded: { label: 'Done', color: 'var(--theme-success)', Icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'var(--theme-danger)', Icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'var(--theme-muted-text)', Icon: Ban },
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
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setPanelOpen(!panelOpen)}
        className="relative flex items-center gap-1.5 rounded-lg p-2 transition-colors hover:opacity-80"
        style={{ color: 'var(--theme-topbar-text)' }}
        aria-label={activeCount ? `${activeCount} background job${activeCount === 1 ? '' : 's'} running` : 'Background jobs'}
        aria-expanded={panelOpen}
        data-testid="jobs-indicator"
      >
        {activeCount > 0 ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Layers size={18} aria-hidden />}
        {activeCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }}>
            {activeCount > 9 ? '9+' : activeCount}
          </span>
        )}
      </button>

      {panelOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          className="fixed w-[min(26rem,calc(100vw-1rem))] overflow-hidden rounded-xl border shadow-xl"
          style={{ top: position.top, right: position.right, zIndex: 1000, backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
          role="dialog"
          aria-label="Background jobs"
          data-testid="jobs-panel"
        >
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <h3 className="text-sm font-semibold">Background jobs</h3>
            {can('settings.edit') && (
              <div className="flex gap-1 text-[11px]">
                {(['mine', 'tenant'] as const).map((value) => (
                  <button key={value} type="button" onClick={() => setScope(value)} className="rounded-md px-2 py-0.5 font-medium"
                    style={{ backgroundColor: scope === value ? 'var(--theme-primary-light)' : 'transparent', color: scope === value ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}>
                    {value === 'mine' ? 'Mine' : 'Workspace'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="max-h-[480px] overflow-y-auto divide-y" style={{ borderColor: 'var(--theme-surface-border)' }}>
            {list.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--theme-muted-text)' }}>
                {scope === 'tenant' && tenantJobs.isLoading ? 'Loading…' : 'No background jobs yet. Exports, imports and bulk actions show up here.'}
              </p>
            ) : list.map((job) => (
              <JobRow key={job.id} job={job} mine={scope === 'mine'} onCancel={() => void cancel(job.id)} onRetry={() => void retry(job.id)} />
            ))}
          </div>
          <p className="border-t px-4 py-2 text-[10px]" style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}>
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
    <div className="px-4 py-3" style={{ borderColor: 'var(--theme-surface-border)' }} data-testid="jobs-panel-row" data-status={job.status}>
      <div className="flex items-start gap-2">
        <style.Icon size={14} className={`mt-0.5 shrink-0 ${job.status === 'running' ? 'animate-spin' : ''}`} style={{ color: style.color }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={job.title}>{job.title}</p>
          <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
            <span style={{ color: style.color }}>{style.label}</span>
            {' · '}{formatRelativeDate(job.created_at)}
            {job.result?.file ? ` · ${formatBytes(job.result.file.size)}` : ''}
          </p>
          {detail && <p className="mt-0.5 line-clamp-2 text-xs" style={{ color: job.status === 'failed' ? 'var(--theme-danger)' : 'var(--theme-muted-text)' }}>{detail}</p>}
          {active && (
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'var(--theme-surface-border)' }}>
              <div className={`h-full rounded-full transition-all ${job.status === 'queued' || job.progress === 0 ? 'w-1/4 animate-pulse' : ''}`} style={{ width: job.progress > 0 ? `${job.progress}%` : undefined, backgroundColor: 'var(--theme-primary)' }} />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {mine && job.downloadable && (
            <button type="button" onClick={() => downloadJobFile(job)} className="rounded-md p-1.5 hover:opacity-80" style={{ color: 'var(--theme-primary-text)' }} title="Download" aria-label={`Download ${job.result?.file?.filename ?? 'file'}`} data-testid="jobs-panel-download">
              <Download size={14} />
            </button>
          )}
          {mine && job.retryable && (
            <button type="button" onClick={onRetry} className="rounded-md p-1.5 hover:opacity-80" title="Retry" aria-label="Retry" data-testid="jobs-panel-retry"><RotateCcw size={14} /></button>
          )}
          {job.cancellable && (
            <button type="button" onClick={onCancel} className="rounded-md p-1.5 hover:opacity-80" style={{ color: 'var(--theme-danger)' }} title="Cancel" aria-label="Cancel" data-testid="jobs-panel-cancel"><Ban size={14} /></button>
          )}
        </div>
      </div>
    </div>
  )
}
