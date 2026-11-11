'use client'

import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Blocks, Download, FileDown, FileUp, Globe, LayoutGrid, Link2, ShieldAlert, ShieldCheck, Trash2, Upload, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Card } from '@/components/ui/card'
import { Badge, Tag } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { TableScroll, thClass, tdClass, trClass } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format/date'
import { formatCount } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'
import { SubmitButton } from '@/components/ui/submit-button'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { serverRead } from '@/lib/server-read'
import { usePermissions } from '@/lib/permissions-context'
import { compareSemver } from '@/lib/forms/custom-controls/manifest'
import {
  canTrustFormControls, deleteFormControl, exportFormControl, importFormControl, importFormControlFromUrl, updateFormControl, uploadFormControl,
} from '@/app/actions/form-controls'
import { ControlIcon } from '@/components/forms/designer/control-icon'

/**
 * Extensibility → Form controls: the workspace's custom form controls (web
 * components). Upload a package (zip, or an ES module + manifest.json),
 * import one from a URL (fetched once, snapshotted), see versions with
 * checksums and signatures, enable / disable, approve the network hosts a
 * manifest asks for, see where each is used, export / import, delete
 * (refused while in use). Instance admins may mark a control trusted.
 */

type Control = NonNullable<Awaited<ReturnType<typeof loadControls>>>[number]

async function loadControls() {
  const { data, error } = await serverRead('forms.controls', { all: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function FormControlsView() {
  const { permissions } = usePermissions()
  const can = (p: string) => permissions.has(p)
  const queryClient = useQueryClient()
  const { data: controls = [], isLoading, error } = useQuery({ queryKey: ['form-controls-library'], queryFn: loadControls })
  const { data: canTrust = false } = useQuery({ queryKey: ['form-controls-can-trust'], queryFn: () => canTrustFormControls(), staleTime: 5 * 60_000 })
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string; details?: string[] } | null>(null)
  const [urlForm, setUrlForm] = useState<{ url: string; manifest_url: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const manifestRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const guard = useSubmitGuard()

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['form-controls-library'] })
    void queryClient.invalidateQueries({ queryKey: ['form-controls-palette'] })
  }

  async function act<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, success: (data: T) => { text: string; details?: string[] }) {
    await guard.run(async () => {
      setNotice(null)
      const result = await fn()
      if (!result.ok) { setNotice({ kind: 'error', text: result.error }); return }
      setNotice({ kind: 'ok', ...success(result.data) })
      refresh()
    })
  }

  async function upload() {
    const file = fileRef.current?.files?.[0]
    if (!file) { setNotice({ kind: 'error', text: 'Choose a .zip package or an ES module (.js / .mjs).' }); return }
    const form = new FormData()
    form.append('file', file)
    const manifest = manifestRef.current?.files?.[0]
    if (manifest) form.append('manifest', manifest)
    await act(() => uploadFormControl(form), (r) => ({
      text: r.outcome === 'created' ? `Added ${r.control.name} (${r.control.tag}@${r.version}).` : r.outcome === 'version' ? `Added version ${r.version} of ${r.control.name}.` : `${r.control.tag}@${r.version} is already in the library (same checksum).`,
      details: r.warnings,
    }))
    if (fileRef.current) fileRef.current.value = ''
    if (manifestRef.current) manifestRef.current.value = ''
  }

  if (!can('extensibility.view')) return <p className="text-sm text-fg-muted">Not authorized.</p>

  return (
    <div className="space-y-4" data-testid="form-controls-library">
      <div className="flex flex-wrap items-start gap-3">
        <p className="min-w-[240px] max-w-3xl flex-1 text-sm text-fg-muted">
          Web components (Lit, vanilla JS, …) that appear in the form designer&apos;s <span className="font-medium text-fg">Custom</span> palette — build your own or install official ones (charts, saved reports, address search, maps, signatures, …) from the gallery. Each runs in a sandboxed frame with no access to UserTasks and no network unless you approve a host; code is stored here (never loaded from a third-party URL at runtime).
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          {can('packages.install') && (
            <Button asChild size="sm" variant="secondary" leadingIcon={<LayoutGrid />}>
              <a href="/packages?gallery=form-controls" data-testid="controls-browse-gallery">Browse gallery</a>
            </Button>
          )}
          <Button asChild size="sm" variant="secondary" leadingIcon={<Download />}>
            <a href="/downloads/form-control-starter.zip" download>Starter kit (Lit + vanilla)</a>
          </Button>
        </div>
      </div>

      {(can('extensibility.create') || can('extensibility.edit')) && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card padding="md" className="space-y-3">
            <p className="flex items-center gap-1.5 text-ui font-semibold text-fg"><Upload size={14} className="text-fg-muted" aria-hidden /> Upload a package</p>
            <label className="block text-xs text-fg-muted">Zip (manifest.json + module) or a single ES module
              <input ref={fileRef} type="file" accept=".zip,.js,.mjs,application/zip,text/javascript" className={fileInputClass} data-testid="control-file" />
            </label>
            <label className="block text-xs text-fg-muted">manifest.json (only with a single module)
              <input ref={manifestRef} type="file" accept=".json,application/json" className={fileInputClass} data-testid="control-manifest" />
            </label>
            <SubmitButton type="button" size="sm" pending={guard.pending} pendingLabel="Uploading…" onClick={() => void upload()} data-action="upload-control">Upload</SubmitButton>
          </Card>
          <Card padding="md" className="space-y-3">
            <p className="flex items-center gap-1.5 text-ui font-semibold text-fg"><Link2 size={14} className="text-fg-muted" aria-hidden /> Import from a URL</p>
            {urlForm ? (
              <div className="space-y-2">
                <Input aria-label="Package or module URL" placeholder="https://cdn.example.com/rating/1.2.0/rating.js (or a .zip)" value={urlForm.url} onChange={(e) => setUrlForm({ ...urlForm, url: e.target.value })} />
                <Input aria-label="Manifest URL (optional)" placeholder="manifest.json URL (default: next to the module)" value={urlForm.manifest_url} onChange={(e) => setUrlForm({ ...urlForm, manifest_url: e.target.value })} />
                <div className="flex gap-2">
                  <SubmitButton type="button" size="sm" pending={guard.pending} pendingLabel="Importing…" disabled={!urlForm.url.trim()}
                    onClick={() => void act(() => importFormControlFromUrl({ url: urlForm.url.trim(), manifest_url: urlForm.manifest_url.trim() || null }), (r) => { setUrlForm(null); return { text: `Imported ${r.control.tag}@${r.version} (snapshotted — the URL is not used at runtime).`, details: r.warnings } })}>
                    Fetch and import
                  </SubmitButton>
                  <Button size="sm" variant="ghost" onClick={() => setUrlForm(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-xs text-fg-muted">https only, through the egress guard (no private addresses). The module and manifest are fetched once and stored as a version.</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" leadingIcon={<Globe />} onClick={() => setUrlForm({ url: '', manifest_url: '' })}>Import from URL</Button>
                  <Button size="sm" variant="secondary" leadingIcon={<FileUp />} onClick={() => importRef.current?.click()}>Import export (.json)</Button>
                  <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={async (e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (!file) return
                    const text = await file.text()
                    await act(() => importFormControl(text), (r) => ({ text: `Imported ${r.control.tag}: ${r.added.length ? `added ${r.added.join(', ')}` : 'nothing new'}${r.skipped.length ? `; already had ${r.skipped.join(', ')}` : ''}.` }))
                  }} />
                </div>
              </>
            )}
          </Card>
        </div>
      )}
      {notice && (
        <div
          className={cn('rounded-md border px-3 py-2 text-xs', notice.kind === 'error' ? 'border-danger bg-danger-wash' : 'border-border bg-panel')}
          role={notice.kind === 'error' ? 'alert' : 'status'}
          data-testid="control-notice"
        >
          <p className={notice.kind === 'error' ? 'text-danger' : 'text-fg'}>{notice.text}</p>
          {notice.details?.length ? <ul className="mt-1 list-disc pl-4 text-fg-muted">{notice.details.map((d, i) => <li key={i}>{d}</li>)}</ul> : null}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      )
        : error ? (
          <div role="alert">
            <EmptyState size="sm" variant="error" title="Couldn't load the controls" description={error instanceof Error ? error.message : 'Could not load the controls'} />
          </div>
        )
          : controls.length === 0 ? (
            <Card padding="none">
              <EmptyState
                icon={Blocks}
                title="No form controls yet"
                description="Download the starter kit, build the example, and upload the zip it makes."
              />
            </Card>
          ) : (
            <ul className="space-y-3">
              {controls.map((control) => (
                <ControlCard key={control.id} control={control} canEdit={can('extensibility.edit')} canDelete={can('extensibility.delete')} canTrust={canTrust} act={act} />
              ))}
            </ul>
          )}
    </div>
  )
}

const fileInputClass = 'mt-1 block w-full text-xs text-fg file:mr-2 file:h-7 file:cursor-pointer file:rounded-md file:border file:border-solid file:border-border file:bg-panel file:px-2.5 file:text-xs file:font-medium file:text-fg hover:file:bg-subtle'

function ControlCard({ control, canEdit, canDelete, canTrust, act }: {
  control: Control
  canEdit: boolean
  canDelete: boolean
  canTrust: boolean
  act: <T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, success: (data: T) => { text: string; details?: string[] }) => Promise<void>
}) {
  const [showUsage, setShowUsage] = useState(false)
  const [confirm, setConfirm] = useState<null | { kind: 'delete'; version?: string } | { kind: 'trust' }>(null)
  const { data: usages, isLoading: usagesLoading } = useQuery({
    queryKey: ['form-control-usages', control.id],
    enabled: showUsage,
    queryFn: async () => (await serverRead('forms.controlUsages', { id: control.id })).data ?? [],
  })
  const versions = [...control.versions].sort((a, b) => compareSemver(b.version, a.version))
  const manifest = control.manifest

  return (
    <li className="space-y-3 rounded-lg border border-border bg-panel p-4" data-control-tag={control.tag}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-wash text-primary-text">
          <ControlIcon icon={control.icon} size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
            {control.name}
            <Tag mono>&lt;{control.tag}&gt;</Tag>
            <Tag mono>v{control.latest_version}</Tag>
            {!control.enabled && <Badge tone="danger">Disabled</Badge>}
            {control.trusted
              ? <Badge tone="danger"><ShieldAlert size={12} aria-hidden className="-ml-0.5 mr-1 inline" />Trusted (no sandbox)</Badge>
              : <span className="inline-flex items-center gap-1 text-xs font-normal text-fg-muted"><ShieldCheck size={12} aria-hidden /> Sandboxed</span>}
          </p>
          {control.description && <p className="mt-0.5 text-ui text-fg-muted">{control.description}</p>}
          {manifest && (
            <p className="mt-1 text-xs text-fg-muted">
              Stores {manifest.value.type}{manifest.props.length ? ` · ${plural(manifest.props.length, 'property', 'properties')}` : ''}{manifest.capabilities.length ? ` · asks for ${manifest.capabilities.join(', ')}` : ''}{manifest.author ? ` · by ${manifest.author}` : ''}{manifest.license ? ` · ${manifest.license}` : ''}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {canEdit && (
            <Checkbox
              label="Enabled"
              checked={control.enabled}
              onChange={(e) => void act(() => updateFormControl(control.id, { enabled: e.target.checked }), () => ({ text: `${control.name} ${e.target.checked ? 'enabled' : 'disabled'}.` }))}
              data-action="toggle-enabled"
              className="mr-2 items-center"
            />
          )}
          <Button size="sm" variant="ghost" leadingIcon={<Users />} onClick={() => setShowUsage((v) => !v)} aria-expanded={showUsage}>Usage</Button>
          <Button size="sm" variant="ghost" leadingIcon={<FileDown />} onClick={() => void act(() => exportFormControl(control.id), (data) => { download(`${control.tag}.form-control.json`, JSON.stringify(data, null, 2)); return { text: `Exported ${control.tag}.` } })}>Export</Button>
          {canDelete && <IconButton size="sm" variant="danger-ghost" label={`Delete ${control.name}`} icon={<Trash2 />} onClick={() => setConfirm({ kind: 'delete' })} />}
        </div>
      </div>

      {control.pending_hosts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-warning-wash px-3 py-2 text-xs text-fg">
          <AlertTriangle size={14} className="text-warning" aria-hidden />
          <span className="flex-1">Asks for network access to <span className="font-semibold">{control.pending_hosts.join(', ')}</span>. Until approved it has none.</span>
          {canEdit && <Button size="sm" variant="secondary" onClick={() => void act(() => updateFormControl(control.id, { approved_hosts: [...control.approved_hosts, ...control.pending_hosts] }), () => ({ text: `Approved ${control.pending_hosts.join(', ')} for ${control.tag}.` }))}>Approve hosts</Button>}
        </div>
      )}
      {control.approved_hosts.length > 0 && (
        <p className="text-xs text-fg-muted">
          Network allowed: {control.approved_hosts.join(', ')}
          {canEdit && <Button variant="link" size="sm" className="ml-2 h-auto text-xs" onClick={() => void act(() => updateFormControl(control.id, { approved_hosts: [] }), () => ({ text: `Revoked network access for ${control.tag}.` }))}>Revoke</Button>}
        </p>
      )}

      <TableScroll label={`Versions of ${control.name}`} frameClassName="rounded-md border border-border-subtle">
        <table className="w-full border-collapse whitespace-nowrap text-left text-xs text-fg">
          <caption className="sr-only">Versions of {control.name}</caption>
          <thead>
            <tr>
              <th scope="col" className={thClass}>Version</th>
              <th scope="col" className={thClass}>Source</th>
              <th scope="col" className={thClass}>SHA-256</th>
              <th scope="col" className={cn(thClass, 'text-right')}>Size</th>
              <th scope="col" className={thClass}>Signature</th>
              <th scope="col" className={thClass}>Added</th>
              <th scope="col" className={thClass}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id} className={trClass}>
                <td className={cn(tdClass, 'h-8 font-mono')}>{v.version}{v.version === control.latest_version && <Badge tone="brand" className="ml-2 font-sans">Latest</Badge>}</td>
                <td className={cn(tdClass, 'h-8')}>{v.source === 'url' && v.source_url ? <span title={v.source_url}>URL</span> : v.source}</td>
                <td className={cn(tdClass, 'h-8 font-mono')} title={v.sha256}>{v.sha256.slice(0, 12)}…</td>
                <td className={cn(tdClass, 'num h-8 text-right')}>{formatCount(Math.max(1, Math.round(v.size_bytes / 1024)))} KB</td>
                <td className={cn(tdClass, 'h-8')}>{v.signature ? (v.signature.verified ? <span title={v.signature.via === 'package' ? `Installed from a package signed by ed25519 key ${v.signature.key_fingerprint}` : `ed25519 key ${v.signature.key_fingerprint}`}>{v.signature.via === 'package' ? 'Signed package' : 'Verified'} ({v.signature.key_fingerprint.slice(0, 8)}…)</span> : <span className="text-danger">Unverified</span>) : '—'}</td>
                <td className={cn(tdClass, 'h-8 text-fg-muted')}>{formatDate(v.created_at)}</td>
                <td className={cn(tdClass, 'h-8 text-right')}>{canDelete && versions.length > 1 && <Button variant="link" size="sm" className="h-auto text-xs text-danger" onClick={() => setConfirm({ kind: 'delete', version: v.version })} aria-label={`Delete version ${v.version}`}>Delete</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      {showUsage && (
        <div className="rounded-md bg-subtle px-3 py-2 text-xs text-fg" data-testid="control-usages">
          {usagesLoading ? 'Loading…' : !usages?.length ? 'Not used by any form, workflow or open task.' : (
            <ul className="space-y-0.5">
              {usages.map((u, i) => <li key={i}><span className="capitalize">{u.kind}</span> <span className="font-semibold">{u.name}</span> · {u.where} · field <code className="font-mono">{u.field_key}</code> · v{u.version}</li>)}
            </ul>
          )}
        </div>
      )}

      {canTrust && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <span>Instance admin:</span>
          {control.trusted
            ? <Button size="sm" variant="secondary" onClick={() => void act(() => updateFormControl(control.id, { trusted: false }), () => ({ text: `${control.tag} runs in the sandbox again.` }))}>Return to sandbox</Button>
            : <Button size="sm" variant="secondary" onClick={() => setConfirm({ kind: 'trust' })}>Mark trusted…</Button>}
        </div>
      )}

      {confirm && (
        <div className="rounded-md border border-danger bg-danger-wash p-3 text-xs" role="alertdialog" aria-label="Confirm">
          {confirm.kind === 'trust' ? (
            <>
              <p className="font-semibold text-danger">Run {control.tag} without the sandbox?</p>
              <p className="mt-1 text-fg-muted">A trusted control loads into the page itself: its code can read and change anything the person filling the form can — their session, other fields, other tabs of the app. Only trust code you have reviewed and control.</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="danger" onClick={() => { setConfirm(null); void act(() => updateFormControl(control.id, { trusted: true }), () => ({ text: `${control.tag} is trusted and renders inline.` })) }}>Trust it</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
              </div>
            </>
          ) : (
            <>
              <p className="font-semibold text-fg">Delete {confirm.version ? `version ${confirm.version} of ` : ''}{control.name}?</p>
              <p className="mt-1 text-fg-muted">Refused while a form, workflow or open task uses it.</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="danger" onClick={() => { const version = confirm.version; setConfirm(null); void act(() => deleteFormControl(control.id, version ?? null), () => ({ text: version ? `Deleted ${control.tag}@${version}.` : `Deleted ${control.tag}.` })) }}>Delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  )
}
