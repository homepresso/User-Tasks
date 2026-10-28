'use client'

/**
 * Remove a package and its artifacts: the dry-run plan lists every artifact
 * and what happens to it; options "Remove everything including data tables
 * and their rows" (delete_data) and "Also remove items changed since
 * install" (force) with their warnings; unfinished runs of the package's
 * workflows block the uninstall unless they are cancelled (deleting a
 * workflow deletes its runs); typed confirmation (the package name) when
 * data is deleted; a result summary (recorded in the package history).
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { uninstallAction } from '@/app/actions/packages'
import { useJobs } from '@/components/jobs/jobs-provider'
import { Modal } from './requirements-form'

type Result = Extract<Awaited<ReturnType<typeof uninstallAction>>, { ok: true }>['data']

const muted = { color: 'var(--theme-muted-text)' }
const border = { borderColor: 'var(--theme-surface-border)' }
const ACTION_STYLE: Record<string, { label: string; color: string }> = {
  delete: { label: 'Remove', color: 'var(--theme-danger)' },
  skip: { label: 'Keep', color: 'var(--theme-muted-text)' },
  gone: { label: 'Gone', color: 'var(--theme-muted-text)' },
}

/** The service's reasons name API options; the dialog offers them as the checkboxes below. */
export function friendlyReason(reason: string | undefined): string | undefined {
  return reason?.replace(/\s*\(use (?:force|delete_data)[^)]*\)$/, '')
}

function Option({ checked, onChange, title, warning, testId }: { checked: boolean; onChange: (v: boolean) => void; title: string; warning: string; testId: string }) {
  return (
    <label className="flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer" style={{ ...border, backgroundColor: checked ? 'var(--status-warning-bg)' : undefined }}>
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span>
        <span className="text-sm font-medium block">{title}</span>
        <span className="text-xs block mt-0.5" style={checked ? { color: 'var(--theme-warning)' } : muted}>{warning}</span>
      </span>
    </label>
  )
}

export function UninstallDialog({ open, onOpenChange, install, onDone, onShowHistory }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  install: { id: string; name: string; version: string }
  onDone: (message: string) => void
  onShowHistory?: () => void
}) {
  const jobs = useJobs()
  const [force, setForce] = useState(false)
  const [deleteData, setDeleteData] = useState(false)
  const [cancelRuns, setCancelRuns] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const plan = useQuery({
    queryKey: ['package-uninstall-plan', install.id, force, deleteData, cancelRuns],
    queryFn: async () => { const r = await uninstallAction(install.id, { dry_run: true, force, delete_data: deleteData, cancel_runs: cancelRuns }); if (!r.ok) throw new Error(r.error); return r.data },
    enabled: open && !result,
  })
  const close = (next: boolean) => {
    if (!next) {
      if (result) onDone(`Uninstalled ${install.name}: ${result.summary.delete - (result.errors?.length ?? 0)} removed, ${result.summary.skip} kept.`)
      setForce(false); setDeleteData(false); setCancelRuns(false); setTyped(''); setError(null); setResult(null)
    }
    onOpenChange(next)
  }
  const data = plan.data
  const removesRows = deleteData && (data?.summary.rows ?? 0) > 0
  const needsTyping = deleteData
  const typedOk = !needsTyping || typed.trim() === install.name
  const blocked = (data?.blockers ?? []).length > 0
  const submit = async () => {
    setBusy(true)
    setError(null)
    // A `package.uninstall` job: a quick one shows its result here, a long
    // one continues after the dialog closes (popup + Jobs panel).
    let returned = false
    try {
      const job = await jobs.start('package.uninstall', { install_id: install.id, name: install.name, force, delete_data: deleteData, cancel_runs: cancelRuns }, {
        // Finished later (dialog closed): refresh the library. Finished now: close() reports it.
        effect: 'change', quietIfInline: true, onSuccess: (done) => { if (returned) onDone(`Uninstalled ${install.name}: ${done.result?.summary ?? 'done'}.`) },
      })
      returned = true
      if (job?.status === 'failed') { setError(job.error ?? 'Uninstall failed'); void plan.refetch(); return }
      if (job?.status === 'succeeded' && job.result?.data) { setResult(job.result.data as Result); return }
      onOpenChange(false)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start the uninstall')
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const removed = result.summary.delete - (result.errors?.length ?? 0)
    return (
      <Modal open={open} onOpenChange={close} title={`${install.name} uninstalled`} width="w-[min(40rem,94vw)]">
        <div className="space-y-3" data-testid="uninstall-result">
          <InlineNotice tone={result.errors?.length ? 'warning' : 'success'} message={`${removed} artifact${removed === 1 ? '' : 's'} removed${result.summary.rows && deleteData ? ` (with ${result.summary.rows} table rows)` : ''}, ${result.summary.skip} kept${result.runs_cancelled ? `, ${result.runs_cancelled} run${result.runs_cancelled === 1 ? '' : 's'} cancelled` : ''}.`} />
          <div className="rounded-lg border divide-y text-sm max-h-72 overflow-y-auto" style={border}>
            {result.plan.map((entry) => {
              const failed = result.errors?.find((e) => e.local_id === entry.local_id)
              return (
                <div key={`${entry.section}:${entry.local_id}`} className="px-3 py-1.5 flex gap-2 items-center" style={border}>
                  {failed ? <AlertTriangle size={13} style={{ color: 'var(--theme-danger)' }} /> : entry.action === 'delete' ? <CheckCircle2 size={13} style={{ color: 'var(--theme-success)' }} /> : <span className="w-[13px]" />}
                  <span className="text-xs w-28 shrink-0" style={muted}>{entry.section.replace(/_/g, ' ')}</span>
                  <span className="truncate">{entry.name}</span>
                  <span className="text-xs ml-auto shrink-0" style={failed ? { color: 'var(--theme-danger)' } : muted}>{failed ? failed.error : entry.action === 'delete' ? 'removed' : entry.action === 'skip' ? 'kept' : 'already gone'}</span>
                </div>
              )
            })}
          </div>
          <p className="text-xs" style={muted}>Workflows and data tables are removed by the background deletion worker within a minute. The uninstall is recorded in the package history.</p>
          <div className="flex justify-end gap-2">
            {onShowHistory && <Button size="sm" variant="outline" onClick={() => { close(false); onShowHistory() }}>View history</Button>}
            <Button size="sm" onClick={() => close(false)} data-testid="uninstall-close">Done</Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={open} onOpenChange={close} title={`Uninstall ${install.name} ${install.version}`} width="w-[min(40rem,94vw)]">
      <div className="space-y-4">
        <p className="text-sm" style={muted}>Removes what this package installed. Review every artifact below — nothing is changed until you confirm.</p>
        {error && <InlineNotice tone="error" message={error} />}
        {plan.error && <InlineNotice tone="error" message={(plan.error as Error).message} />}
        <div className="rounded-lg border divide-y text-sm max-h-64 overflow-y-auto" style={border} data-testid="uninstall-plan">
          {!data && <p className="px-3 py-2 text-sm" style={muted}>Checking…</p>}
          {(data?.plan ?? []).map((entry) => (
            <div key={`${entry.section}:${entry.local_id}`} className="px-3 py-1.5 flex gap-2 items-center" style={border}>
              <span className="text-xs font-semibold w-14 shrink-0" style={{ color: ACTION_STYLE[entry.action].color }}>{ACTION_STYLE[entry.action].label}</span>
              <span className="text-xs w-28 shrink-0" style={muted}>{entry.section.replace(/_/g, ' ')}</span>
              <span className="truncate">{entry.name}</span>
              <span className="text-xs ml-auto shrink-0 text-right max-w-[50%]" style={muted}>
                {[friendlyReason(entry.reason), entry.action === 'delete' && entry.rows ? `and its ${entry.rows} row${entry.rows === 1 ? '' : 's'}` : '', entry.action === 'delete' ? entry.note : ''].filter(Boolean).join(' · ')}
              </span>
            </div>
          ))}
        </div>
        {data && <p className="text-xs" style={muted}>{data.summary.delete} to remove{data.summary.rows ? ` · ${data.summary.rows} table rows deleted` : ''} · {data.summary.skip} kept{data.summary.gone ? ` · ${data.summary.gone} already gone` : ''}</p>}

        <div className="space-y-2">
          <Option testId="uninstall-delete-data" checked={deleteData} onChange={setDeleteData} title="Remove everything including data tables and their rows"
            warning="Data tables the package installed are deleted even when they hold rows — rows added here since install too. This cannot be undone." />
          <Option testId="uninstall-force" checked={force} onChange={setForce} title="Also remove items changed since install"
            warning="Items edited in this workspace after the install are removed as well; your changes are lost." />
        </div>

        {(data?.active_run_count ?? 0) > 0 && (
          <div className="rounded-lg border p-3 space-y-2" style={{ ...border, backgroundColor: 'var(--status-warning-bg)' }} data-testid="uninstall-runs">
            <p className="text-sm font-medium flex items-center gap-1.5"><AlertTriangle size={14} style={{ color: 'var(--theme-warning)' }} /> {data!.active_run_count} run{data!.active_run_count === 1 ? ' is' : 's are'} still in progress</p>
            <ul className="text-xs space-y-0.5 max-h-28 overflow-y-auto">
              {data!.active_runs.map((run) => <li key={run.id}><a className="underline underline-offset-2" href={`/automations/runs/${run.id}`}>{run.title || run.id.slice(0, 8)}</a> · {run.workflow_name} · {run.status.replace(/_/g, ' ')}</li>)}
            </ul>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={cancelRuns} onChange={(e) => setCancelRuns(e.target.checked)} data-testid="uninstall-cancel-runs" />
              <span>Cancel these runs and close their open tasks, then uninstall. <span className="text-xs" style={muted}>Deleting a workflow deletes its runs.</span></span></label>
          </div>
        )}
        {(data?.missing_permissions ?? []).length > 0 && <InlineNotice tone="error" message={`You need ${data!.missing_permissions.join(', ')} to remove these items.`} />}

        {needsTyping && (
          <label className="block text-sm">
            Type <strong>{install.name}</strong> to confirm{removesRows ? ` deleting ${data!.summary.rows} rows` : ''}:
            <Input className="h-8 text-sm mt-1" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={install.name} data-testid="uninstall-confirm-name" />
          </label>
        )}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => close(false)} disabled={busy}>Cancel</Button>
          <Button size="sm" variant="destructive" onClick={() => void submit()} disabled={busy || !data || plan.isFetching || blocked || !typedOk} data-testid="uninstall-submit">
            <Trash2 size={13} /> {busy ? 'Uninstalling…' : `Uninstall (${data?.summary.delete ?? 0} item${data?.summary.delete === 1 ? '' : 's'})`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
