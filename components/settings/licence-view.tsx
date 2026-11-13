'use client'

import { useRef, useState } from 'react'
import { Check, Copy, Download, Upload } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { StatusPill, type Tone } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { getLicenceStatusAction, installLicenceAction, licenceRequestAction, removeLicenceAction } from '@/app/actions/licence'
import type { LicenceStatusView } from '@/lib/licensing/admin'
import type { LicenceSummary } from '@/lib/licensing/service'

/**
 * Settings → Licence body: warnings, the instance identity, licensed
 * extensions with expiry countdown and limits vs. usage, installed licences
 * (remove), install / replace (upload or paste) and the offline activation
 * request. Instance admins only (the page and every action check).
 */

const TIME_STATE: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'success' },
  expiring: { label: 'Expiring', tone: 'warning' },
  cutoff_pending: { label: 'Expired: stops within 24 h', tone: 'danger' },
  expired: { label: 'Expired', tone: 'danger' },
  not_yet_valid: { label: 'Not valid yet', tone: 'neutral' },
}

function when(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'
}

function countdown(daysLeft: number | null, state: string | null): string {
  if (state === 'expired') return 'stopped'
  if (state === 'cutoff_pending') return 'expired — stops within 24 hours'
  if (daysLeft === null) return 'no expiry'
  return `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="rounded-sm bg-subtle px-1 py-0.5 font-mono text-xs break-all">{children}</code>
}

function CopyId({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <IconButton size="sm" label={copied ? 'Copied' : 'Copy instance id'} icon={copied ? <Check /> : <Copy />}
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => undefined)} />
  )
}

function LicenceState({ l }: { l: LicenceSummary }) {
  if (!l.valid) return <StatusPill status="invalid" tone="danger" label="Invalid" />
  const s = TIME_STATE[l.timeState ?? ''] ?? { label: l.timeState ?? '?', tone: 'neutral' as Tone }
  return <StatusPill status={l.timeState ?? 'unknown'} tone={s.tone} label={s.label} />
}

export function LicenceView({ initialStatus }: { initialStatus: LicenceStatusView }) {
  const [status, setStatus] = useState(initialStatus)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    const result = await getLicenceStatusAction()
    if (result.ok) setStatus(result.data)
  }

  async function install(licenceText: string) {
    setBusy(true); setError(null); setMessage(null)
    const result = await installLicenceAction(licenceText)
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    setText('')
    setMessage(`${result.data.replaced ? 'Replaced' : 'Installed'} licence ${result.data.licence.licenceId}.${result.data.notes.length ? ` ${result.data.notes.join(' ')}` : ''}`)
    await refresh()
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    if (file.size > 64_000) { setError('That file is too large to be a licence'); return }
    await install(await file.text())
    if (fileRef.current) fileRef.current.value = ''
  }

  async function remove(id: string) {
    setBusy(true); setError(null); setMessage(null)
    const result = await removeLicenceAction(id)
    setBusy(false)
    setRemoving(null)
    if (!result.ok) { setError(result.error); return }
    setMessage(`Removed licence ${id}.`)
    await refresh()
  }

  async function downloadRequest() {
    setError(null)
    const result = await licenceRequestAction()
    if (!result.ok) { setError(result.error); return }
    const blob = new Blob([`${JSON.stringify(result.data, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `usertasks-licence-request${result.data.instance_id ? `-${result.data.instance_id}` : ''}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-[1080px] space-y-6">
      <PageHeader title="Licence" description="Licences for paid extensions on this installation. Licensed extensions stop 24 hours after their licence expires." />

      {status.warnings.map((w, i) => (
        <InlineNotice key={`${w.licenceId}-${i}`} tone={w.level === 'error' ? 'danger' : w.level === 'warn' ? 'warning' : 'info'} message={w.message} />
      ))}
      {error && <InlineNotice tone="danger" message={error} onDismiss={() => setError(null)} />}
      {message && <InlineNotice tone="success" message={message} onDismiss={() => setMessage(null)} />}

      <Card>
        <CardHeader title="This installation" description="Licences can be bound to the instance id or the hostname. Send the activation request to get a bound licence for an offline installation." />
        <CardBody className="space-y-2 text-ui">
          <div className="flex items-center gap-2">
            <span className="w-28 text-fg-muted">Instance id</span>
            {status.instance.instanceId ? <><Mono>{status.instance.instanceId}</Mono><CopyId text={status.instance.instanceId} /></> : <span className="text-fg-muted">unavailable (database not reachable)</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-28 text-fg-muted">Hostnames</span>
            <span>{status.instance.hostnames.length ? status.instance.hostnames.map((h) => <Mono key={h}>{h}</Mono>) : 'APP_URL is not set'}</span>
          </div>
          <div className="pt-2">
            <Button variant="secondary" size="sm" leadingIcon={<Download />} onClick={() => void downloadRequest()}>Download activation request</Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Licensed extensions" />
        <CardBody>
          {!status.extensions.length ? (
            <p className="text-ui text-fg-muted">No paid extension is licensed. Extensions in this build stay available but switched off until a licence enables them.</p>
          ) : (
            <ul className="divide-y divide-border">
              {status.extensions.map((e) => (
                <li key={e.id} className="space-y-1 py-3 text-ui">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{e.id}</span>
                    <StatusPill status={e.state} tone={e.allowed ? (e.timeState === 'active' ? 'success' : 'warning') : 'danger'} label={e.allowed ? 'Licensed' : e.state === 'expired' ? 'Expired' : 'Not licensed'} />
                    {e.trial && <StatusPill status="trial" tone="info" label="Trial" />}
                    <span className="text-fg-muted">{countdown(e.daysLeft, e.timeState)}</span>
                  </div>
                  <div className="text-fg-muted">Expires {when(e.expiresAt)} · stops {when(e.cutoffAt)} · features: {e.features?.length ? e.features.join(', ') : 'all'}</div>
                  {Object.entries(e.limits).map(([key, limit]) => {
                    const used = status.usage[key]
                    return (
                      <div key={key} className="text-fg-muted">
                        <Mono>{key}</Mono>: {used === null || used === undefined ? `limit ${limit}` : `${used} of ${limit} used`}
                      </div>
                    )
                  })}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Installed licences" />
        <CardBody>
          {!status.licences.length ? <p className="text-ui text-fg-muted">None.</p> : (
            <ul className="divide-y divide-border">
              {status.licences.map((l, i) => (
                <li key={`${l.licenceId}-${i}`} className="flex flex-wrap items-start justify-between gap-3 py-3 text-ui">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2"><Mono>{l.licenceId ?? '(unreadable)'}</Mono><LicenceState l={l} /></div>
                    <div className="text-fg-muted">
                      {l.customer ?? '—'} · {l.extensions.map((x) => x.id).join(', ') || '—'} · expires {when(l.expiresAt)} · {l.source === 'setting' ? 'installed here' : l.source === 'env' ? 'from USERTASKS_LICENCE' : 'from USERTASKS_LICENCE_FILE'}
                    </div>
                    {l.problems.map((p) => <div key={p.code} className="text-danger">{p.message}</div>)}
                  </div>
                  {l.source === 'setting' && l.licenceId && (
                    <Button variant="danger-ghost" size="sm" disabled={busy} onClick={() => setRemoving(l.licenceId)}>Remove</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Install or replace a licence" description="Upload the licence file or paste its contents. A licence with the same id replaces the installed one." />
        <CardBody className="space-y-3">
          <input ref={fileRef} type="file" accept=".licence,.license,.json,application/json,text/plain" className="hidden" onChange={(ev) => void onFile(ev.target.files?.[0])} />
          <Button variant="secondary" leadingIcon={<Upload />} disabled={busy} onClick={() => fileRef.current?.click()}>Upload licence file</Button>
          <Textarea rows={6} value={text} onChange={(ev) => setText(ev.target.value)} placeholder='{"format": 1, "kind": "usertasks.licence", …}' aria-label="Licence text" className="font-mono text-xs" />
          <Button disabled={busy || !text.trim()} loading={busy} onClick={() => void install(text)}>Install licence</Button>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null) }}
        title="Remove licence?"
        description={`Extensions licensed only by ${removing ?? 'this licence'} stop at once: their triggers no longer start runs and their steps fail with a licence error.`}
        confirmLabel="Remove"
        destructive
        busy={busy}
        onConfirm={() => (removing ? remove(removing) : undefined)}
      />
    </div>
  )
}
