'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Ban, BookOpen, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { InlineNotice } from '@/components/ui/inline-notice'
import { recoverProcessingJob, refreshProcessingStatus } from '@/app/actions/processing'
import type { ProcessingStatusView, StuckJob } from '@/lib/admin/processing-status'
import { AddonUpsellCard } from './addon-upsell-card'

/**
 * Settings → Infrastructure → Processing (instance admins): where queued work
 * runs (in the web app, or a processing provider's separate workers — the
 * paid Processing add-on shows its own status and page here; without it, an
 * upsell card says what it does and how to get it), queue health, and
 * processing jobs with Retry / Cancel when their worker was lost (lease
 * expired) and Force-cancel, after confirmation, when it is still alive.
 */

const muted = { color: 'var(--theme-muted-text)' }
const card = { backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }

function age(seconds: number): string {
  if (seconds < 90) return `${seconds} s`
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`
  return `${Math.round(seconds / 3600)} h`
}

export function ProcessingCard({ initial }: { initial: ProcessingStatusView }) {
  const [status, setStatus] = useState(initial)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null)
  const [confirm, setConfirm] = useState<{ job: StuckJob; action: 'retry' | 'cancel' } | null>(null)
  const [pending, startTransition] = useTransition()

  const refresh = () => startTransition(async () => {
    const result = await refreshProcessingStatus()
    if (result.ok) setStatus(result.status)
    else setNotice({ tone: 'danger', message: result.error })
  })

  const run = (job: StuckJob, action: 'retry' | 'cancel') => startTransition(async () => {
    const result = await recoverProcessingJob(job.id, action, action === 'cancel' && !job.stuck)
    setConfirm(null)
    setNotice(result.ok
      ? { tone: 'success', message: action === 'retry' ? 'Job queued again.' : 'Job cancelled.' }
      : { tone: 'danger', message: result.error })
    const next = await refreshProcessingStatus()
    if (next.ok) setStatus(next.status)
  })

  const q = status.queue
  const stuck = status.jobs.filter((j) => j.stuck)
  return (
    <section className="rounded-xl border p-4 space-y-3" style={card} aria-label="Processing" data-processing-card>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold mr-1">Processing</h2>
        <span className="text-sm">{status.provider?.label ?? (status.mode === 'queue' ? 'Separate workers' : 'In the web app')}</span>
        <span className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={refresh} disabled={pending}><RefreshCw size={14} /> Refresh</Button>
        </span>
      </div>
      <p className="text-xs" style={muted}>
        {status.mode === 'queue'
          ? 'The web app only queues work; separate processing workers claim and run it.'
          : 'The web app runs workflow, agent and media work itself (it calls its own processing endpoints after work is queued).'}
        {' '}Jobs whose worker stops (crash, out of memory, timeout) are recovered automatically when their lease expires.{' '}
        <Link href={status.docs_href} className="underline inline-flex items-center gap-1"><BookOpen size={12} /> Processing docs</Link>
      </p>
      {status.provider ? (
        <div className="text-sm space-y-1">
          {(status.provider.details ?? []).map((line) => <p key={line} style={muted}>{line}</p>)}
          {status.provider.href && <Link href={status.provider.href} className="underline text-sm">Processing settings and workers</Link>}
        </div>
      ) : (
        <AddonUpsellCard kind="processing" />
      )}
      {notice && <InlineNotice tone={notice.tone}>{notice.message}</InlineNotice>}
      {q ? (
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm" data-queue-health>
          <div><dt className="text-xs" style={muted}>Waiting</dt><dd>{q.due}</dd></div>
          <div><dt className="text-xs" style={muted}>Oldest waiting</dt><dd>{q.due ? age(q.oldest_due_seconds) : '—'}</dd></div>
          <div><dt className="text-xs" style={muted}>Processing</dt><dd>{q.processing}</dd></div>
          <div><dt className="text-xs" style={muted}>Stuck (worker lost)</dt><dd className={q.stuck ? 'text-danger' : undefined}>{q.stuck}</dd></div>
          <div><dt className="text-xs" style={muted}>Retrying / failed 24 h</dt><dd>{q.retrying} / {q.dead_24h}</dd></div>
        </dl>
      ) : (
        <p className="text-xs" style={muted}>Queue health needs migration 20270124090000_queue_leases.sql.</p>
      )}
      {status.jobs.length > 0 && (
        <ul className="divide-y text-sm" style={{ borderColor: 'var(--theme-surface-border)' }} data-processing-jobs>
          {status.jobs.map((job) => (
            <li key={job.id} className="py-2 flex flex-wrap items-center gap-2">
              <span className="font-medium">{job.workflow_name ?? job.workflow_id}</span>
              <code className="text-xs" style={muted}>{job.id.slice(0, 8)}</code>
              <span className={job.stuck ? 'text-xs text-danger' : 'text-xs'} style={job.stuck ? undefined : muted}>
                {job.stuck ? `Stuck — worker ${job.locked_by ?? 'unknown'} lost` : `Running on ${job.locked_by ?? 'a worker'}`}
                {' '}· attempt {job.attempts} of {job.max_attempts}
              </span>
              <span className="ml-auto flex gap-1">
                {job.stuck && <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirm({ job, action: 'retry' })}><RotateCcw size={14} /> Retry</Button>}
                <Button size="sm" variant="danger-ghost" disabled={pending} onClick={() => setConfirm({ job, action: 'cancel' })}><Ban size={14} /> {job.stuck ? 'Cancel' : 'Force-cancel'}</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {stuck.length === 0 && status.jobs.length === 0 && <p className="text-xs" style={muted}>Nothing is being processed right now.</p>}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => { if (!open) setConfirm(null) }}
        title={confirm?.action === 'retry' ? 'Retry stuck job' : confirm?.job.stuck ? 'Cancel stuck job' : 'Force-cancel job'}
        description={confirm?.action === 'retry'
          ? 'The worker running this job stopped. Retry queues it again; its unfinished run continues after the last completed step, or is closed as interrupted.'
          : confirm?.job.stuck
            ? 'The worker running this job stopped. Cancel marks the job cancelled and its unfinished run failed.'
            : 'A worker is still processing this job. Force-cancelling marks it cancelled and its run failed; the worker may still finish the step it is on, but its result is discarded.'}
        confirmLabel={confirm?.action === 'retry' ? 'Retry' : confirm?.job.stuck ? 'Cancel job' : 'Force-cancel'}
        destructive={confirm?.action === 'cancel'}
        busy={pending}
        onConfirm={() => { if (confirm) run(confirm.job, confirm.action) }}
      />
    </section>
  )
}
