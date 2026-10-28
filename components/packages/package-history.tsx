'use client'

/**
 * Package history: the timeline of every install, upgrade, reinstall,
 * downgrade, reconfigure (Complete setup) and uninstall in this workspace,
 * failed attempts included. Filters (package, action, status, user, dates),
 * a detail drawer with the plan / diff that was applied, and CSV export.
 * Reads lib/services/package-events through the packages server actions.
 */

import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Download, History, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { formatRelativeDate } from '@/lib/utils'
import { getPackageEventAction, listPackageEventsAction } from '@/app/actions/packages'
import { useJobs } from '@/components/jobs/jobs-provider'
import { friendlyReason } from './uninstall-dialog'

/* eslint-disable @typescript-eslint/no-explicit-any -- stored plans are free-form JSON */

type EventRow = Extract<Awaited<ReturnType<typeof listPackageEventsAction>>, { ok: true }>['data']['events'][number]
export interface HistoryFilters { package?: string; action?: string; status?: string; actor?: string; since?: string; until?: string }

const muted = { color: 'var(--theme-muted-text)' }
const border = { borderColor: 'var(--theme-surface-border)' }
const PAGE = 50

export const ACTION_LABEL: Record<string, string> = {
  install: 'Installed', upgrade: 'Upgraded', reinstall: 'Reinstalled', downgrade: 'Downgraded', reconfigure: 'Reconfigured', uninstall: 'Uninstalled',
}
const CHANNEL_LABEL: Record<string, string> = { ui: 'App', cli: 'CLI', api: 'API', mcp: 'MCP' }
const SOURCE_LABEL: Record<string, string> = { file: 'file', library: 'library', api: 'API', cli: 'CLI', mcp: 'MCP' }

function saveText(fileName: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function versionText(e: { from_version: string | null; to_version: string | null; action: string }) {
  if (e.action === 'uninstall') return e.from_version ?? ''
  if (e.from_version && e.to_version && e.from_version !== e.to_version) return `${e.from_version} → ${e.to_version}`
  return e.to_version ?? e.from_version ?? ''
}

function countsText(e: EventRow): string {
  const c: Record<string, number> = (e.counts ?? {}) as Record<string, number>
  if (e.status === 'failed' && !Object.keys(c).length) return '—'
  if (e.action === 'uninstall') return [`${c.removed ?? 0} removed`, c.skipped ? `${c.skipped} kept` : '', c.rows_deleted ? `${c.rows_deleted} rows` : '', c.runs_cancelled ? `${c.runs_cancelled} runs cancelled` : ''].filter(Boolean).join(' · ')
  if (e.action === 'reconfigure') return `${c.updated ?? 0} updated`
  return [`${c.created ?? 0} created`, `${c.updated ?? 0} updated`, c.skipped ? `${c.skipped} kept` : '', c.errors ? `${c.errors} errors` : ''].filter(Boolean).join(' · ')
}

export function signatureText(e: { signed: boolean | null; signature_valid: boolean | null; trust: string | null; fingerprint?: string | null }) {
  if (e.signed === null || e.signed === undefined) return '—'
  if (!e.signed) return 'Unsigned'
  if (e.signature_valid === false) return 'Invalid signature'
  return e.trust === 'instance' ? 'Signed · this instance' : e.trust === 'trusted' ? 'Signed · trusted key' : e.trust === 'untrusted' ? 'Signed · unknown key' : 'Signed'
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; icon: React.ReactNode; label: string }> = {
    succeeded: { bg: 'var(--status-success-bg)', fg: 'var(--theme-success)', icon: <CheckCircle2 size={12} />, label: 'Succeeded' },
    partial: { bg: 'var(--status-warning-bg)', fg: 'var(--theme-warning)', icon: <AlertTriangle size={12} />, label: 'Partial' },
    failed: { bg: 'var(--status-danger-bg, var(--status-warning-bg))', fg: 'var(--theme-danger)', icon: <XCircle size={12} />, label: 'Failed' },
  }
  const s = map[status] ?? map.succeeded
  return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: s.bg, color: s.fg }}>{s.icon}{s.label}</span>
}

const actorText = (e: { actor: { name: string | null; email: string | null } | null; channel: string }) =>
  e.actor?.name ?? e.actor?.email ?? (e.channel === 'api' || e.channel === 'cli' ? 'API key' : 'System')

export function PackageHistory({ filters, onFiltersChange, packages }: {
  filters: HistoryFilters
  onFiltersChange: (filters: HistoryFilters) => void
  /** Package options for the filter (installed now, plus any seen in the history). */
  packages: Array<{ value: string; label: string }>
}) {
  const [page, setPage] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const jobs = useJobs()
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clean = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as HistoryFilters, [filters])
  const events = useQuery({
    queryKey: ['package-events', clean, page],
    queryFn: async () => { const r = await listPackageEventsAction(clean, { limit: PAGE, offset: page * PAGE }); if (!r.ok) throw new Error(r.error); return r.data },
  })
  const set = (patch: HistoryFilters) => { setPage(0); onFiltersChange({ ...filters, ...patch }) }
  const seen = new Map<string, string>(packages.map((p) => [p.value, p.label]))
  for (const e of events.data?.events ?? []) if (e.package_uid && !seen.has(e.package_uid)) seen.set(e.package_uid, e.package_name)
  const exportCsv = async () => {
    setExporting(true)
    setError(null)
    // A `package.history_csv` job: the popup offers the file when it is ready.
    try {
      await jobs.start('package.history_csv', clean, { effect: 'download', pendingMessage: 'Preparing the history CSV…' })
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start the export')
    } finally {
      setExporting(false)
    }
  }
  const total = events.data?.total ?? 0
  const select = 'h-8 rounded-md border px-2 text-sm'
  const selectStyle = { ...border, backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }

  return (
    <div className="space-y-3" data-testid="package-history">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs" style={muted}>Package<br />
          <select className={select} style={selectStyle} value={filters.package ?? ''} onChange={(e) => set({ package: e.target.value || undefined })} data-testid="history-filter-package">
            <option value="">All packages</option>
            {[...seen].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-xs" style={muted}>Action<br />
          <select className={select} style={selectStyle} value={filters.action ?? ''} onChange={(e) => set({ action: e.target.value || undefined })} data-testid="history-filter-action">
            <option value="">All actions</option>
            {Object.entries(ACTION_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-xs" style={muted}>Status<br />
          <select className={select} style={selectStyle} value={filters.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}>
            <option value="">Any status</option>
            <option value="succeeded">Succeeded</option>
            <option value="partial">Partial</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label className="text-xs" style={muted}>User (email)<br />
          <Input className="h-8 text-sm w-48" placeholder="name@example.com" defaultValue={filters.actor ?? ''} onBlur={(e) => set({ actor: e.target.value.trim() || undefined })} onKeyDown={(e) => { if (e.key === 'Enter') set({ actor: (e.target as HTMLInputElement).value.trim() || undefined }) }} />
        </label>
        <label className="text-xs" style={muted}>From<br />
          <Input type="date" className="h-8 text-sm" value={filters.since ?? ''} onChange={(e) => set({ since: e.target.value || undefined })} />
        </label>
        <label className="text-xs" style={muted}>To<br />
          <Input type="date" className="h-8 text-sm" value={filters.until ?? ''} onChange={(e) => set({ until: e.target.value || undefined })} />
        </label>
        <div className="ml-auto flex gap-2">
          {Object.keys(clean).length > 0 && <Button size="sm" variant="ghost" onClick={() => { setPage(0); onFiltersChange({}) }}>Clear filters</Button>}
          <Button size="sm" variant="outline" onClick={() => void exportCsv()} disabled={exporting || total === 0} data-testid="history-export"><Download size={13} /> {exporting ? 'Exporting…' : 'Export CSV'}</Button>
        </div>
      </div>
      {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} />}
      {events.error && <InlineNotice tone="error" message={(events.error as Error).message} />}

      {events.data && events.data.events.length === 0 ? (
        <Card>
          <p className="text-sm font-medium flex items-center gap-2"><History size={15} /> No history{Object.keys(clean).length ? ' for these filters' : ' yet'}</p>
          <p className="text-xs mt-1" style={muted}>Every install, upgrade, setup change and uninstall is recorded here — including attempts that failed.</p>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-x-auto" style={border}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ ...muted, backgroundColor: 'var(--theme-surface)' }}>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Package</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Version</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">By</th>
                <th className="px-3 py-2 font-medium">Items</th>
              </tr>
            </thead>
            <tbody>
              {(events.data?.events ?? []).map((e) => (
                <tr key={e.id} className="border-t cursor-pointer hover:bg-[var(--theme-surface)]" style={border} onClick={() => setOpenId(e.id)} data-testid="history-row">
                  <td className="px-3 py-2 whitespace-nowrap" title={new Date(e.created_at).toLocaleString()}>{formatRelativeDate(e.created_at)}</td>
                  <td className="px-3 py-2"><span className="font-medium">{e.package_name}</span></td>
                  <td className="px-3 py-2 whitespace-nowrap">{ACTION_LABEL[e.action] ?? e.action}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{versionText(e)}</td>
                  <td className="px-3 py-2"><StatusPill status={e.status} /></td>
                  <td className="px-3 py-2 whitespace-nowrap">{actorText(e)} <span className="text-xs" style={muted}>· {CHANNEL_LABEL[e.channel] ?? e.channel}</span></td>
                  <td className="px-3 py-2 text-xs" style={muted}>{e.status === 'failed' ? <span style={{ color: 'var(--theme-danger)' }} className="line-clamp-1">{e.error}</span> : countsText(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > PAGE && (
        <div className="flex items-center justify-end gap-2 text-xs" style={muted}>
          {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
      <EventDrawer eventId={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs" style={muted}>{label}</dt>
      <dd className="text-sm mt-0.5">{children}</dd>
    </div>
  )
}

const PLAN_COLOR: Record<string, string> = {
  create: 'var(--theme-success)', update: 'var(--theme-warning)', unchanged: 'var(--theme-muted-text)', error: 'var(--theme-danger)',
  delete: 'var(--theme-danger)', skip: 'var(--theme-muted-text)', gone: 'var(--theme-muted-text)',
}
const fmt = (value: unknown) => (value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value))

function EventDrawer({ eventId, onClose }: { eventId: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['package-event', eventId],
    queryFn: async () => { const r = await getPackageEventAction(eventId!); if (!r.ok) throw new Error(r.error); return r.data },
    enabled: Boolean(eventId),
  })
  const e = detail.data
  const plan: any = e?.plan ?? null
  const installAssets: any[] = Array.isArray(plan?.plan?.assets) ? plan.plan.assets : []
  const uninstallEntries: any[] = e?.action === 'uninstall' && Array.isArray(plan?.plan) ? plan.plan : []
  const removedUpstream: any[] = Array.isArray(plan?.removed_upstream) ? plan.removed_upstream : []
  const warnings: any[] = Array.isArray(plan?.warnings) ? plan.warnings : []
  const rows: any[] = Array.isArray(plan?.result?.rows) ? plan.result.rows : []
  const activeRuns: any[] = Array.isArray(plan?.active_runs) ? plan.active_runs : []
  const options = Object.entries(e?.options ?? {}).filter(([, v]) => v !== false && !(Array.isArray(v) && !v.length))

  return (
    <Dialog.Root open={Boolean(eventId)} onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 dialog-overlay" />
        <Dialog.Content className="fixed right-0 top-0 z-50 h-full w-[min(40rem,100vw)] overflow-y-auto p-6 shadow-xl" style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }} data-testid="history-drawer">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <Dialog.Title className="text-lg font-semibold">{e ? `${ACTION_LABEL[e.action] ?? e.action} ${e.package_name}` : 'Loading…'}</Dialog.Title>
              {e && <Dialog.Description className="text-xs mt-0.5" style={muted}>{new Date(e.created_at).toLocaleString()} · {e.id}</Dialog.Description>}
            </div>
            <Dialog.Close aria-label="Close" className="opacity-60 hover:opacity-100"><X size={16} /></Dialog.Close>
          </div>
          {detail.error && <InlineNotice tone="error" message={(detail.error as Error).message} />}
          {e && (
            <div className="space-y-5">
              <div className="flex items-center gap-2"><StatusPill status={e.status} />{e.summary && <span className="text-sm">{e.summary}</span>}</div>
              {e.error && <InlineNotice tone="error" message={e.error} />}
              {e.backfilled && <p className="text-xs" style={muted}>Reconstructed from the audit log when package history was introduced — the plan was not recorded.</p>}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Version">{versionText(e) || '—'}</Field>
                <Field label="By">{actorText(e)}{e.actor?.email && e.actor?.name ? <span className="text-xs" style={muted}> · {e.actor.email}</span> : null}</Field>
                <Field label="Via">{CHANNEL_LABEL[e.channel] ?? e.channel}</Field>
                <Field label="Source">{e.source ? `${SOURCE_LABEL[e.source] ?? e.source}${e.source_label ? ` · ${e.source_label}` : ''}` : '—'}</Field>
                <Field label="Signature">{signatureText(e)}{e.fingerprint ? <code className="block text-[10px] mt-0.5 break-all" style={muted}>{e.fingerprint}</code> : null}</Field>
                <Field label="Items">{countsText(e)}</Field>
              </dl>
              {options.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={muted}>Options</p>
                  <div className="flex flex-wrap gap-1.5">{options.map(([k, v]) => <code key={k} className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--theme-surface)' }}>{k}{v === true ? '' : `=${fmt(v)}`}</code>)}</div>
                </div>
              )}
              {(e.requirement_changes ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={muted}>Requirement changes</p>
                  <ul className="text-sm space-y-0.5">
                    {(e.requirement_changes as any[]).map((r) => <li key={r.id}>{r.label}: <span style={muted}>{r.before ?? 'new'} → </span><span style={{ color: r.after === 'missing' ? 'var(--theme-warning)' : r.after === 'met' ? 'var(--theme-success)' : undefined }}>{r.after ?? 'removed'}</span></li>)}
                  </ul>
                </div>
              )}
              {(e.errors ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={muted}>Errors</p>
                  <ul className="text-xs space-y-0.5" style={{ color: 'var(--theme-danger)' }}>{(e.errors as any[]).map((err, i) => <li key={i}>{err.section ?? err.asset_type ?? ''} {err.name ?? err.local_id ?? ''}: {err.error}</li>)}</ul>
                </div>
              )}
              {installAssets.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={muted}>Plan applied</p>
                  <div className="rounded-lg border divide-y text-sm" style={border} data-testid="history-plan">
                    {installAssets.map((a, i) => (
                      <div key={`${a.section}:${a.source_id ?? i}`} className="px-3 py-2" style={border}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold w-16 shrink-0 capitalize" style={{ color: PLAN_COLOR[a.action] }}>{a.action}</span>
                          <span className="text-xs w-28 shrink-0" style={muted}>{String(a.section).replace(/_/g, ' ')}</span>
                          <span className="truncate">{a.name}</span>
                          {a.skipped && <span className="text-[10px] px-1.5 rounded" style={{ backgroundColor: 'var(--theme-surface)', ...muted }}>{a.skipped}</span>}
                          {a.locally_modified && !a.skipped && <span className="text-[10px] px-1.5 rounded" style={{ backgroundColor: 'var(--status-warning-bg)', color: 'var(--theme-warning)' }}>changed here</span>}
                        </div>
                        {Array.isArray(a.diffs) && a.diffs.length > 0 && (
                          <ul className="text-xs mt-1 ml-[4.5rem] space-y-0.5 font-mono">
                            {a.diffs.map((d: any) => (
                              <li key={d.path} className="break-all"><span style={muted}>{d.path}:</span> {d.before !== undefined && <span style={{ color: 'var(--theme-danger)' }}>{fmt(d.before).slice(0, 120)}</span>}{d.before !== undefined && d.after !== undefined && ' → '}{d.after !== undefined && <span style={{ color: 'var(--theme-success)' }}>{fmt(d.after).slice(0, 120)}</span>}</li>
                            ))}
                            {a.diffs_truncated && <li style={muted}>… more changes not shown</li>}
                          </ul>
                        )}
                      </div>
                    ))}
                    {removedUpstream.map((r) => (
                      <div key={`removed:${r.source_id}`} className="px-3 py-2 text-sm" style={border}><span className="text-xs font-semibold w-16 inline-block" style={muted}>kept</span><span className="text-xs w-28 inline-block" style={muted}>{String(r.section).replace(/_/g, ' ')}</span>{r.name} <span className="text-xs" style={muted}>— no longer in this version</span></div>
                    ))}
                  </div>
                </div>
              )}
              {uninstallEntries.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={muted}>Artifacts</p>
                  <div className="rounded-lg border divide-y text-sm" style={border} data-testid="history-plan">
                    {uninstallEntries.map((p) => (
                      <div key={`${p.section}:${p.local_id}`} className="px-3 py-1.5 flex gap-2 items-center" style={border}>
                        <span className="text-xs font-semibold w-16 shrink-0" style={{ color: PLAN_COLOR[p.action] }}>{p.action === 'delete' ? 'Removed' : p.action === 'skip' ? 'Kept' : 'Gone'}</span>
                        <span className="text-xs w-28 shrink-0" style={muted}>{String(p.section).replace(/_/g, ' ')}</span>
                        <span className="truncate">{p.name}</span>
                        <span className="text-xs ml-auto shrink-0 text-right" style={muted}>{[friendlyReason(p.reason), p.action === 'delete' && p.rows ? `${p.rows} rows` : ''].filter(Boolean).join(' · ')}</span>
                      </div>
                    ))}
                  </div>
                  {activeRuns.length > 0 && <p className="text-xs mt-2" style={muted}>{activeRuns.length} unfinished run{activeRuns.length === 1 ? '' : 's'} {e.status === 'failed' ? 'blocked it' : 'cancelled'}.</p>}
                </div>
              )}
              {rows.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={muted}>Table rows</p>
                  <ul className="text-sm space-y-0.5">{rows.map((r) => <li key={r.table_id}>{r.name}: {r.skipped ? 'skipped' : `${r.inserted} added, ${r.updated} updated${r.deleted ? `, ${r.deleted} deleted` : ''} (${r.mode})`}{r.error ? <span style={{ color: 'var(--theme-danger)' }}> — {r.error}</span> : null}</li>)}</ul>
                </div>
              )}
              {warnings.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={muted}>Warnings</p>
                  <ul className="text-xs space-y-0.5" style={{ color: 'var(--theme-warning)' }}>{warnings.map((w, i) => <li key={i}>{w.warning}</li>)}</ul>
                </div>
              )}
              {plan && (
                <details className="text-xs">
                  <summary className="cursor-pointer" style={muted}>Raw plan (JSON)</summary>
                  <div className="flex justify-end my-1"><Button size="sm" variant="ghost" onClick={() => saveText(`package-event-${e.id}.json`, JSON.stringify(e, null, 2), 'application/json')}><Download size={12} /> JSON</Button></div>
                  <pre className="whitespace-pre-wrap break-all rounded p-3 max-h-96 overflow-y-auto" style={{ backgroundColor: 'var(--theme-surface)' }}>{JSON.stringify(plan, null, 2)}</pre>
                </details>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
