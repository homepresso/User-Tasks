'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from 'lucide-react'
import { ProgressBar } from '@/components/ui/progress-bar'
import { getProviderSwitch } from '@/app/actions/infrastructure'
import type { SwitchRecordView } from '@/lib/admin/infrastructure-switching'

/**
 * One switch's live progress (Settings → Infrastructure): steps with their
 * status, a percentage, the run's output. Polls the switch log while the
 * switch is queued or running — the same record `usertasks-admin switch`
 * writes, so a switch started with the CLI shows up here too.
 */

export const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  queued: { label: 'Queued', color: 'var(--status-todo)', bg: 'var(--status-todo-bg)' },
  running: { label: 'Running', color: 'var(--status-progress)', bg: 'var(--status-progress-bg)' },
  succeeded: { label: 'Succeeded', color: 'var(--status-done)', bg: 'var(--status-done-bg)' },
  failed: { label: 'Failed', color: 'var(--status-blocked)', bg: 'var(--status-blocked-bg)' },
  cancelled: { label: 'Cancelled', color: 'var(--status-todo)', bg: 'var(--status-todo-bg)' },
  rolled_back: { label: 'Rolled back', color: 'var(--status-todo)', bg: 'var(--status-todo-bg)' },
  interrupted: { label: 'Interrupted', color: 'var(--status-progress)', bg: 'var(--status-progress-bg)' },
  paused: { label: 'Paused — continues on the next run', color: 'var(--status-progress)', bg: 'var(--status-progress-bg)' },
}

export function statusKey(record: Pick<SwitchRecordView, 'status' | 'interrupted' | 'paused'>): string {
  return record.interrupted ? 'interrupted' : record.paused ? 'paused' : record.status
}

export const isActive = (record: Pick<SwitchRecordView, 'status'>) => record.status === 'queued' || record.status === 'running'

function StepIcon({ status }: { status: string }) {
  if (status === 'done') return <CheckCircle2 size={14} style={{ color: 'var(--status-done)' }} />
  if (status === 'running') return <Loader2 size={14} className="animate-spin" style={{ color: 'var(--status-progress)' }} />
  if (status === 'failed') return <XCircle size={14} style={{ color: 'var(--status-blocked)' }} />
  if (status === 'skipped') return <MinusCircle size={14} style={{ color: 'var(--theme-muted-text)' }} />
  return <Circle size={14} style={{ color: 'var(--theme-muted-text)' }} />
}

/** Follow a record until it stops (poll every 2 s while active). */
export function useSwitchRecord(initial: SwitchRecordView | null, id: string | null = initial?.id ?? null): SwitchRecordView | null {
  const [record, setRecord] = useState(initial)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!id) return
    let stopped = false
    const tick = async () => {
      const res = await getProviderSwitch(id).catch(() => null)
      if (stopped) return
      if (res?.ok) setRecord(res.record)
      if (!res?.ok || isActive(res.record)) timer.current = setTimeout(tick, 2000)
    }
    void tick()
    return () => { stopped = true; if (timer.current) clearTimeout(timer.current) }
  }, [id])
  return record
}

export function SwitchProgress({ record, showLog = true }: { record: SwitchRecordView; showLog?: boolean }) {
  const muted = { color: 'var(--theme-muted-text)' }
  const style = STATUS_STYLE[statusKey(record)] ?? STATUS_STYLE.running
  return (
    <div className="space-y-3" aria-label="Switch progress">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={{ color: style.color, backgroundColor: style.bg }}>{style.label}</span>
        <span>{record.kind === 'settings' ? `${record.areaLabel} settings (${record.toProvider})` : `${record.areaLabel}: ${record.fromProvider ?? '?'} → ${record.toProvider}`}</span>
        <span className="text-xs" style={muted}>{record.percent}%</span>
        {record.cancelRequested && isActive(record) && <span className="text-xs" style={muted}>· cancelling after the current step</span>}
      </div>
      <ProgressBar value={record.percent} />
      {record.steps.length > 0 && (
        <ol className="space-y-1 text-sm">
          {record.steps.map((step) => (
            <li key={step.id} className="flex items-start gap-2">
              <span className="pt-0.5"><StepIcon status={step.status} /></span>
              <span className="min-w-0">
                <span className="font-medium">{step.title}</span>
                {typeof step.progress === 'number' && step.status === 'running' && <span className="text-xs" style={muted}> · {Math.round(step.progress * 100)}%</span>}
                {step.detail && <span className="block text-xs break-words" style={muted}>{step.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {record.error && <p className="text-xs break-words" style={{ color: 'var(--status-blocked)' }}>{record.error}</p>}
      {Object.keys(record.envChanges).length > 0 && (
        <div className="text-xs rounded-lg border p-2" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <p className="font-medium mb-1">Set these in the app environment and restart it:</p>
          <pre className="whitespace-pre-wrap break-all">{Object.entries(record.envChanges).map(([k, v]) => (v === '(unset)' ? `unset ${k}` : `${k}=${v}`)).join('\n')}</pre>
        </div>
      )}
      {record.changes.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer" style={muted}>Settings changed ({record.changes.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {record.changes.map((c) => (
              <li key={c.key} className="break-words"><code>{c.key}</code>: {c.secret ? 'secret value changed (encrypted)' : `${c.before ?? '(unset)'} → ${c.after ?? '(unset)'}`}</li>
            ))}
          </ul>
        </details>
      )}
      {showLog && record.log.length > 0 && (
        <details className="text-xs" open={isActive(record)}>
          <summary className="cursor-pointer" style={muted}>Output ({record.log.length} lines)</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded-lg p-2 whitespace-pre-wrap break-words" style={{ backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)' }}>{record.log.join('\n')}</pre>
        </details>
      )}
    </div>
  )
}
