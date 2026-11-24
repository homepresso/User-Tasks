'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Gauge, RefreshCw, RotateCcw } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { TableScroll } from '@/components/ui/table'
import { formatRelativeDate } from '@/lib/utils'
import { runQueryRollupsAction, updateQuerySettingsAction } from '@/app/actions/query-settings'
import type { QueryStatus } from '@/lib/services/query-settings'
import type { QueryMode, QuerySettings } from '@/lib/reports/data-source'

/**
 * Settings → Query: per service, whether report metrics read the flat
 * rollup tables or real-time queries (Auto picks the rollups when they are
 * populated and current), the short cache TTL, per-app modes and per-widget
 * overrides; the rollup coverage of this workspace with Run backfill /
 * Rebuild / Reconcile now. Reading needs View settings; changes need Edit
 * settings and are audited.
 */

type View = QueryStatus & { apps: Array<{ id: string; name: string; tenant_id?: string }> }
type Access = { cloud: boolean; canView: boolean; canEdit: boolean }
type Notice = { tone: 'success' | 'warning' | 'error'; message: string }

const QUERY_KEY = ['settings', 'query']
const muted = { color: 'var(--theme-muted-text)' }

const MODE_LABEL: Record<string, string> = { inherit: 'Inherit', auto: 'Auto', rollup: 'Flat table', live: 'Real time' }
const MODE_OPTIONS = (['auto', 'rollup', 'live'] as const).map((m) => ({ value: m, label: MODE_LABEL[m] }))
const INHERIT_OPTIONS = [{ value: 'inherit', label: 'Inherit' }, ...MODE_OPTIONS]

export function QuerySettingsPage({ access }: { access: Access }) {
  const { cloud, canView } = access
  const canEdit = access.canEdit
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: QUERY_KEY, enabled: canView, queryFn: () => serverQuery('settings.query') as Promise<View> })
  const [draft, setDraft] = useState<QuerySettings | null>(null)
  const [busy, setBusy] = useState<null | 'save' | 'backfill' | 'rebuild' | 'reconcile'>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [confirmRebuild, setConfirmRebuild] = useState(false)
  const [target, setTarget] = useState('all')

  useEffect(() => { if (data) setDraft(data.settings) }, [data])

  if (!canView) return <div className="max-w-3xl"><InlineNotice tone="warning" message="You need the View settings permission to see this page." /></div>
  if (isLoading || !data || !draft) return <PageSkeleton variant="settings" />

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings)
  const r = data.rollups as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

  async function save() {
    setBusy('save'); setNotice(null)
    try {
      const services = Object.fromEntries(Object.entries(draft!.services).map(([k, v]) => [k, v]))
      for (const k of Object.keys(data!.settings.services)) if (!(k in draft!.services)) (services as Record<string, unknown>)[k] = null
      const apps: Record<string, string | null> = { ...draft!.apps }
      for (const k of Object.keys(data!.settings.apps)) if (!(k in draft!.apps)) apps[k] = null
      const res = await updateQuerySettingsAction({ default_mode: draft!.default_mode, default_cache_ttl_seconds: draft!.default_cache_ttl_seconds, allow_widget_override: draft!.allow_widget_override, services, apps })
      if (!res.ok) { setNotice({ tone: 'error', message: res.error }); return }
      setNotice({ tone: 'success', message: 'Saved.' })
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    } finally { setBusy(null) }
  }

  async function act(action: 'backfill' | 'rebuild' | 'reconcile') {
    setBusy(action); setNotice(null); setConfirmRebuild(false)
    try {
      const res = await runQueryRollupsAction(action, cloud ? target : null)
      if (!res.ok) { setNotice({ tone: 'error', message: res.error }); return }
      const covered = cloud && res.data.target === 'all' ? 'the scheduler continues with every workspace' : res.data.rollups?.done ? 'every day is covered' : res.data.rollups?.covered_from ? `covered from ${res.data.rollups.covered_from}; the scheduler continues` : 'the scheduler continues'
      setNotice({ tone: 'success', message: `${res.data.days} day${res.data.days === 1 ? '' : 's'} rebuilt — ${covered}.` })
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    } finally { setBusy(null) }
  }

  const setService = (service: string, patch: { mode?: string; cache_ttl_seconds?: number | null }) => {
    const current = draft.services[service as keyof QuerySettings['services']] ?? { mode: 'inherit' as const, cache_ttl_seconds: null }
    setDraft({ ...draft, services: { ...draft.services, [service]: { ...current, ...patch } } })
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Gauge size={22} /> Query</h1>
        <p className="text-sm mt-1" style={muted}>
          Where report metrics come from: the <strong>flat rollup tables</strong> (per-day totals kept current as things happen) or <strong>real-time queries</strong> over every row. Permissions are the same either way.{' '}
          <Link href="/docs/self-hosting/query-settings" className="underline underline-offset-2">Docs</Link>
        </p>
      </div>

      {cloud && <InlineNotice tone="info" message="Applies to every workspace on this cloud instance. Only instance administrators can see or change this page; workspace settings are not used." />}

      {notice && <InlineNotice tone={notice.tone} message={notice.message} />}

      <Card padding="md" className="space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Database size={16} /> {cloud ? 'Rollups on this instance' : 'Rollups in this workspace'}</h2>
        {cloud && data.instance_rollups && (
          <p className="text-sm">{data.instance_rollups.backfilled} of {data.instance_rollups.tenants} workspaces backfilled{data.instance_rollups.in_progress ? `, ${data.instance_rollups.in_progress} in progress` : ''}{data.instance_rollups.not_started ? `, ${data.instance_rollups.not_started} not started` : ''} · {data.instance_rollups.dirty_ranges} queued rebuild{data.instance_rollups.dirty_ranges === 1 ? '' : 's'}. Your current workspace:</p>
        )}
        {!r.installed ? (
          <InlineNotice tone="warning" message="The rollup tables are not installed on this database yet (migration 20270123100000). Every report reads real time." />
        ) : (
          <ul className="text-sm space-y-1">
            <li>Coverage: {r.done ? 'every day' : r.covered_from ? `from ${r.covered_from} (backfill in progress back to ${r.oldest_day ?? '—'}; older periods read real time)` : 'backfill not started yet — reports read real time'}</li>
            <li>Queued rebuilds: {r.dirty_ranges ?? 0}{(r.dirty_ranges ?? 0) > 0 ? ' (Auto reads real time until they are done)' : ''}</li>
            <li>Last rebuild: {r.last_refresh_at ? formatRelativeDate(r.last_refresh_at) : 'never'} · Last reconcile: {r.last_reconciled_at ? formatRelativeDate(r.last_reconciled_at) : 'never'} (every {data.reconcile_every_minutes} min: today and yesterday) · Newest update: {r.newest_delta_at ? formatRelativeDate(r.newest_delta_at) : '—'}</li>
            {!r.enabled && <li><InlineNotice tone="warning" message="REPORT_ROLLUPS=off on this instance: every read is real time." /></li>}
          </ul>
        )}
        {canEdit && r.installed && (
          <div className="flex flex-wrap gap-2 items-center">
            {cloud && (
              <Select size="sm" wrapperClassName="w-64" value={target} aria-label="Workspaces to act on" onChange={(e) => setTarget(e.target.value)}
                options={[{ value: 'all', label: 'All workspaces' }, ...(data.instance_rollups?.tenants_detail ?? []).map((t) => ({ value: t.tenant_id, label: t.name }))]} />
            )}
            <Button size="sm" variant="secondary" leadingIcon={<RefreshCw />} disabled={busy !== null} onClick={() => act('backfill')}>{busy === 'backfill' ? 'Running…' : 'Run backfill'}</Button>
            <Button size="sm" variant="secondary" leadingIcon={<RefreshCw />} disabled={busy !== null} onClick={() => act('reconcile')}>{busy === 'reconcile' ? 'Reconciling…' : 'Reconcile now'}</Button>
            <Button size="sm" variant="secondary" leadingIcon={<RotateCcw />} disabled={busy !== null} onClick={() => setConfirmRebuild(true)}>Rebuild rollups</Button>
          </div>
        )}
      </Card>

      <Card padding="md" className="space-y-4">
        <h2 className="font-semibold">{cloud ? 'Default for every workspace' : 'Workspace default'}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1 text-sm"><span className="font-medium">Data source</span>
            <Select size="sm" value={draft.default_mode} disabled={!canEdit} options={MODE_OPTIONS} onChange={(e) => setDraft({ ...draft, default_mode: e.target.value as QueryMode })} />
            <span className="block text-xs" style={muted}>Auto: flat tables when they are populated and current, else real time. Real time is always the fallback.</span>
          </label>
          <label className="block space-y-1 text-sm"><span className="font-medium">Cache (seconds, 0 = off)</span>
            <Input size="sm" type="number" min={0} max={300} value={draft.default_cache_ttl_seconds} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, default_cache_ttl_seconds: Math.max(0, Math.min(300, Math.round(Number(e.target.value) || 0))) })} />
          </label>
        </div>
        <Switch checked={draft.allow_widget_override} disabled={!canEdit} onCheckedChange={(v) => setDraft({ ...draft, allow_widget_override: v })} label={cloud ? 'Allow per-app and per-widget data sources (app editors see the widget control)' : 'Allow app editors to choose a data source per widget'} />
      </Card>

      <Card padding="md" className="space-y-3">
        <h2 className="font-semibold">Services</h2>
        <TableScroll>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs" style={muted}><th className="py-1 pr-2">Service</th><th className="pr-2">Data source</th><th className="pr-2">Cache (s)</th><th className="pr-2">Now reading</th><th>Median read (flat / real time)</th></tr></thead>
            <tbody>
              {data.services.map((s) => {
                const setting = draft.services[s.service] ?? { mode: 'inherit', cache_ttl_seconds: null }
                const t = s.timings
                return (
                  <tr key={s.service} className="border-t" style={{ borderColor: 'var(--theme-surface-border)' }}>
                    <td className="py-2 pr-2 align-top"><div className="font-medium">{s.label}</div><div className="text-xs" style={muted}>{s.description}</div></td>
                    <td className="pr-2 align-top">
                      {s.rollups
                        ? <Select size="sm" value={setting.mode} disabled={!canEdit} options={INHERIT_OPTIONS} onChange={(e) => setService(s.service, { mode: e.target.value })} aria-label={`${s.label} data source`} />
                        : <span className="text-xs" title={s.why ?? undefined}>Real time only — {s.why}</span>}
                    </td>
                    <td className="pr-2 align-top w-24"><Input size="sm" type="number" min={0} max={300} placeholder={String(draft.default_cache_ttl_seconds)} value={setting.cache_ttl_seconds ?? ''} disabled={!canEdit} onChange={(e) => setService(s.service, { cache_ttl_seconds: e.target.value === '' ? null : Math.max(0, Math.min(300, Math.round(Number(e.target.value) || 0))) })} aria-label={`${s.label} cache seconds`} /></td>
                    <td className="pr-2 align-top whitespace-nowrap">{s.current_path === 'rollup' ? 'Flat table' : 'Real time'}<div className="text-xs" style={muted}>{MODE_LABEL[s.effective.mode]} ({s.effective.level})</div></td>
                    <td className="align-top whitespace-nowrap text-xs">{t.rollup ? `${t.rollup.median_ms} ms (${t.rollup.samples})` : '—'} / {t.live ? `${t.live.median_ms} ms (${t.live.samples})` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableScroll>
        <p className="text-xs" style={muted}>Read times are the recent reads answered by this server since it started.</p>
      </Card>

      {data.apps.length > 0 && (
        <Card padding="md" className="space-y-3">
          <h2 className="font-semibold">Apps</h2>
          <p className="text-xs" style={muted}>Overrides App widgets for one app (and its widgets{draft.allow_widget_override ? ', unless a widget chooses its own' : ''}).{cloud && !draft.allow_widget_override ? ' On the cloud edition these apply only while per-app and per-widget data sources are allowed above.' : ''}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.apps.map((app) => (
              <label key={app.id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{app.name}</span>
                <Select size="sm" wrapperClassName="w-40" value={draft.apps[app.id] ?? 'inherit'} disabled={!canEdit} options={INHERIT_OPTIONS} aria-label={`${app.name} data source`}
                  onChange={(e) => { const apps = { ...draft.apps }; if (e.target.value === 'inherit') delete apps[app.id]; else apps[app.id] = e.target.value as QueryMode; setDraft({ ...draft, apps }) }} />
              </label>
            ))}
          </div>
        </Card>
      )}

      {canEdit && (
        <div className="flex gap-2">
          <Button disabled={!dirty || busy !== null} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
          <Button variant="secondary" disabled={!dirty || busy !== null} onClick={() => setDraft(data.settings)}>Discard</Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmRebuild}
        onOpenChange={setConfirmRebuild}
        title="Rebuild the rollups?"
        description={cloud && target === 'all' ? 'Every workspace is rebuilt from the raw rows, newest days first. Until the rebuild reaches a period, reports for it read real time (slower, same numbers).' : 'Every day is rebuilt from the raw rows, newest first. Until the rebuild reaches a period, reports for it read real time (slower, same numbers).'}
        confirmLabel="Rebuild"
        onConfirm={() => act('rebuild')}
      />
    </div>
  )
}
