'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Ban, BookOpen, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { InlineNotice } from '@/components/ui/inline-notice'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { configureProcessingSettings, recoverProcessingJob, refreshProcessingStatus } from '@/app/actions/processing'
import type { ProcessingStatusView, StuckJob } from '@/lib/admin/processing-status'
import type { ProcessingSettingsView, ProcessingWorkerSummary } from '@/lib/extensions/sdk'
import { AddonUpsellCard } from './addon-upsell-card'

/**
 * Settings → Infrastructure → Processing (instance admins): where queued work
 * runs (in the web app, or a processing provider's separate workers — the
 * paid Processing add-on shows its own status and page here; without it, an
 * upsell card says what it does and how to get it; licensed, the add-on's
 * switches — mode and designer test runs on workers — and its workers show
 * here, changed through configureProcessingSettings), queue health, and
 * processing jobs with Retry / Cancel when their worker was lost (lease
 * expired) and Force-cancel, after confirmation, when it is still alive.
 */

const muted = { color: 'var(--theme-muted-text)' }
const card = { backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }

function mib(bytes: number | null): string {
  return bytes == null ? '—' : `${Math.round(bytes / 1048576)} MiB`
}

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}

function ProcessingSwitches({ settings, pending, onChange }: {
  settings: ProcessingSettingsView
  pending: boolean
  onChange: (changes: { mode?: 'web' | 'workers'; test_runs_on_workers?: boolean }) => void
}) {
  return (
    <div className="space-y-2" data-processing-switches>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium mr-1">Mode</span>
        <SegmentedControl
          size="sm"
          aria-label="Processing mode"
          value={settings.mode}
          onValueChange={(mode) => { if (mode !== settings.mode) onChange({ mode }) }}
          options={[
            { value: 'web', text: 'In the web app', disabled: pending || settings.locked.mode },
            { value: 'workers', text: 'Separate workers', disabled: pending || settings.locked.mode || (settings.mode !== 'workers' && settings.can_use_workers === false) },
          ]}
        />
        {settings.locked.mode && <span className="text-xs" style={muted}>Set by PROCESSING_MODE in the server environment.</span>}
        {!settings.locked.mode && settings.mode !== 'workers' && settings.can_use_workers === false && (
          <span className="text-xs" style={muted}>Start a worker first (node worker.cjs --processor); it can be chosen once one reports.</span>
        )}
      </div>
      <Switch
        size="sm"
        checked={settings.test_runs_on_workers}
        disabled={pending || settings.locked.test_runs_on_workers}
        onCheckedChange={(on) => onChange({ test_runs_on_workers: on })}
        label={<span className="text-sm">Designer test runs on workers{settings.locked.test_runs_on_workers ? ' (set by PROCESSING_TEST_RUNS_ON_WORKERS)' : ''}</span>}
      />
      <p className="text-xs" style={muted}>Off: test runs stay in the web app for the quickest feedback. On (with separate workers): they run on the workers like production, with their steps streamed back to the designer.</p>
    </div>
  )
}

function WorkerList({ workers }: { workers: ProcessingWorkerSummary[] }) {
  if (!workers.length) return <p className="text-xs" style={muted}>No worker has reported yet. Run one with <code>node worker.cjs --processor</code> (Docker Compose: the processing profile; Helm: the processor chart).</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-processing-workers>
        <thead>
          <tr className="text-left text-xs" style={muted}>
            <th className="py-1 pr-3 font-normal">Worker</th><th className="py-1 pr-3 font-normal">State</th><th className="py-1 pr-3 font-normal">Version</th>
            <th className="py-1 pr-3 font-normal">Queues</th><th className="py-1 pr-3 font-normal">Running</th><th className="py-1 pr-3 font-normal">Jobs/min</th>
            <th className="py-1 pr-3 font-normal">Memory</th><th className="py-1 font-normal">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((w) => (
            <tr key={w.id} className="border-t" style={{ borderColor: 'var(--theme-surface-border)' }}>
              <td className="py-1 pr-3"><span title={w.id}>{w.hostname ?? w.id}</span></td>
              <td className="py-1 pr-3">
                <span className={w.online && w.state === 'running' ? 'text-success' : w.online ? 'text-warning' : undefined} style={w.online ? undefined : muted}>{w.online ? w.state : 'offline'}</span>
                {w.note && <div className="text-xs" style={muted}>{w.note}</div>}
              </td>
              <td className="py-1 pr-3">{w.version ?? '—'}</td>
              <td className="py-1 pr-3">{w.queues.join(', ')}</td>
              <td className="py-1 pr-3">{w.jobs_running} / {w.concurrency}</td>
              <td className="py-1 pr-3">{w.jobs_per_minute}</td>
              <td className="py-1 pr-3">{mib(w.rss_bytes)}</td>
              <td className="py-1">{ago(w.last_seen)}{w.listening ? '' : ' · polling'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function age(seconds: number): string {
  if (seconds < 90) return `${seconds} s`
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`
  return `${Math.round(seconds / 3600)} h`
}

export function ProcessingCard({ initial }: { initial: ProcessingStatusView }) {
  const [status, setStatus] = useState(initial)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null)
  const [confirm, setConfirm] = useState<{ job: StuckJob; action: 'retry' | 'cancel' } | null>(null)
  const [modeConfirm, setModeConfirm] = useState<'web' | 'workers' | null>(null)
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

  const configure = (changes: { mode?: 'web' | 'workers'; test_runs_on_workers?: boolean }) => startTransition(async () => {
    const result = await configureProcessingSettings(changes)
    if (result.ok) {
      setStatus(result.status)
      setNotice({
        tone: 'success',
        message: changes.mode === 'workers'
          ? 'Processing now runs on the separate workers; the web app only queues work.'
          : changes.mode === 'web'
            ? 'Processing runs in the web app again.'
            : changes.test_runs_on_workers ? 'Designer test runs now run on the workers (in separate-workers mode).' : 'Designer test runs now run in the web app.',
      })
    } else {
      setNotice({ tone: 'danger', message: result.error })
    }
  })

  const q = status.queue
  const addon = status.addon ?? { state: status.provider ? 'ready' : 'missing', extensionId: status.provider?.extension_id ?? null, reason: null }
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
      {status.provider && addon.state === 'ready' ? (
        <div className="text-sm space-y-3" data-processing-addon="ready">
          {addon.reason && <InlineNotice tone="warning">{addon.reason}</InlineNotice>}
          <div className="space-y-1">
            {(status.provider.details ?? []).map((line) => <p key={line} style={muted}>{line}</p>)}
          </div>
          {status.provider.settings && (
            <ProcessingSwitches
              settings={status.provider.settings}
              pending={pending}
              onChange={(changes) => (changes.mode ? setModeConfirm(changes.mode) : configure(changes))}
            />
          )}
          {status.provider.workers && <WorkerList workers={status.provider.workers} />}
          {status.provider.href && <Link href={status.provider.href} className="underline text-sm">Processing add-on page</Link>}
        </div>
      ) : (
        <AddonUpsellCard kind="processing" state={addon.state === 'unlicensed' ? 'unlicensed' : 'missing'} reason={addon.reason} compact={addon.state === 'unlicensed'} />
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
        open={modeConfirm !== null}
        onOpenChange={(open) => { if (!open) setModeConfirm(null) }}
        title={modeConfirm === 'workers' ? 'Use separate workers' : 'Process in the web app'}
        description={modeConfirm === 'workers'
          ? 'The web app will only queue work; the online workers claim and run it. Requests that need a result wait for the job.'
          : 'The web app runs queued work itself again. Running workers finish what they hold and get nothing new from the web app.'}
        confirmLabel={modeConfirm === 'workers' ? 'Use separate workers' : 'Process in the web app'}
        busy={pending}
        onConfirm={() => { const mode = modeConfirm; setModeConfirm(null); if (mode) configure({ mode }) }}
      />
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
