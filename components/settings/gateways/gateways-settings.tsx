'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronRight, Copy, Network, Plus, ShieldOff, Trash2 } from 'lucide-react'
import { usePermissions } from '@/lib/permissions-context'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { formatRelativeDate } from '@/lib/utils'
import {
  addGatewayInstanceAction,
  createGatewayAction,
  getGatewayAction,
  listGatewaysAction,
  revokeGatewayAction,
  revokeGatewayInstanceAction,
  type GatewayList,
  type GatewayRegistration,
} from '@/app/actions/gateways'

const QUERY_KEY = ['gateways']

type Gateway = GatewayList['gateways'][number]
type Notice = { tone: 'success' | 'warning' | 'error'; message: string }

const STATE_LABEL: Record<Gateway['state'], { label: string; className: string }> = {
  online: { label: 'Online', className: 'bg-success-wash text-success' },
  offline: { label: 'Offline', className: 'bg-danger-wash text-danger' },
  never_connected: { label: 'Not connected yet', className: 'bg-warning-wash text-warning' },
  revoked: { label: 'Revoked', className: 'bg-muted text-fg-muted' },
}

/** Settings → On-premises gateways: create gateways, add / revoke instances, status and recent activity. */
export function GatewaysSettings() {
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const canView = can('integrations.view')
  const canEdit = can('settings.edit')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [registration, setRegistration] = useState<{ gateway: string; registration: GatewayRegistration } | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const result = await listGatewaysAction()
      if (!result.ok) throw new Error(result.error)
      return result.data
    },
    enabled: canView,
    refetchInterval: 15_000,
  })

  if (!canView) return <p className="text-sm text-fg-muted">Not authorized.</p>
  if (isLoading && !data) return <PageSkeleton variant="settings" />
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY })

  async function create() {
    setCreating(true)
    try {
      const result = await createGatewayAction({ name: newName })
      if (!result.ok) { setNotice({ tone: 'error', message: result.error }); return }
      setRegistration({ gateway: result.data.gateway.name, registration: result.data.registration as GatewayRegistration })
      setNewName('')
      void refresh()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Network size={22} /> On-premises gateways</h1>
        <p className="text-sm mt-1 text-fg-muted">
          Reach systems behind your firewall — SharePoint Server, internal APIs — without opening any inbound port. The gateway runs on
          your network (Windows service or Docker), connects out to UserTasks over HTTPS, and only reaches the addresses you list in its own
          configuration. Credentials for those systems stay on the gateway.{' '}
          <Link href="/docs/integrations/gateways" className="underline underline-offset-2">Docs</Link>
        </p>
      </div>

      {data && !data.configured && (
        <InlineNotice tone="warning" message="This server cannot sign gateway messages: set ENCRYPTION_KEY (or GATEWAY_SIGNING_KEY)." />
      )}
      {notice && <InlineNotice tone={notice.tone === 'error' ? 'danger' : notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}
      {registration && <RegistrationCard {...registration} onDismiss={() => setRegistration(null)} />}

      {canEdit && (
        <Card className="p-4">
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void create() }}>
            <label className="flex-1 min-w-[14rem] text-sm">
              <span className="block text-xs text-fg-muted mb-1">New gateway</span>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Head office" maxLength={100} />
            </label>
            <Button type="submit" size="sm" loading={creating} disabled={!newName.trim()}><Plus size={14} /> Add gateway</Button>
          </form>
        </Card>
      )}

      {(data?.gateways ?? []).length === 0 ? (
        <Card className="p-4">
          <p className="text-sm font-medium">No gateways yet</p>
          <p className="text-xs mt-1 text-fg-muted">{canEdit ? 'Add one, then install it on a server that can reach your systems.' : 'Ask a workspace admin to add one.'}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {data!.gateways.map((g) => (
            <GatewayCard key={g.id} gateway={g} canEdit={canEdit} onChanged={refresh} onNotice={setNotice}
              onRegistration={(r) => setRegistration({ gateway: g.name, registration: r })} />
          ))}
        </div>
      )}
    </div>
  )
}

function CopyLine({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-start gap-2">
      <code className="flex-1 break-all rounded bg-muted px-2 py-1 text-xs">{value}</code>
      <Button size="icon-sm" variant="ghost" aria-label="Copy" onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </Button>
    </div>
  )
}

function RegistrationCard({ gateway, registration, onDismiss }: { gateway: string; registration: GatewayRegistration; onDismiss: () => void }) {
  return (
    <Card className="p-4 space-y-3 border-warning">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">Register an instance of “{gateway}”</p>
          <p className="text-xs text-fg-muted">One-time token, valid until {new Date(registration.expires_at).toLocaleString()}. It is shown only now; the instance creates its own key and the token stops working once used.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onDismiss}>Done</Button>
      </div>
      <div className="space-y-2 text-sm">
        <p className="text-xs font-medium">Token</p><CopyLine value={registration.token} />
        <p className="text-xs font-medium">Windows (elevated PowerShell, in the extracted gateway folder)</p><CopyLine value={registration.commands.windows} />
        <p className="text-xs font-medium">Docker</p><CopyLine value={registration.commands.docker} />
      </div>
    </Card>
  )
}

function GatewayCard({ gateway, canEdit, onChanged, onNotice, onRegistration }: {
  gateway: Gateway
  canEdit: boolean
  onChanged: () => void
  onNotice: (n: Notice) => void
  onRegistration: (r: GatewayRegistration) => void
}) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<{ kind: 'gateway' } | { kind: 'instance'; id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const state = STATE_LABEL[gateway.state]
  const { data: detail } = useQuery({
    queryKey: ['gateway', gateway.id],
    queryFn: async () => {
      const r = await getGatewayAction(gateway.id)
      if (!r.ok) throw new Error(r.error)
      return r.data
    },
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  })

  async function act(fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, message: string) {
    setBusy(true)
    try {
      const r = await fn()
      if (!r.ok) onNotice({ tone: 'error', message: r.error })
      else onNotice({ tone: 'success', message })
      onChanged()
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  async function addInstance() {
    setBusy(true)
    try {
      const r = await addGatewayInstanceAction(gateway.id, null)
      if (!r.ok) onNotice({ tone: 'error', message: r.error })
      else onRegistration(r.data)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const live = gateway.instances.filter((i) => i.status === 'active')
  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <button type="button" className="mt-1 text-fg-muted" onClick={() => setOpen(!open)} aria-label={open ? 'Collapse' : 'Expand'}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium truncate">{gateway.name}</span>
            <span className={`rounded px-1.5 py-0.5 text-xs ${state.className}`}>{state.label}</span>
            {gateway.instances.some((i) => i.update_available) && <span className="rounded px-1.5 py-0.5 text-xs bg-info-wash text-info">Update available ({gateway.latest_version})</span>}
          </div>
          <p className="text-xs mt-0.5 text-fg-muted">
            {live.filter((i) => i.online).length} of {live.length} instance{live.length === 1 ? '' : 's'} online
            {gateway.last_seen_at ? ` · last seen ${formatRelativeDate(gateway.last_seen_at)}` : ''}
            {gateway.targets.length ? ` · serves ${gateway.targets.map((t) => t.origin).join(', ')}` : ''}
          </p>
          {gateway.state === 'offline' && <p className="text-xs mt-1 text-danger">Gateway offline: connections through it fail until an instance reconnects.</p>}
        </div>
        {canEdit && (
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" onClick={() => void addInstance()} loading={busy}><Plus size={14} /> Add instance</Button>
            <Button size="sm" variant="danger-ghost" onClick={() => setConfirm({ kind: 'gateway' })}><ShieldOff size={14} /> Revoke</Button>
          </div>
        )}
      </div>

      {open && (
        <div className="space-y-3 border-t pt-3">
          <div>
            <p className="text-xs font-medium mb-1">Instances</p>
            <div className="space-y-1">
              {gateway.instances.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`h-2 w-2 rounded-full ${i.online ? 'bg-success' : i.status === 'pending' ? 'bg-warning' : 'bg-danger'}`} />
                  <span className="font-medium">{i.instance_name ?? i.label ?? i.id.slice(0, 8)}</span>
                  <span className="text-fg-muted">
                    {i.status === 'pending' ? `waiting for registration (token expires ${formatRelativeDate(i.token_expires_at ?? '')})` : `${i.hostname ?? ''} · v${i.version ?? '?'} · key ${i.fingerprint ?? '?'}${i.last_seen_at ? ` · seen ${formatRelativeDate(i.last_seen_at)}` : ''}${i.capacity ? ` · ${i.inflight ?? 0}/${i.capacity} busy` : ''}`}
                  </span>
                  {i.below_min_version && <span className="text-danger">too old: upgrade</span>}
                  {canEdit && (
                    <Button size="icon-sm" variant="danger-ghost" aria-label="Revoke instance" onClick={() => setConfirm({ kind: 'instance', id: i.id, name: i.instance_name ?? i.label ?? i.id })}>
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
          {detail && (
            <>
              <p className="text-xs text-fg-muted">
                Last 24 h: {detail.stats.total} requests, {detail.stats.failed} failed
                {detail.stats.p50_ms !== null ? ` · latency p50 ${detail.stats.p50_ms} ms, p95 ${detail.stats.p95_ms} ms` : ''}
                {detail.relay_url ? ` · relay ${detail.relay_url}` : ' · relay off'}
              </p>
              {detail.events.length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-1">Events</p>
                  <ul className="space-y-0.5 text-xs">
                    {detail.events.slice(0, 10).map((e: { id: number; severity: string; message: string; created_at: string }) => (
                      <li key={e.id} className={e.severity === 'warn' || e.severity === 'error' ? 'text-warning' : 'text-fg-muted'}>
                        {formatRelativeDate(e.created_at)} — {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => { if (!o) setConfirm(null) }}
        destructive
        busy={busy}
        title={confirm?.kind === 'gateway' ? `Revoke “${gateway.name}”?` : 'Revoke this instance?'}
        description={confirm?.kind === 'gateway'
          ? 'Every instance key and queued request is revoked at once. Connections through this gateway stop working. This cannot be undone (add a new gateway instead).'
          : `“${confirm?.kind === 'instance' ? confirm.name : ''}” can no longer connect; requests it is running fail. Other instances keep working.`}
        confirmLabel="Revoke"
        onConfirm={() => confirm?.kind === 'gateway'
          ? act(() => revokeGatewayAction(gateway.id), `Revoked “${gateway.name}”.`)
          : confirm?.kind === 'instance' ? act(() => revokeGatewayInstanceAction(gateway.id, confirm.id), 'Instance revoked.') : undefined}
      />
    </Card>
  )
}
