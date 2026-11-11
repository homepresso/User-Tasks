'use client'

/**
 * Package history: the timeline of every install, upgrade, reinstall,
 * downgrade, reconfigure (Complete setup) and uninstall in this workspace,
 * failed attempts included. Filters (package, action, status, user, dates),
 * a detail sheet with the plan / diff that was applied, and CSV export.
 * Reads lib/services/package-events through the packages server actions.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatAbsolute, formatDateTime, formatRelative } from '@/lib/format/date'
import { Button } from '@/components/ui/button'
import { Badge, StatusPill as UiStatusPill, Tag, type Tone } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Tooltip } from '@/components/ui/tooltip'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/list-controls'
import { Table, THead, TBody, TR, TH, TD, Truncate } from '@/components/ui/table'
import { InlineNotice } from '@/components/ui/inline-notice'
import { getPackageEventAction, listPackageEventsAction } from '@/app/actions/packages'
import { useJobs } from '@/components/jobs/jobs-provider'
import { friendlyReason } from './uninstall-dialog'

/* eslint-disable @typescript-eslint/no-explicit-any -- stored plans are free-form JSON */

type EventRow = Extract<Awaited<ReturnType<typeof listPackageEventsAction>>, { ok: true }>['data']['events'][number]
export interface HistoryFilters { package?: string; action?: string; status?: string; actor?: string; since?: string; until?: string }

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


const STATUS: Record<string, { tone: Tone; label: string }> = {
  succeeded: { tone: 'success', label: 'Succeeded' },
  partial: { tone: 'warning', label: 'Partial' },
  failed: { tone: 'danger', label: 'Failed' },
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.succeeded
  return <UiStatusPill status={status} tone={s.tone} label={s.label} />
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
  const filtered = Object.keys(clean).length > 0

  return (
    <div className="space-y-3" data-testid="package-history">
      <div className="flex flex-wrap items-center gap-2">
        <Select size="sm" wrapperClassName="w-auto" aria-label="Package" value={filters.package ?? ''} onChange={(e) => set({ package: e.target.value || undefined })} data-testid="history-filter-package"
          options={[{ value: '', label: 'All packages' }, ...[...seen].map(([value, label]) => ({ value, label }))]} />
        <Select size="sm" wrapperClassName="w-auto" aria-label="Action" value={filters.action ?? ''} onChange={(e) => set({ action: e.target.value || undefined })} data-testid="history-filter-action"
          options={[{ value: '', label: 'All actions' }, ...Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label }))]} />
        <Select size="sm" wrapperClassName="w-auto" aria-label="Status" value={filters.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}
          options={[{ value: '', label: 'Any status' }, { value: 'succeeded', label: 'Succeeded' }, { value: 'partial', label: 'Partial' }, { value: 'failed', label: 'Failed' }]} />
        <Input size="sm" className="w-48" aria-label="User (email)" placeholder="User email" defaultValue={filters.actor ?? ''} onBlur={(e) => set({ actor: e.target.value.trim() || undefined })} onKeyDown={(e) => { if (e.key === 'Enter') set({ actor: (e.target as HTMLInputElement).value.trim() || undefined }) }} />
        <span className="flex items-center gap-1 text-xs text-fg-muted">
          <Input size="sm" type="date" className="num w-36" aria-label="From" value={filters.since ?? ''} onChange={(e) => set({ since: e.target.value || undefined })} />
          to
          <Input size="sm" type="date" className="num w-36" aria-label="To" value={filters.until ?? ''} onChange={(e) => set({ until: e.target.value || undefined })} />
        </span>
        <div className="ml-auto flex items-center gap-2">
          {filtered && <Button size="sm" variant="ghost" onClick={() => { setPage(0); onFiltersChange({}) }}>Clear filters</Button>}
          <Button size="sm" variant="secondary" leadingIcon={<Download />} onClick={() => void exportCsv()} loading={exporting} disabled={total === 0} data-testid="history-export">Export CSV</Button>
        </div>
      </div>
      {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} />}
      {events.error && <InlineNotice tone="error" message={(events.error as Error).message} />}

      {events.data && events.data.events.length === 0 ? (
        <Card padding="none">
          <EmptyState size="sm" icon={History} variant={filtered ? 'no-results' : 'first-run'}
            title={filtered ? 'No history for these filters' : 'No history yet'}
            description="Every install, upgrade, setup change and uninstall is recorded here — including attempts that failed."
            action={filtered ? { label: 'Clear filters', onClick: () => { setPage(0); onFiltersChange({}) } } : undefined} />
        </Card>
      ) : (
        <Table label="Package history">
          <THead>
            <tr>
              <TH col="date">When</TH>
              <TH col="name">Package</TH>
              <TH col="status">Action</TH>
              <TH>Version</TH>
              <TH col="status">Status</TH>
              <TH col="people">By</TH>
              <TH col="text">Items</TH>
            </tr>
          </THead>
          <TBody>
            {(events.data?.events ?? []).map((e) => (
              <TR key={e.id} interactive onClick={() => setOpenId(e.id)} data-testid="history-row">
                <TD className="num whitespace-nowrap text-fg-muted"><Tooltip content={formatAbsolute(e.created_at)}><span>{formatRelative(e.created_at)}</span></Tooltip></TD>
                <TD className="max-w-0 font-medium"><Truncate text={e.package_name} /></TD>
                <TD className="whitespace-nowrap">{ACTION_LABEL[e.action] ?? e.action}</TD>
                <TD className="whitespace-nowrap font-mono text-xs">{versionText(e)}</TD>
                <TD><StatusPill status={e.status} /></TD>
                <TD className="whitespace-nowrap">{actorText(e)} <span className="text-xs text-fg-muted">· {CHANNEL_LABEL[e.channel] ?? e.channel}</span></TD>
                <TD className="num max-w-[18rem] text-xs text-fg-muted">{e.status === 'failed' ? <span className="line-clamp-1 text-danger">{e.error}</span> : <span className="block truncate">{countsText(e)}</span>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Pagination page={page + 1} pageSize={PAGE} total={total} onPageChange={(p) => setPage(p - 1)} noun="events" />
      <EventDrawer eventId={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-ui text-fg">{children}</dd>
    </div>
  )
}

const PLAN_TONE: Record<string, Tone> = {
  create: 'success', update: 'warning', unchanged: 'neutral', error: 'danger', delete: 'danger', skip: 'neutral', gone: 'neutral',
}
const fmt = (value: unknown) => (value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value))

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-ui font-medium text-fg">{title}</h3>
      {children}
    </section>
  )
}

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
    <Sheet open={Boolean(eventId)} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent size="lg" data-testid="history-drawer"
        title={e ? `${ACTION_LABEL[e.action] ?? e.action} ${e.package_name}` : 'Loading…'}
        description={e ? <span className="num">{formatDateTime(e.created_at)} · <span className="font-mono">{e.id}</span></span> : undefined}>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4 scrollbar-thin">
          {detail.error && <InlineNotice tone="error" message={(detail.error as Error).message} />}
          {e && (
            <div className="space-y-6">
              <div className="flex items-center gap-2"><StatusPill status={e.status} />{e.summary && <span className="text-ui text-fg">{e.summary}</span>}</div>
              {e.error && <InlineNotice tone="error" message={e.error} />}
              {e.backfilled && <p className="text-xs text-fg-muted">Reconstructed from the audit log when package history was introduced — the plan was not recorded.</p>}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Version"><span className="font-mono text-xs">{versionText(e) || '—'}</span></Field>
                <Field label="By">{actorText(e)}{e.actor?.email && e.actor?.name ? <span className="text-xs text-fg-muted"> · {e.actor.email}</span> : null}</Field>
                <Field label="Via">{CHANNEL_LABEL[e.channel] ?? e.channel}</Field>
                <Field label="Source">{e.source ? `${SOURCE_LABEL[e.source] ?? e.source}${e.source_label ? ` · ${e.source_label}` : ''}` : '—'}</Field>
                <Field label="Signature">{signatureText(e)}{e.fingerprint ? <code className="mt-0.5 block break-all font-mono text-2xs text-fg-muted">{e.fingerprint}</code> : null}</Field>
                <Field label="Items">{countsText(e)}</Field>
              </dl>
              {options.length > 0 && (
                <Section title="Options">
                  <div className="flex flex-wrap gap-1.5">{options.map(([k, v]) => <Tag key={k} mono>{k}{v === true ? '' : `=${fmt(v)}`}</Tag>)}</div>
                </Section>
              )}
              {(e.requirement_changes ?? []).length > 0 && (
                <Section title="Requirement changes">
                  <ul className="space-y-0.5 text-ui text-fg">
                    {(e.requirement_changes as any[]).map((r) => <li key={r.id}>{r.label}: <span className="text-fg-muted">{r.before ?? 'new'} → </span><span className={cn(r.after === 'missing' && 'text-warning', r.after === 'met' && 'text-success')}>{r.after ?? 'removed'}</span></li>)}
                  </ul>
                </Section>
              )}
              {(e.errors ?? []).length > 0 && (
                <Section title="Errors">
                  <ul className="space-y-0.5 text-xs text-danger">{(e.errors as any[]).map((err, i) => <li key={i}>{err.section ?? err.asset_type ?? ''} {err.name ?? err.local_id ?? ''}: {err.error}</li>)}</ul>
                </Section>
              )}
              {installAssets.length > 0 && (
                <Section title="Plan applied">
                  <div className="divide-y divide-border-subtle rounded-lg border border-border text-ui" data-testid="history-plan">
                    {installAssets.map((a, i) => (
                      <div key={`${a.section}:${a.source_id ?? i}`} className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="w-20 shrink-0"><Badge tone={PLAN_TONE[a.action] ?? 'neutral'}><span className="first-letter:uppercase">{a.action}</span></Badge></span>
                          <span className="w-28 shrink-0 text-xs text-fg-muted first-letter:uppercase">{String(a.section).replace(/_/g, ' ')}</span>
                          <span className="truncate text-fg">{a.name}</span>
                          {a.skipped && <Badge>{a.skipped}</Badge>}
                          {a.locally_modified && !a.skipped && <Badge tone="warning">Changed here</Badge>}
                        </div>
                        {Array.isArray(a.diffs) && a.diffs.length > 0 && (
                          <ul className="mt-1.5 space-y-0.5 rounded-md bg-subtle p-2 font-mono text-xs">
                            {a.diffs.map((d: any) => (
                              <li key={d.path} className="break-all"><span className="text-fg-muted">{d.path}:</span> {d.before !== undefined && <span className="text-danger">{fmt(d.before).slice(0, 120)}</span>}{d.before !== undefined && d.after !== undefined && ' → '}{d.after !== undefined && <span className="text-success">{fmt(d.after).slice(0, 120)}</span>}</li>
                            ))}
                            {a.diffs_truncated && <li className="text-fg-muted">… more changes not shown</li>}
                          </ul>
                        )}
                      </div>
                    ))}
                    {removedUpstream.map((r) => (
                      <div key={`removed:${r.source_id}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <span className="w-20 shrink-0"><Badge>Kept</Badge></span>
                        <span className="w-28 shrink-0 text-xs text-fg-muted first-letter:uppercase">{String(r.section).replace(/_/g, ' ')}</span>
                        <span className="text-fg">{r.name}</span> <span className="text-xs text-fg-muted">— no longer in this version</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
              {uninstallEntries.length > 0 && (
                <Section title="Artifacts">
                  <div className="divide-y divide-border-subtle rounded-lg border border-border text-ui" data-testid="history-plan">
                    {uninstallEntries.map((p) => (
                      <div key={`${p.section}:${p.local_id}`} className="flex items-center gap-2 px-3 py-1.5">
                        <span className="w-20 shrink-0"><Badge tone={PLAN_TONE[p.action] ?? 'neutral'}>{p.action === 'delete' ? 'Removed' : p.action === 'skip' ? 'Kept' : 'Gone'}</Badge></span>
                        <span className="w-28 shrink-0 text-xs text-fg-muted first-letter:uppercase">{String(p.section).replace(/_/g, ' ')}</span>
                        <span className="truncate text-fg">{p.name}</span>
                        <span className="ml-auto shrink-0 text-right text-xs text-fg-muted">{[friendlyReason(p.reason), p.action === 'delete' && p.rows ? `${p.rows} rows` : ''].filter(Boolean).join(' · ')}</span>
                      </div>
                    ))}
                  </div>
                  {activeRuns.length > 0 && <p className="mt-2 text-xs text-fg-muted">{activeRuns.length} unfinished run{activeRuns.length === 1 ? '' : 's'} {e.status === 'failed' ? 'blocked it' : 'cancelled'}.</p>}
                </Section>
              )}
              {rows.length > 0 && (
                <Section title="Table rows">
                  <ul className="num space-y-0.5 text-ui text-fg">{rows.map((r) => <li key={r.table_id}>{r.name}: {r.skipped ? 'skipped' : `${r.inserted} added, ${r.updated} updated${r.deleted ? `, ${r.deleted} deleted` : ''} (${r.mode})`}{r.error ? <span className="text-danger"> — {r.error}</span> : null}</li>)}</ul>
                </Section>
              )}
              {warnings.length > 0 && (
                <Section title="Warnings">
                  <ul className="space-y-0.5 text-xs text-warning">{warnings.map((w, i) => <li key={i}>{w.warning}</li>)}</ul>
                </Section>
              )}
              {plan && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-ui text-fg-muted hover:text-fg">Raw plan (JSON)</summary>
                  <div className="my-1 flex justify-end"><Button size="sm" variant="ghost" leadingIcon={<Download />} onClick={() => saveText(`package-event-${e.id}.json`, JSON.stringify(e, null, 2), 'application/json')}>JSON</Button></div>
                  <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-subtle p-3 font-mono text-xs text-fg scrollbar-thin">{JSON.stringify(plan, null, 2)}</pre>
                </details>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
