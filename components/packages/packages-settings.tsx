'use client'

/**
 * Packages (Automations → Packages and Settings → Packages): import a
 * package (drag a .utpkg onto the page, or choose one — the wizard plans,
 * configures and installs it), the package library (installed packages:
 * version, source, signer, Complete / Incomplete with a checklist, Complete
 * setup, Upgrade, Uninstall with every artifact), the history of every
 * install / upgrade / reconfigure / uninstall, and the packages authored here
 * (contents, build a signed version, download .utpkg, install into another
 * workspace).
 * Builds, downloads, installs, setup completion and uninstalls run as
 * background jobs (lib/user-jobs/kinds/packages.ts): quick ones finish in
 * place, long ones report through the completion popup and the Jobs panel.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Boxes, CheckCircle2, CircleAlert, Download, Hammer, History, LayoutGrid, PackagePlus, Pencil, Plus, Send, Trash2, Upload } from 'lucide-react'
import { usePermissions } from '@/lib/permissions-context'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { InlineNotice } from '@/components/ui/inline-notice'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { Input } from '@/components/ui/input'
import { formatRelativeDate } from '@/lib/utils'
import {
  deletePackageAction,
  downloadPackageVersionAction,
  getInstallAction,
  getPackageAction,
  listInstallsAction,
  listInstallTargetsAction,
  listPackagesAction,
} from '@/app/actions/packages'
import { useJobs } from '@/components/jobs/jobs-provider'
import { fileToBase64, InstallWizard, type WizardFile } from './install-wizard'
import { GalleryPicker } from './gallery-picker'
import { PackageEditor } from './package-editor'
import { PackageHistory, type HistoryFilters } from './package-history'
import { cleanValues, missingCount, Modal, RequirementsForm, type RequirementValues, type RequirementView } from './requirements-form'
import { UninstallDialog } from './uninstall-dialog'

/* eslint-disable @typescript-eslint/no-explicit-any -- install / version rows from the services are loose JSON */

type Install = Extract<Awaited<ReturnType<typeof listInstallsAction>>, { ok: true }>['data'][number]
type Pkg = Extract<Awaited<ReturnType<typeof listPackagesAction>>, { ok: true }>['data'][number]
type Notice = { tone: 'success' | 'warning' | 'error'; message: string }
type Tab = 'library' | 'history' | 'authored'
interface WizardState { open: boolean; upgrade?: { name: string; package_uid: string }; file?: WizardFile | null; target?: { tenantId: string; name: string } | null; source?: 'file' | 'library' }

const muted = { color: 'var(--theme-muted-text)' }

/** Drag a .utpkg here (or click to choose one): opens the import wizard with it. */
function DropZone({ onFile, large, disabled }: { onFile: (file: File) => void; large: boolean; disabled?: boolean }) {
  const [dragging, setDragging] = useState(false)
  const id = 'package-drop-input'
  return (
    <label htmlFor={id} data-testid="package-dropzone"
      onDragOver={(event) => { if (disabled) return; event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file && !disabled) onFile(file) }}
      className={`block w-full rounded-xl border-2 border-dashed text-center cursor-pointer transition-colors ${large ? 'p-10' : 'p-4'}`}
      style={{ borderColor: dragging ? 'var(--theme-primary)' : 'var(--theme-surface-border)', backgroundColor: dragging ? 'var(--theme-surface)' : undefined }}>
      <input id={id} type="file" accept=".utpkg,application/zip" className="hidden" disabled={disabled} data-testid="package-drop-file"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onFile(file) }} />
      {large ? (
        <>
          <Upload size={26} className="mx-auto mb-3" style={muted} />
          <p className="text-base font-medium">Import a package</p>
          <p className="text-sm mt-1" style={muted}>Drop a <code>.utpkg</code> file here, or <span className="underline underline-offset-2">choose one</span>. You will see exactly what changes before anything is installed.</p>
          <p className="text-xs mt-3" style={muted}>Or from a terminal: <code>usertasks packages install file.utpkg</code></p>
        </>
      ) : (
        <p className="text-sm flex items-center justify-center gap-2" style={muted}><Upload size={15} /> {dragging ? 'Drop to import' : <>Drop a <code>.utpkg</code> here to import or upgrade, or <span className="underline underline-offset-2">choose a file</span></>}</p>
      )}
    </label>
  )
}

export function PackagesSettings() {
  const { can } = usePermissions()
  const canView = can('packages.view')
  const canManage = can('packages.manage')
  const canInstall = can('packages.install')
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('library')
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>({})
  const [wizard, setWizard] = useState<WizardState>({ open: false })
  const [editor, setEditor] = useState<{ open: boolean; pkg: Pkg | null }>({ open: false, pkg: null })
  const [notice, setNotice] = useState<Notice | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)

  const installs = useQuery({ queryKey: ['package-installs'], queryFn: async () => { const r = await listInstallsAction(); if (!r.ok) throw new Error(r.error); return r.data }, enabled: canView })
  const authored = useQuery({ queryKey: ['packages'], queryFn: async () => { const r = await listPackagesAction(); if (!r.ok) throw new Error(r.error); return r.data }, enabled: canView })
  const targets = useQuery({ queryKey: ['package-install-targets'], queryFn: async () => { const r = await listInstallTargetsAction(); return r.ok ? r.data : [] }, enabled: canView && canManage })

  if (!canView) return <p className="text-sm" style={muted}>Not authorized.</p>
  if (installs.isLoading && !installs.data) return <PageSkeleton variant="settings" />
  const refresh = () => {
    for (const key of ['package-installs', 'packages', 'package-events']) void queryClient.invalidateQueries({ queryKey: [key] })
  }
  const importFile = async (file: File) => {
    if (!/\.utpkg$/i.test(file.name) && file.type !== 'application/zip') { setNotice({ tone: 'error', message: `“${file.name}” is not a .utpkg package file.` }); return }
    setWizard({ open: true, file: { name: file.name, base64: await fileToBase64(file) }, source: 'file' })
  }
  const showHistory = (packageUid?: string) => { setHistoryFilters(packageUid ? { package: packageUid } : {}); setTab('history') }
  const list = installs.data ?? []

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Boxes size={22} /> Packages</h1>
          <p className="text-sm mt-1" style={muted}>
            Import a process — a workflow and everything it uses — as one signed package, keep it up to date, and remove it with all its artifacts. Credentials never travel: imports ask for them, or stay incomplete until you add them.{' '}
            <Link href="/docs/packages" className="underline underline-offset-2">Docs</Link>
          </p>
        </div>
        <div className="flex gap-2">
          {canManage && <Button size="sm" variant="outline" onClick={() => { setTab('authored'); setEditor({ open: true, pkg: null }) }}><PackagePlus size={14} /> New package</Button>}
          {canInstall && <Button size="sm" variant="outline" onClick={() => setGalleryOpen(true)} data-testid="browse-gallery"><LayoutGrid size={14} /> Browse gallery</Button>}
          {canInstall && <Button size="sm" onClick={() => setWizard({ open: true, source: 'file' })} data-testid="install-package"><Upload size={14} /> Import package</Button>}
        </div>
        {canInstall && <GalleryPicker open={galleryOpen} onOpenChange={setGalleryOpen} installedUids={new Set(list.map((install: any) => String(install.package_uid)))} onPick={(file) => setWizard({ open: true, file, source: 'file' })} />}
      </div>

      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--theme-surface-border)' }} role="tablist">
        {([['library', `Installed (${list.length})`], ['history', 'History'], ['authored', `Authored here (${authored.data?.length ?? 0})`]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => { if (id === 'history') showHistory(); else setTab(id) }} className="px-3 py-2 text-sm font-medium -mb-px border-b-2" data-testid={`packages-tab-${id}`}
            style={{ borderColor: tab === id ? 'var(--theme-primary)' : 'transparent', color: tab === id ? 'var(--theme-card-text)' : 'var(--theme-muted-text)' }}>{label}</button>
        ))}
      </div>

      {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}

      {tab === 'library' && (
        <div className="space-y-3">
          {canInstall && <DropZone large={list.length === 0} onFile={(file) => void importFile(file)} />}
          {list.length === 0 ? (
            !canInstall && (
              <Card>
                <p className="text-sm font-medium">No packages installed</p>
                <p className="text-xs mt-1" style={muted}>Importing packages needs the <code>packages.install</code> permission.</p>
              </Card>
            )
          ) : list.map((install) => (
            <InstallCard key={install.id} install={install} canInstall={canInstall} onChanged={refresh} onNotice={setNotice}
              onHistory={() => showHistory(install.package_uid)}
              onUpgrade={() => setWizard({ open: true, upgrade: { name: install.name, package_uid: install.package_uid }, source: 'file' })} />
          ))}
        </div>
      )}

      {tab === 'history' && (
        <PackageHistory filters={historyFilters} onFiltersChange={setHistoryFilters}
          packages={list.map((i) => ({ value: i.package_uid, label: i.name }))} />
      )}

      {tab === 'authored' && (
        (authored.data ?? []).length === 0 ? (
          <Card>
            <p className="text-sm font-medium">No packages authored here</p>
            <p className="text-xs mt-1" style={muted}>Start from a workflow: its custom steps, rules, tables, integrations, connectors, templates and agents are included automatically.</p>
            {canManage && <Button size="sm" className="mt-3" onClick={() => setEditor({ open: true, pkg: null })}><Plus size={14} /> New package</Button>}
          </Card>
        ) : (
          <div className="space-y-3">
            {(authored.data ?? []).map((pkg) => (
              <AuthoredCard key={pkg.id} pkg={pkg} canManage={canManage} targets={targets.data ?? []} onEdit={() => setEditor({ open: true, pkg })} onChanged={refresh} onNotice={setNotice}
                onInstallElsewhere={(file, target) => setWizard({ open: true, file, target, source: 'library' })} />
            ))}
          </div>
        )
      )}

      <InstallWizard open={wizard.open} expectUpgradeOf={wizard.upgrade} initialFile={wizard.file ?? null} target={wizard.target ?? null} source={wizard.source}
        onOpenChange={(open) => setWizard((prev) => (open ? { ...prev, open } : { open: false }))} onInstalled={refresh} />
      {editor.open && <PackageEditor open={editor.open} pkg={editor.pkg} onOpenChange={(open) => setEditor((prev) => ({ ...prev, open }))} onSaved={(name) => { setNotice({ tone: 'success', message: `Saved “${name}”.` }); refresh() }} />}
    </div>
  )
}

function StatusBadge({ status, count }: { status: string; count: number }) {
  const complete = status === 'complete'
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" data-testid="install-status"
      style={{ backgroundColor: complete ? 'var(--status-success-bg)' : 'var(--status-warning-bg)', color: complete ? 'var(--theme-success)' : 'var(--theme-warning)' }}>
      {complete ? <CheckCircle2 size={12} /> : <CircleAlert size={12} />}
      {complete ? 'Complete' : `Incomplete · ${count} to configure`}
    </span>
  )
}

function InstallCard({ install, canInstall, onChanged, onNotice, onUpgrade, onHistory }: { install: Install; canInstall: boolean; onChanged: () => void; onNotice: (n: Notice) => void; onUpgrade: () => void; onHistory: () => void }) {
  const [expanded, setExpanded] = useState(install.status === 'incomplete')
  const [completeOpen, setCompleteOpen] = useState(false)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const details = useQuery({ queryKey: ['package-install', install.id], queryFn: async () => { const r = await getInstallAction(install.id); if (!r.ok) throw new Error(r.error); return r.data }, enabled: expanded })

  return (
    <Card className="p-4" data-testid="install-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{install.name} <span className="text-sm font-normal" style={muted}>v{install.version}</span></p>
          <p className="text-xs mt-0.5" style={muted}>
            {install.source === 'file' ? `from ${install.source_label ?? 'a file'}` : `via ${install.source}${install.source_label ? ` (${install.source_label})` : ''}`}
            {' · '}{install.signed ? `signed ${String(install.fingerprint ?? '').slice(0, 11)}…` : 'unsigned'}
            {' · '}installed {formatRelativeDate(install.installed_at)}{install.previous_version ? ` · upgraded from ${install.previous_version}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={install.status} count={install.incomplete_count} />
          {canInstall && install.status === 'incomplete' && <Button size="sm" onClick={() => setCompleteOpen(true)} data-testid="complete-setup">Complete setup</Button>}
          {canInstall && <Button size="sm" variant="outline" onClick={onUpgrade}><Upload size={13} /> Upgrade</Button>}
          <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>{expanded ? 'Hide' : 'Details'}</Button>
          <Button size="sm" variant="ghost" onClick={onHistory} data-testid="install-history"><History size={13} /> History</Button>
          {canInstall && <Button size="sm" variant="ghost" onClick={() => setUninstallOpen(true)} aria-label={`Uninstall ${install.name}`} title="Uninstall" data-testid="install-uninstall"><Trash2 size={14} /></Button>}
        </div>
      </div>
      {expanded && (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={muted}>Setup checklist</p>
            {install.checklist.length === 0 ? <p className="text-xs" style={muted}>Nothing to configure.</p> : (
              <ul className="space-y-1" data-testid="install-checklist">
                {install.checklist.map((item: any) => (
                  <li key={item.id} className="flex items-start gap-1.5 text-sm">
                    {item.status === 'missing' ? <CircleAlert size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--theme-warning)' }} /> : <CheckCircle2 size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--theme-success)' }} />}
                    <span>{item.label}{item.status === 'missing' && <span className="text-xs" style={{ color: 'var(--theme-warning)' }}> — needs configuration</span>}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={muted}>Installed assets</p>
            <ul className="space-y-0.5 text-sm max-h-48 overflow-y-auto">
              {(details.data?.assets ?? []).filter((a: any) => a.section !== 'references').map((asset: any) => (
                <li key={asset.id} className="flex items-center gap-2">
                  <span className="text-xs w-28 shrink-0" style={muted}>{String(asset.section).replace(/_/g, ' ')}</span>
                  <span className="truncate">{asset.name}</span>
                  {asset.status === 'needs_config' && <span className="text-[10px] px-1.5 rounded shrink-0" style={{ backgroundColor: 'var(--status-warning-bg)', color: 'var(--theme-warning)' }}>needs configuration</span>}
                  {asset.status === 'removed_upstream' && <span className="text-[10px] px-1.5 rounded shrink-0" style={{ backgroundColor: 'var(--theme-surface)', ...muted }}>not in this version</span>}
                </li>
              ))}
              {details.data && details.data.data_rows > 0 && <li className="text-xs" style={muted}>{details.data.data_rows} table rows</li>}
            </ul>
          </div>
        </div>
      )}
      <CompleteSetupDialog open={completeOpen} onOpenChange={setCompleteOpen} install={install} onDone={(status) => { onNotice({ tone: status === 'complete' ? 'success' : 'warning', message: status === 'complete' ? `${install.name}: setup complete — its items are enabled.` : `${install.name}: some values are still missing.` }); onChanged() }} />
      <UninstallDialog open={uninstallOpen} onOpenChange={setUninstallOpen} install={install} onDone={(message) => { onNotice({ tone: 'success', message }); onChanged() }} onShowHistory={onHistory} />
    </Card>
  )
}

function CompleteSetupDialog({ open, onOpenChange, install, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; install: Install; onDone: (status: string) => void }) {
  const jobs = useJobs()
  const [values, setValues] = useState<RequirementValues>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requirements = install.requirements as RequirementView[]
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const job = await jobs.start('package.complete', { install_id: install.id, name: install.name, values: cleanValues(values) }, {
        effect: 'change', quietIfInline: true, onSuccess: (done) => onDone(String((done.result?.data as any)?.status ?? '')),
      })
      if (job?.status === 'failed') { setError(job.error ?? 'Setup failed'); return }
      setValues({})
      onOpenChange(false)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Complete setup — ${install.name}`}>
      <p className="text-sm mb-3" style={muted}>Add the missing values. Connections are enabled and the package’s workflows activated once everything required is set. Saved values are kept on upgrades.</p>
      {error && <InlineNotice tone="error" message={error} className="mb-3" />}
      <RequirementsForm requirements={requirements} values={values} onChange={setValues} />
      <div className="flex justify-end gap-2 mt-4">
        <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={() => void submit()} disabled={busy} data-testid="complete-submit">{busy ? 'Saving…' : missingCount(requirements, values) ? 'Save (still incomplete)' : 'Complete setup'}</Button>
      </div>
    </Modal>
  )
}

function AuthoredCard({ pkg, canManage, targets, onEdit, onChanged, onNotice, onInstallElsewhere }: {
  pkg: Pkg; canManage: boolean; targets: Array<{ id: string; name: string }>; onEdit: () => void; onChanged: () => void; onNotice: (n: Notice) => void
  onInstallElsewhere: (file: WizardFile, target: { tenantId: string; name: string }) => void
}) {
  const [elsewhereOpen, setElsewhereOpen] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [targetVersion, setTargetVersion] = useState('latest')
  const jobs = useJobs()
  const [buildOpen, setBuildOpen] = useState(false)
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const detail = useQuery({ queryKey: ['package', pkg.id], queryFn: async () => { const r = await getPackageAction(pkg.id); if (!r.ok) throw new Error(r.error); return r.data } })
  // Build + sign + download as a background job: the popup offers the .utpkg.
  const build = async () => {
    setBusy(true)
    setError(null)
    try {
      await jobs.start('package.build', { package_id: pkg.id, name: pkg.name, ...(version.trim() ? { version: version.trim() } : { bump: 'patch' }), notes }, {
        effect: 'download',
        pendingMessage: `Building ${pkg.name}…`,
        onSuccess: (done) => {
          const data = done.result?.data as { version?: { version?: string }; warnings?: string[]; requirements?: number } | undefined
          const warnings = data?.warnings ?? []
          onNotice({ tone: warnings.length ? 'warning' : 'success', message: `Built ${pkg.name} ${data?.version?.version ?? ''} (${data?.requirements ?? 0} requirements)${warnings.length ? ` — ${warnings.join('; ')}` : ''}.` })
          onChanged()
          void detail.refetch()
        },
      })
      setBuildOpen(false)
      setVersion('')
      setNotes('')
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start the build')
    } finally {
      setBusy(false)
    }
  }
  const download = async (v: string) => {
    try {
      await jobs.start('package.download', { package_id: pkg.id, version: v, name: pkg.name }, { effect: 'download', pendingMessage: `Preparing ${pkg.name} ${v}…` })
    } catch (startError) {
      onNotice({ tone: 'error', message: startError instanceof Error ? startError.message : 'Could not start the download' })
    }
  }
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{pkg.name} {pkg.latest_version && <span className="text-sm font-normal" style={muted}>v{pkg.latest_version}</span>}</p>
          {pkg.description && <p className="text-sm mt-0.5">{pkg.description}</p>}
          <p className="text-xs mt-0.5" style={muted}>{pkg.slug} · {pkg.roots.length} root{pkg.roots.length === 1 ? '' : 's'}{pkg.items.length ? `, ${pkg.items.length} added` : ''}{pkg.excluded.length ? `, ${pkg.excluded.length} left out` : ''}</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onEdit}><Pencil size={13} /> Edit</Button>
            <Button size="sm" onClick={() => setBuildOpen(true)} data-testid="build-version"><Hammer size={13} /> Build version</Button>
            {targets.length > 0 && pkg.latest_version && <Button size="sm" variant="outline" onClick={() => { setTargetId(targets[0].id); setElsewhereOpen(true) }} data-testid="install-elsewhere"><Send size={13} /> Install in another workspace</Button>}
            <Button size="sm" variant="ghost" aria-label={`Delete ${pkg.name}`} onClick={async () => { if (!confirm(`Delete package “${pkg.name}” and its built versions? Installs elsewhere are not affected.`)) return; const r = await deletePackageAction(pkg.id); if (r.ok) onChanged(); else onNotice({ tone: 'error', message: r.error }) }}><Trash2 size={14} /></Button>
          </div>
        )}
      </div>
      {(detail.data?.versions ?? []).length > 0 && (
        <ul className="mt-3 text-sm divide-y" style={{ borderColor: 'var(--theme-surface-border)' }}>
          {(detail.data?.versions ?? []).slice(0, 5).map((v: any) => (
            <li key={v.id} className="flex items-center gap-3 py-1.5" style={{ borderColor: 'var(--theme-surface-border)' }}>
              <span className="font-medium w-16">{v.version}</span>
              <span className="text-xs" style={muted}>{v.asset_count} assets · {(v.size_bytes / 1024).toFixed(1)} KB · {v.signed ? 'signed' : 'unsigned'} · {formatRelativeDate(v.created_at)}</span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void download(v.version)}><Download size={13} /> .utpkg</Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={elsewhereOpen} onOpenChange={setElsewhereOpen} title={`Install ${pkg.name} in another workspace`} width="w-[min(28rem,92vw)]">
        <p className="text-xs mb-3" style={muted}>Takes a built version of this package and opens the import wizard for a workspace you belong to (and can install packages in).</p>
        <label className="text-xs block mb-3">Workspace
          <select className="mt-1 h-8 w-full rounded-md border px-2 text-sm" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-xs block mb-3">Version
          <select className="mt-1 h-8 w-full rounded-md border px-2 text-sm" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }} value={targetVersion} onChange={(e) => setTargetVersion(e.target.value)}>
            <option value="latest">Latest ({pkg.latest_version})</option>
            {(detail.data?.versions ?? []).map((v: any) => <option key={v.id} value={v.version}>{v.version}</option>)}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setElsewhereOpen(false)}>Cancel</Button>
          <Button size="sm" disabled={!targetId || busy} onClick={async () => {
            setBusy(true)
            const result = await downloadPackageVersionAction(pkg.id, targetVersion)
            setBusy(false)
            if (!result.ok) { onNotice({ tone: 'error', message: result.error }); return }
            const target = targets.find((t) => t.id === targetId)!
            setElsewhereOpen(false)
            onInstallElsewhere({ name: result.data.file_name, base64: result.data.file_base64 }, { tenantId: target.id, name: target.name })
          }}><Send size={13} /> Continue</Button>
        </div>
      </Modal>
      <Modal open={buildOpen} onOpenChange={setBuildOpen} title={`Build ${pkg.name}`} width="w-[min(28rem,92vw)]">
        <p className="text-xs mb-3" style={muted}>Exports the current state of every item (secrets removed), signs it with this instance’s key and prepares the .utpkg in the background — we’ll let you know when it’s ready to download.</p>
        {error && <InlineNotice tone="error" message={error} className="mb-3" />}
        <label className="text-xs block mb-3">Version <Input className="h-8 text-sm mt-1" placeholder={pkg.latest_version ? `next patch after ${pkg.latest_version}` : '1.0.0'} value={version} onChange={(e) => setVersion(e.target.value)} /></label>
        <label className="text-xs block mb-3">Release notes <Input className="h-8 text-sm mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setBuildOpen(false)} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={() => void build()} disabled={busy} data-testid="build-submit"><Hammer size={13} /> {busy ? 'Starting…' : 'Build & download'}</Button>
        </div>
      </Modal>
    </Card>
  )
}
