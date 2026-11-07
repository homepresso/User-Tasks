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
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge, type Tone } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { uninstallAction } from '@/app/actions/packages'
import { useJobs } from '@/components/jobs/jobs-provider'
import { Modal } from './requirements-form'

type Result = Extract<Awaited<ReturnType<typeof uninstallAction>>, { ok: true }>['data']

const ACTION_STYLE: Record<string, { label: string; tone: Tone }> = {
  delete: { label: 'Remove', tone: 'danger' },
  skip: { label: 'Keep', tone: 'neutral' },
  gone: { label: 'Gone', tone: 'neutral' },
}

/** The service's reasons name API options; the dialog offers them as the checkboxes below. */
export function friendlyReason(reason: string | undefined): string | undefined {
  return reason?.replace(/\s*\(use (?:force|delete_data)[^)]*\)$/, '')
}

function Option({ checked, onChange, title, warning, testId }: { checked: boolean; onChange: (v: boolean) => void; title: string; warning: string; testId: string }) {
  return (
    <div className={cn('rounded-lg border p-3 transition-colors duration-[var(--ds-dur-fast)]', checked ? 'border-warning bg-warning-wash' : 'border-border')}>
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId}
        label={<span className="font-medium">{title}</span>} description={warning} />
    </div>
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
  // Synchronous guard: two clicks in one frame both see busy === false.
  const submitGuard = useSubmitGuard()
  const submit = async () => {
    await submitGuard.run(async () => {
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
    })
  }

  if (result) {
    const removed = result.summary.delete - (result.errors?.length ?? 0)
    return (
      <Modal open={open} onOpenChange={close} title={`${install.name} uninstalled`}
        footer={<>
          {onShowHistory && <Button variant="secondary" onClick={() => { close(false); onShowHistory() }}>View history</Button>}
          <Button onClick={() => close(false)} data-testid="uninstall-close">Done</Button>
        </>}>
        <div className="space-y-3" data-testid="uninstall-result">
          <InlineNotice tone={result.errors?.length ? 'warning' : 'success'} message={`${removed} artifact${removed === 1 ? '' : 's'} removed${result.summary.rows && deleteData ? ` (with ${result.summary.rows} table rows)` : ''}, ${result.summary.skip} kept${result.runs_cancelled ? `, ${result.runs_cancelled} run${result.runs_cancelled === 1 ? '' : 's'} cancelled` : ''}.`} />
          <div className="max-h-72 divide-y divide-border-subtle overflow-y-auto rounded-lg border border-border text-ui scrollbar-thin">
            {result.plan.map((entry) => {
              const failed = result.errors?.find((e) => e.local_id === entry.local_id)
              return (
                <div key={`${entry.section}:${entry.local_id}`} className="flex items-center gap-2 px-3 py-1.5">
                  {failed ? <AlertTriangle size={14} className="shrink-0 text-danger" aria-hidden /> : entry.action === 'delete' ? <CheckCircle2 size={14} className="shrink-0 text-success" aria-hidden /> : <span className="w-3.5 shrink-0" />}
                  <span className="w-28 shrink-0 text-xs text-fg-muted first-letter:uppercase">{entry.section.replace(/_/g, ' ')}</span>
                  <span className="truncate text-fg">{entry.name}</span>
                  <span className={cn('ml-auto shrink-0 text-xs', failed ? 'text-danger' : 'text-fg-muted')}>{failed ? failed.error : entry.action === 'delete' ? 'Removed' : entry.action === 'skip' ? 'Kept' : 'Already gone'}</span>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-fg-muted">Workflows and data tables are removed by the background deletion worker within a minute. The uninstall is recorded in the package history.</p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={open} onOpenChange={close} title={`Uninstall ${install.name} ${install.version}`}
      description="Removes what this package installed. Review every artifact below — nothing is changed until you confirm."
      footer={<>
        <Button variant="secondary" onClick={() => close(false)} disabled={busy}>Cancel</Button>
        <Button variant="danger" leadingIcon={<Trash2 />} onClick={() => void submit()} loading={busy} disabled={!data || plan.isFetching || blocked || !typedOk} data-testid="uninstall-submit">
          {`Uninstall (${data?.summary.delete ?? 0} item${data?.summary.delete === 1 ? '' : 's'})`}
        </Button>
      </>}>
      <div className="space-y-4">
        {error && <InlineNotice tone="error" message={error} />}
        {plan.error && <InlineNotice tone="error" message={(plan.error as Error).message} />}
        <div className="max-h-64 divide-y divide-border-subtle overflow-y-auto rounded-lg border border-border text-ui scrollbar-thin" data-testid="uninstall-plan">
          {!data && <p className="px-3 py-2 text-ui text-fg-muted" role="status">Checking…</p>}
          {(data?.plan ?? []).map((entry) => (
            <div key={`${entry.section}:${entry.local_id}`} className="flex items-center gap-2 px-3 py-1.5">
              <span className="w-16 shrink-0"><Badge tone={ACTION_STYLE[entry.action].tone}>{ACTION_STYLE[entry.action].label}</Badge></span>
              <span className="w-28 shrink-0 text-xs text-fg-muted first-letter:uppercase">{entry.section.replace(/_/g, ' ')}</span>
              <span className="truncate text-fg">{entry.name}</span>
              <span className="ml-auto max-w-[50%] shrink-0 text-right text-xs text-fg-muted">
                {[friendlyReason(entry.reason), entry.action === 'delete' && entry.rows ? `and its ${entry.rows} row${entry.rows === 1 ? '' : 's'}` : '', entry.action === 'delete' ? entry.note : ''].filter(Boolean).join(' · ')}
              </span>
            </div>
          ))}
        </div>
        {data && <p className="num text-xs text-fg-muted">{data.summary.delete} to remove{data.summary.rows ? ` · ${data.summary.rows} table rows deleted` : ''} · {data.summary.skip} kept{data.summary.gone ? ` · ${data.summary.gone} already gone` : ''}</p>}

        <div className="space-y-2">
          <Option testId="uninstall-delete-data" checked={deleteData} onChange={setDeleteData} title="Remove everything including data tables and their rows"
            warning="Data tables the package installed are deleted even when they hold rows — rows added here since install too. This cannot be undone." />
          <Option testId="uninstall-force" checked={force} onChange={setForce} title="Also remove items changed since install"
            warning="Items edited in this workspace after the install are removed as well; your changes are lost." />
        </div>

        {(data?.active_run_count ?? 0) > 0 && (
          <div className="space-y-2 rounded-lg bg-warning-wash p-3" data-testid="uninstall-runs">
            <p className="flex items-center gap-1.5 text-ui font-medium text-fg"><AlertTriangle size={14} className="text-warning" aria-hidden /> {data!.active_run_count} run{data!.active_run_count === 1 ? ' is' : 's are'} still in progress</p>
            <ul className="max-h-28 space-y-0.5 overflow-y-auto text-xs text-fg">
              {data!.active_runs.map((run) => <li key={run.id}><a className="text-primary-text underline underline-offset-2" href={`/automations/runs/${run.id}`}>{run.title || run.id.slice(0, 8)}</a> · {run.workflow_name} · {run.status.replace(/_/g, ' ')}</li>)}
            </ul>
            <Checkbox checked={cancelRuns} onChange={(e) => setCancelRuns(e.target.checked)} data-testid="uninstall-cancel-runs"
              label="Cancel these runs and close their open tasks, then uninstall." description="Deleting a workflow deletes its runs." />
          </div>
        )}
        {(data?.missing_permissions ?? []).length > 0 && <InlineNotice tone="error" message={`You need ${data!.missing_permissions.join(', ')} to remove these items.`} />}

        {needsTyping && (
          <Field label={<>Type <strong>{install.name}</strong> to confirm{removesRows ? ` deleting ${data!.summary.rows} rows` : ''}</>}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={install.name} data-testid="uninstall-confirm-name" />
          </Field>
        )}
      </div>
    </Modal>
  )
}
