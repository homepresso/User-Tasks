'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { RotateCcw, Square, RefreshCw, Settings2, Shuffle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { cancelProviderSwitch, listProviderSwitches, retryProviderSwitch, rollbackProviderSwitch } from '@/app/actions/infrastructure'
import type { SwitchRecordView } from '@/lib/admin/infrastructure-switching'
import { ProviderSwitchWizard } from './provider-switch-wizard'
import { STATUS_STYLE, SwitchProgress, isActive, statusKey } from './switch-progress'

/**
 * Settings → Infrastructure: the per-area Change… / Settings buttons and the
 * switch log with live progress, Cancel, Retry and Rollback (instance
 * admins; every button is a server action that re-checks access).
 */

export function AreaActions({ area, label, hasSettings, enabled }: { area: string; label: string; hasSettings: boolean; enabled: boolean }) {
  const [open, setOpen] = useState<'switch' | 'settings' | null>(null)
  if (!enabled) return null
  return (
    <span className="flex gap-1">
      {hasSettings && (
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen('settings')} aria-label={`${label} settings`}><Settings2 size={13} /> Settings</Button>
      )}
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen('switch')} aria-label={`Change ${label} provider`}><Shuffle size={13} /> Change…</Button>
      {open && <ProviderSwitchWizard area={area} label={label} kind={open} open onOpenChange={(next) => { if (!next) setOpen(null) }} />}
    </span>
  )
}

function RollbackDialog({ record, onClose, onDone }: { record: SwitchRecordView; onClose: () => void; onDone: (message: string) => void }) {
  const [pending, startTransition] = useTransition()
  const [preview, setPreview] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState('')
  const muted = { color: 'var(--theme-muted-text)' }

  useEffect(() => {
    startTransition(async () => {
      const res = await rollbackProviderSwitch({ id: record.id, dryRun: true })
      if (res.ok) setPreview(res.lines)
      else setError(res.error)
    })
  }, [record.id])

  const run = () => startTransition(async () => {
    setError(null)
    const res = await rollbackProviderSwitch({ id: record.id, confirm })
    if (!res.ok) { setError(res.error); return }
    onDone(res.record && Object.keys(res.record.envChanges).length
      ? `Rolled back. Set in the app environment and restart: ${Object.entries(res.record.envChanges).map(([k, v]) => (v === '(unset)' ? `unset ${k}` : `${k}=${v}`)).join(', ')}`
      : 'Rolled back.')
  })

  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(36rem,94vw)] max-h-[90vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-xl p-5 shadow-xl dialog-content space-y-3"
          style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }} aria-describedby={undefined}>
          <Dialog.Title className="text-lg font-semibold">Roll back {record.kind === 'settings' ? `${record.areaLabel} settings` : `${record.areaLabel}: ${record.toProvider} → ${record.fromProvider}`}</Dialog.Title>
          <p className="text-sm" style={muted}>Restores the settings the change wrote and, for switches that moved data, undoes what it can (the same as <code>usertasks-admin rollback {record.id.slice(0, 8)}… --yes</code>).</p>
          {preview && <pre className="max-h-56 overflow-auto rounded-lg p-2 text-xs whitespace-pre-wrap break-words" style={{ backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)' }}>{preview.join('\n')}</pre>}
          {error && <InlineNotice tone="error" message={error} />}
          <div>
            <label htmlFor="rollback-confirm" className="block text-sm font-medium mb-1">Type <code>rollback</code> to confirm</label>
            <Input id="rollback-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="button" size="sm" variant="destructive" disabled={pending || confirm.trim() !== 'rollback' || !preview} onClick={run}><RotateCcw size={13} /> Roll back</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function SwitchLogPanel({ initial, error, busy: initialBusy }: { initial: SwitchRecordView[]; error: string | null; busy: boolean }) {
  const router = useRouter()
  const [records, setRecords] = useState(initial)
  const [busy, setBusy] = useState(initialBusy)
  const [rollback, setRollback] = useState<SwitchRecordView | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const muted = { color: 'var(--theme-muted-text)' }
  const card = { backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }
  const active = busy || records.some(isActive)

  // A server refresh brings new initial props: take them over (adjusting state while rendering).
  const [seen, setSeen] = useState(initial)
  if (seen !== initial) { setSeen(initial); setRecords(initial); setBusy(initialBusy) }

  // Live while something is queued or running; once it stops, refresh the page (providers, health).
  useEffect(() => {
    if (!active) return
    let stopped = false
    const timer = setInterval(async () => {
      const res = await listProviderSwitches().catch(() => null)
      if (stopped || !res?.ok) return
      setRecords(res.records)
      setBusy(res.busy)
      if (!res.busy && !res.records.some(isActive)) router.refresh()
    }, 2500)
    return () => { stopped = true; clearInterval(timer) }
  }, [active, router])

  const refresh = async () => {
    const res = await listProviderSwitches()
    if (res.ok) { setRecords(res.records); setBusy(res.busy) }
    router.refresh()
  }

  const cancel = (id: string) => startTransition(async () => {
    const res = await cancelProviderSwitch(id)
    setNotice(res.ok
      ? { tone: 'success', message: res.outcome === 'cancelled' ? 'Cancelled before it started.' : res.outcome === 'requested' ? 'Cancel requested: the switch stops before its next step (the provider is not changed).' : 'It is not running any more.' }
      : { tone: 'error', message: res.error })
    await refresh()
  })

  const retry = (id: string) => startTransition(async () => {
    const res = await retryProviderSwitch(id)
    setNotice(res.ok ? { tone: 'success', message: 'Queued again: steps already done are skipped.' } : { tone: 'error', message: res.error })
    await refresh()
  })

  return (
    <section className="rounded-xl border p-4 space-y-3" style={card} aria-label="Switch log">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold flex-1">Switch log</h2>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(refresh)} aria-label="Refresh switch log"><RefreshCw size={13} /></Button>
      </div>
      <p className="text-xs" style={muted}>Every switch, rollback and settings change — from this page or <code>usertasks-admin</code> — with who made it and the settings before and after (secret values are never shown).</p>
      {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}
      {error ? (
        <p className="text-sm" style={muted}>The switch log is unavailable ({error}).</p>
      ) : records.length === 0 ? (
        <p className="text-sm" style={muted}>No provider switches yet.</p>
      ) : (
        <ul className="space-y-3">
          {records.map((entry) => {
            const style = STATUS_STYLE[statusKey(entry)] ?? STATUS_STYLE.running
            return (
              <li key={entry.id} className="text-sm border-t pt-3 first:border-t-0 first:pt-0" style={{ borderColor: 'var(--theme-surface-border)' }} data-switch-id={entry.id}>
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="font-medium">{entry.kind === 'rollback' ? 'Rollback' : entry.kind === 'settings' ? 'Settings' : 'Switch'} {entry.areaLabel.toLowerCase()}</span>
                  <span>{entry.kind === 'settings' ? entry.toProvider : `${entry.fromProvider ?? '?'} → ${entry.toProvider}`}</span>
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={{ color: style.color, backgroundColor: style.bg }}>{style.label}</span>
                  <span className="text-xs" style={muted}>{new Date(entry.startedAt).toLocaleString()}{entry.actor ? ` · ${entry.actor}` : ''}</span>
                  <span className="ml-auto flex gap-1">
                    {entry.canCancel && <Button type="button" size="sm" variant="outline" disabled={pending || entry.cancelRequested} onClick={() => cancel(entry.id)}><Square size={12} /> {entry.cancelRequested ? 'Cancelling…' : 'Cancel'}</Button>}
                    {entry.canRetry && <Button type="button" size="sm" variant="outline" disabled={pending || active} onClick={() => retry(entry.id)}><RefreshCw size={12} /> Retry</Button>}
                    {entry.canRollback && <Button type="button" size="sm" variant="outline" disabled={pending || active} onClick={() => setRollback(entry)}><RotateCcw size={12} /> Rollback</Button>}
                  </span>
                </div>
                <code className="text-xs" style={muted}>{entry.id}</code>
                {isActive(entry) || entry.interrupted ? (
                  <div className="mt-2"><SwitchProgress record={entry} /></div>
                ) : (
                  <details className="mt-1">
                    <summary className="text-xs cursor-pointer" style={muted}>Details</summary>
                    <div className="mt-2"><SwitchProgress record={entry} /></div>
                  </details>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {rollback && (
        <RollbackDialog
          record={rollback}
          onClose={() => setRollback(null)}
          onDone={(message) => { setRollback(null); setNotice({ tone: 'success', message }); void refresh() }}
        />
      )}
    </section>
  )
}
