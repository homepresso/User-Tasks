'use client'

import { useState, useTransition } from 'react'
import { Play, Save, ScanSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { runHousekeepingNow, saveHousekeepingSettings } from '@/app/actions/housekeeping'
import {
  HOUSEKEEPING_INTERVALS,
  HOUSEKEEPING_SPECS,
  describeHousekeepingValue,
  parseHousekeepingValue,
  type HousekeepingOption,
  type HousekeepingSettings,
} from '@/lib/config/housekeeping'
import { bytesPerRow, formatBytes, housekeepingFindings, isBloated, type HousekeepingRunResult, type HousekeepingStatus } from '@/lib/admin/housekeeping'

/**
 * Settings → Infrastructure → Housekeeping (instance admins): the system-table
 * purge's settings, the tables it watches, recent passes, and "Run now".
 * Saving and running go through server actions that re-check instance-admin
 * access (app/actions/housekeeping.ts).
 */

type Draft = { enabled: boolean; interval_minutes: string; cron_history_hours: string; http_response_minutes: string }

const toDraft = (s: HousekeepingSettings): Draft => ({
  enabled: s.enabled,
  interval_minutes: String(s.interval_minutes),
  cron_history_hours: String(s.cron_history_hours),
  http_response_minutes: String(s.http_response_minutes),
})

const PURGED_BY: Record<string, string> = { housekeeping: 'Housekeeping', 'cleanup-logs': 'Daily clean-up', kept: 'Kept' }

function draftErrors(draft: Draft): Partial<Record<HousekeepingOption, string>> {
  const errors: Partial<Record<HousekeepingOption, string>> = {}
  for (const option of ['cron_history_hours', 'http_response_minutes'] as const) {
    try {
      parseHousekeepingValue(option, draft[option])
    } catch (error) {
      errors[option] = (error as Error).message.replace(/^housekeeping\.\w+ /, '')
    }
  }
  return errors
}

function runSummary(result: HousekeepingRunResult): string {
  if (result.status === 'skipped') return `Skipped (${result.reason}).`
  const total = Object.values(result.deleted).reduce((sum, n) => sum + Number(n || 0), 0)
  const verb = result.dry_run ? 'would be deleted' : 'deleted'
  return `${total.toLocaleString()} row${total === 1 ? '' : 's'} ${verb} in ${result.duration_ms ?? 0} ms${result.more ? ' — more remain for the next pass' : ''}.`
}

export function HousekeepingCard({ initial, error }: { initial: HousekeepingStatus | null; error: string | null }) {
  const [status, setStatus] = useState(initial)
  const [draft, setDraft] = useState<Draft | null>(initial ? toDraft(initial.settings) : null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const [serverErrors, setServerErrors] = useState<Partial<Record<HousekeepingOption, string>>>({})
  const [lastResult, setLastResult] = useState<HousekeepingRunResult | null>(null)
  const [pending, startTransition] = useTransition()

  const muted = { color: 'var(--theme-muted-text)' }
  const card = { backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }
  const selectStyle = { borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)' }

  if (!status || !draft) {
    return (
      <section className="rounded-xl border p-4" style={card} aria-label="Housekeeping">
        <h2 className="text-base font-semibold">Housekeeping</h2>
        <p className="text-sm mt-2" style={muted}>Housekeeping is unavailable ({error ?? 'unknown error'}).</p>
      </section>
    )
  }

  const errors = { ...draftErrors(draft), ...serverErrors }
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(status.settings))
  const stored = new Map(status.stored.map((row) => [row.key, row]))
  const findings = housekeepingFindings(status).filter((f) => f.level === 'warn')

  const save = () => startTransition(async () => {
    setNotice(null)
    const res = await saveHousekeepingSettings({
      enabled: draft.enabled,
      interval_minutes: draft.interval_minutes,
      cron_history_hours: draft.cron_history_hours,
      http_response_minutes: draft.http_response_minutes,
    })
    if (!res.ok) {
      setServerErrors(('fieldErrors' in res && res.fieldErrors) || {})
      setNotice({ tone: 'error', message: res.error })
      return
    }
    setServerErrors({})
    setStatus(res.status)
    setDraft(toDraft(res.status.settings))
    setNotice({ tone: 'success', message: res.changed.length ? 'Housekeeping settings saved. The next pass uses them.' : 'Nothing changed.' })
  })

  const run = (dryRun: boolean) => startTransition(async () => {
    setNotice(null)
    const res = await runHousekeepingNow({ dryRun })
    if (!res.ok) { setNotice({ tone: 'error', message: res.error }); return }
    setStatus(res.status)
    setLastResult(res.result)
    setNotice({ tone: res.result.status === 'ok' ? 'success' : 'warning', message: `${dryRun ? 'Dry run: ' : ''}${runSummary(res.result)}` })
  })

  const field = (option: HousekeepingOption, control: React.ReactNode) => {
    const row = stored.get(`housekeeping.${option}`)
    return (
      <div>
        <label htmlFor={`hk-${option}`} className="block text-sm font-medium mb-1">{HOUSEKEEPING_SPECS[option].label}</label>
        {control}
        <p className="text-xs mt-1" style={errors[option] ? { color: 'var(--theme-danger)' } : muted}>
          {errors[option] ?? HOUSEKEEPING_SPECS[option].help}
          {!errors[option] && (row ? ` Set ${new Date(row.updated_at).toLocaleString()}.` : ' Default.')}
        </p>
      </div>
    )
  }

  const amountHint = (option: 'cron_history_hours' | 'http_response_minutes') => {
    try {
      return describeHousekeepingValue(option, parseHousekeepingValue(option, draft[option]))
    } catch {
      return ''
    }
  }

  return (
    <section className="rounded-xl border p-4 space-y-4" style={card} aria-label="Housekeeping">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Housekeeping</h2>
          <p className="text-sm mt-1" style={muted}>
            Purges the system tables that grow on their own — scheduler run history, the database&apos;s HTTP responses,
            expired cache and sign-in rows. Workspace data follows each workspace&apos;s retention policies instead.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(true)}>
            <ScanSearch size={14} className="mr-1" /> Dry run
          </Button>
          <Button type="button" size="sm" disabled={pending} onClick={() => run(false)}>
            <Play size={14} className="mr-1" /> Run now
          </Button>
        </div>
      </div>

      {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}

      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => { e.preventDefault(); if (dirty && !Object.keys(draftErrors(draft)).length) save() }}
      >
        {field('enabled', (
          <label className="flex items-center gap-2 text-sm h-10">
            <input
              id="hk-enabled"
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            {draft.enabled ? 'On' : 'Off'}
          </label>
        ))}
        {field('interval_minutes', (
          <select
            id="hk-interval_minutes"
            value={draft.interval_minutes}
            onChange={(e) => setDraft({ ...draft, interval_minutes: e.target.value })}
            className="w-full h-10 rounded-lg border px-3 text-sm"
            style={selectStyle}
          >
            {HOUSEKEEPING_INTERVALS.map((m) => <option key={m} value={m}>{describeHousekeepingValue('interval_minutes', m)}</option>)}
          </select>
        ))}
        {field('cron_history_hours', (
          <div className="flex items-center gap-2">
            <Input
              id="hk-cron_history_hours"
              inputMode="numeric"
              value={draft.cron_history_hours}
              onChange={(e) => { setServerErrors({}); setDraft({ ...draft, cron_history_hours: e.target.value }) }}
              aria-invalid={Boolean(errors.cron_history_hours)}
              className="w-28"
            />
            <span className="text-sm" style={muted}>hours {amountHint('cron_history_hours') && `(${amountHint('cron_history_hours')})`}</span>
          </div>
        ))}
        {field('http_response_minutes', (
          <div className="flex items-center gap-2">
            <Input
              id="hk-http_response_minutes"
              inputMode="numeric"
              value={draft.http_response_minutes}
              onChange={(e) => { setServerErrors({}); setDraft({ ...draft, http_response_minutes: e.target.value }) }}
              aria-invalid={Boolean(errors.http_response_minutes)}
              className="w-28"
            />
            <span className="text-sm" style={muted}>minutes {amountHint('http_response_minutes') && `(${amountHint('http_response_minutes')})`}</span>
          </div>
        ))}
        <div className="sm:col-span-2 flex items-center gap-2">
          <Button type="submit" size="sm" disabled={pending || !dirty || Object.keys(draftErrors(draft)).length > 0}>
            <Save size={14} className="mr-1" /> Save settings
          </Button>
          {dirty && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setDraft(toDraft(status.settings))}>Discard</Button>}
          <span className="text-xs ml-auto" style={muted}>
            Also: <code>usertasks-admin housekeeping set &lt;setting&gt; &lt;value&gt;</code>
          </span>
        </div>
      </form>

      {findings.length > 0 && (
        <ul className="space-y-1 text-sm">
          {findings.map((f) => (
            <li key={f.name} className="flex gap-2">
              <span className="shrink-0 text-xs font-medium pt-0.5" style={{ color: 'var(--status-progress)' }}>WARN</span>
              <span className="min-w-0 break-words"><code className="text-xs">{f.name}</code> {f.detail}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs" style={muted}>
              <th className="py-1 pr-3 font-medium">Table</th>
              <th className="py-1 pr-3 font-medium text-right">Rows</th>
              <th className="py-1 pr-3 font-medium text-right">Size</th>
              <th className="py-1 pr-3 font-medium">Purged by</th>
              <th className="py-1 font-medium">Rule</th>
            </tr>
          </thead>
          <tbody>
            {status.tables.map((t) => {
              const deleted = lastResult?.deleted[t.table]
              return (
                <tr key={t.table} className="border-t" style={{ borderColor: 'var(--theme-surface-border)' }}>
                  <td className="py-1.5 pr-3 whitespace-nowrap"><code className="text-xs">{t.table}</code></td>
                  {t.installed ? (
                    <>
                      <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">
                        ~{(t.rows ?? 0).toLocaleString()}
                        {deleted !== undefined && <span className="block text-xs" style={muted}>{lastResult?.dry_run ? 'would delete' : 'deleted'} {Number(deleted).toLocaleString()}</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap" title={bytesPerRow(t) ? `${formatBytes(bytesPerRow(t))} per row` : undefined}>
                        {formatBytes(t.total_bytes)}
                        {isBloated(t) && <span className="block text-xs" style={{ color: 'var(--status-progress)' }}>bloated</span>}
                      </td>
                    </>
                  ) : (
                    <td className="py-1.5 pr-3 text-right text-xs" style={muted} colSpan={2}>not applicable</td>
                  )}
                  <td className="py-1.5 pr-3 text-xs whitespace-nowrap">{PURGED_BY[t.purged_by] ?? t.purged_by}</td>
                  <td className="py-1.5 text-xs" style={muted}>{t.rule}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Recent passes</h3>
        {status.runs.length === 0 ? (
          <p className="text-sm mt-1" style={muted}>No pass recorded yet.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs">
            {status.runs.slice(0, 5).map((r) => {
              const total = Object.values(r.deleted).reduce((sum, n) => sum + Number(n || 0), 0)
              return (
                <li key={r.started_at} className="flex flex-wrap gap-x-3">
                  <span>{new Date(r.started_at).toLocaleString()}</span>
                  <span style={muted}>{r.trigger}{r.actor ? ` · ${r.actor}` : ''}</span>
                  <span style={{ color: r.status === 'ok' ? 'var(--status-done)' : 'var(--status-progress)' }}>{r.status}</span>
                  <span>{total.toLocaleString()} deleted · {r.duration_ms} ms{r.more ? ' · more left' : ''}</span>
                </li>
              )
            })}
          </ul>
        )}
        {status.pg_cron_jobs && (
          <p className="text-xs mt-2" style={muted}>
            pg_cron: {status.pg_cron_jobs.length ? status.pg_cron_jobs.map((j) => `${j.jobname} (${j.schedule}${j.active ? '' : ', inactive'})`).join(', ') : 'no housekeeping jobs scheduled'}
          </p>
        )}
      </div>
    </section>
  )
}
