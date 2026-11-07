'use client'

/**
 * Packages (Automations → Packages and Settings → Packages): import a
 * package (drag a .utpkg onto the toolbar line, or choose one — the wizard
 * plans, configures and installs it), the package library (a table of
 * installed packages: version, source, signer, installed, Complete /
 * Incomplete with a checklist; Complete setup, and Details, Upgrade, History,
 * Uninstall in the row menu), the history of every install / upgrade /
 * reconfigure / uninstall, and the packages authored here (contents, build a
 * signed version, download .utpkg, install into another workspace).
 * Builds, downloads, installs, setup completion and uninstalls run as
 * background jobs (lib/user-jobs/kinds/packages.ts): quick ones finish in
 * place, long ones report through the completion popup and the Jobs panel.
 */

import { Fragment, useEffect, useState } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Boxes, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Download, Hammer, History, Info, LayoutGrid, MoreHorizontal, PackagePlus, Pencil, Send, Trash2, Upload } from 'lucide-react'
import { usePermissions } from '@/lib/permissions-context'
import { cn } from '@/lib/utils'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { formatBytes } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Card } from '@/components/ui/card'
import { Badge, StatusPill, Tag } from '@/components/ui/badge'
import { InlineNotice } from '@/components/ui/inline-notice'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Tooltip } from '@/components/ui/tooltip'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
import { GalleryPicker, type GalleryPickerTab } from './gallery-picker'
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

const LIBRARY_COLUMNS = 6

/** A 32px dashed line in the toolbar: drop a .utpkg on it, or click to choose one. Opens the import wizard. */
function DropZone({ onFile, disabled }: { onFile: (file: File) => void; disabled?: boolean }) {
  const [dragging, setDragging] = useState(false)
  const id = 'package-drop-input'
  return (
    <label htmlFor={id} data-testid="package-dropzone"
      onDragOver={(event) => { if (disabled) return; event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file && !disabled) onFile(file) }}
      className={cn(
        'flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 text-ui text-fg-muted transition-colors duration-[var(--ds-dur-fast)]',
        dragging ? 'border-primary bg-primary-wash text-fg' : 'border-border-strong hover:bg-subtle hover:text-fg',
      )}>
      <input id={id} type="file" accept=".utpkg,application/zip" className="sr-only" disabled={disabled} data-testid="package-drop-file"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onFile(file) }} />
      <Upload size={14} aria-hidden />
      <span className="truncate">{dragging ? 'Drop to import' : <>Drop a <code className="font-mono text-xs">.utpkg</code> or <span className="text-primary-text underline underline-offset-2">choose a file</span></>}</span>
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
  const [galleryTab, setGalleryTab] = useState<GalleryPickerTab>('packages')
  // ?gallery=form-controls / workflow-actions (Extensibility → Browse gallery) opens the picker on that tab.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('gallery')
    if (!wanted) return
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of the URL after hydration */
    setGalleryTab(wanted === 'form-controls' ? 'controls' : wanted === 'workflow-actions' ? 'actions' : 'packages')
    setGalleryOpen(true)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  const installs = useQuery({ queryKey: ['package-installs'], queryFn: async () => { const r = await listInstallsAction(); if (!r.ok) throw new Error(r.error); return r.data }, enabled: canView })
  const authored = useQuery({ queryKey: ['packages'], queryFn: async () => { const r = await listPackagesAction(); if (!r.ok) throw new Error(r.error); return r.data }, enabled: canView })
  const targets = useQuery({ queryKey: ['package-install-targets'], queryFn: async () => { const r = await listInstallTargetsAction(); return r.ok ? r.data : [] }, enabled: canView && canManage })

  if (!canView) return <p className="text-sm text-fg-muted">Not authorized.</p>
  if (installs.isLoading && !installs.data) return <PageSkeleton variant="settings" />
  const refresh = () => {
    // An install can add form controls (Extensibility → Form controls) as well as workflows.
    for (const key of ['package-installs', 'packages', 'package-events', 'form-controls-library']) void queryClient.invalidateQueries({ queryKey: [key] })
  }
  const importFile = async (file: File) => {
    if (!/\.utpkg$/i.test(file.name) && file.type !== 'application/zip') { setNotice({ tone: 'error', message: `“${file.name}” is not a .utpkg package file.` }); return }
    setWizard({ open: true, file: { name: file.name, base64: await fileToBase64(file) }, source: 'file' })
  }
  const showHistory = (packageUid?: string) => { setHistoryFilters(packageUid ? { package: packageUid } : {}); setTab('history') }
  const list = installs.data ?? []
  const authoredList = authored.data ?? []
  const newPackage = () => { setTab('authored'); setEditor({ open: true, pkg: null }) }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Packages"
        description={<>Import a process — a workflow and everything it uses — as one signed package, keep it up to date, and remove it with all its artifacts. Credentials never travel: imports ask for them, or stay incomplete until you add them. <Link href="/docs/packages" className="text-primary-text underline underline-offset-2">Read the docs</Link></>}
        actions={<>
          {canManage && <Button variant="secondary" leadingIcon={<PackagePlus />} onClick={newPackage}>New package</Button>}
          {canInstall && <Button variant="secondary" leadingIcon={<LayoutGrid />} onClick={() => { setGalleryTab('packages'); setGalleryOpen(true) }} data-testid="browse-gallery">Browse gallery</Button>}
          {canInstall && <Button leadingIcon={<Upload />} onClick={() => setWizard({ open: true, source: 'file' })} data-testid="install-package">Import package</Button>}
        </>}
        tabs={<Tabs aria-label="Packages" value={tab} onValueChange={(next) => { if (next === 'history') showHistory(); else setTab(next) }}
          items={[{ value: 'library', label: 'Installed', count: list.length }, { value: 'history', label: 'History' }, { value: 'authored', label: 'Authored here', count: authoredList.length }]} />}
      />
      {canInstall && <GalleryPicker open={galleryOpen} initialTab={galleryTab} onOpenChange={setGalleryOpen} installedUids={new Set(list.map((install: any) => String(install.package_uid)))} onPick={(file) => setWizard({ open: true, file, source: 'file' })} />}

      <div className="space-y-4">
        {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}

        {tab === 'library' && (
          <>
            {canInstall && (
              <div className="flex items-center gap-3">
                <DropZone onFile={(file) => void importFile(file)} />
                <p className="hidden shrink-0 text-xs text-fg-muted lg:block">From a terminal: <code className="font-mono">usertasks packages install file.utpkg</code></p>
              </div>
            )}
            {list.length === 0 ? (
              <Card padding="none">
                <EmptyState icon={Boxes} title="No packages installed"
                  description={canInstall ? 'Import a .utpkg, or pick one from the gallery. You see exactly what changes before anything is installed.' : <>Importing packages needs the <code className="font-mono">packages.install</code> permission.</>}
                  action={canInstall ? { label: 'Browse gallery', onClick: () => { setGalleryTab('packages'); setGalleryOpen(true) } } : undefined} />
              </Card>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Package</TH>
                    <TH>Source</TH>
                    <TH>Signature</TH>
                    <TH>Installed</TH>
                    <TH>Status</TH>
                    <TH><span className="sr-only">Actions</span></TH>
                  </tr>
                </THead>
                <TBody>
                  {list.map((install) => (
                    <InstallRow key={install.id} install={install} canInstall={canInstall} onChanged={refresh} onNotice={setNotice}
                      onHistory={() => showHistory(install.package_uid)}
                      onUpgrade={() => setWizard({ open: true, upgrade: { name: install.name, package_uid: install.package_uid }, source: 'file' })} />
                  ))}
                </TBody>
              </Table>
            )}
          </>
        )}

        {tab === 'history' && (
          <PackageHistory filters={historyFilters} onFiltersChange={setHistoryFilters}
            packages={list.map((i) => ({ value: i.package_uid, label: i.name }))} />
        )}

        {tab === 'authored' && (
          authoredList.length === 0 ? (
            <Card padding="none">
              <EmptyState icon={PackagePlus} title="No packages authored here"
                description="Start from a workflow: its custom steps, rules, tables, integrations, connectors, templates and agents are included automatically."
                action={canManage ? { label: 'New package', onClick: () => setEditor({ open: true, pkg: null }) } : undefined} />
            </Card>
          ) : (
            <div className="space-y-3">
              {authoredList.map((pkg) => (
                <AuthoredCard key={pkg.id} pkg={pkg} canManage={canManage} targets={targets.data ?? []} onEdit={() => setEditor({ open: true, pkg })} onChanged={refresh} onNotice={setNotice}
                  onInstallElsewhere={(file, target) => setWizard({ open: true, file, target, source: 'library' })} />
              ))}
            </div>
          )
        )}
      </div>

      <InstallWizard open={wizard.open} expectUpgradeOf={wizard.upgrade} initialFile={wizard.file ?? null} target={wizard.target ?? null} source={wizard.source}
        onOpenChange={(open) => setWizard((prev) => (open ? { ...prev, open } : { open: false }))} onInstalled={refresh} />
      {editor.open && <PackageEditor open={editor.open} pkg={editor.pkg} onOpenChange={(open) => setEditor((prev) => ({ ...prev, open }))} onSaved={(name) => { setNotice({ tone: 'success', message: `Saved “${name}”.` }); refresh() }} />}
    </div>
  )
}

function InstallStatus({ status, count }: { status: string; count: number }) {
  const complete = status === 'complete'
  return <StatusPill status={status} tone={complete ? 'success' : 'warning'} label={complete ? 'Complete' : `Incomplete · ${count} to configure`} data-testid="install-status" />
}

function sourceLabel(install: Install): string {
  if (install.source === 'file') return install.source_label ?? 'file'
  return install.source_label ? `${install.source} · ${install.source_label}` : String(install.source)
}

function InstallRow({ install, canInstall, onChanged, onNotice, onUpgrade, onHistory }: { install: Install; canInstall: boolean; onChanged: () => void; onNotice: (n: Notice) => void; onUpgrade: () => void; onHistory: () => void }) {
  const [expanded, setExpanded] = useState(install.status === 'incomplete')
  const [completeOpen, setCompleteOpen] = useState(false)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const details = useQuery({ queryKey: ['package-install', install.id], queryFn: async () => { const r = await getInstallAction(install.id); if (!r.ok) throw new Error(r.error); return r.data }, enabled: expanded })
  const fingerprint = String(install.fingerprint ?? '')

  return (
    <Fragment>
      <TR data-testid="install-card" className={cn(expanded && 'border-b-0')}>
        <TD className="max-w-[18rem]">
          <div className="flex min-w-0 items-center gap-2">
            <IconButton size="sm" label={expanded ? `Hide details of ${install.name}` : `Show details of ${install.name}`} icon={expanded ? <ChevronDown /> : <ChevronRight />} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} className="-ml-1.5" />
            <span className="truncate font-medium text-fg">{install.name}</span>
            <Tag mono>v{install.version}</Tag>
          </div>
          {install.previous_version && <p className="pl-7 text-xs text-fg-muted">Upgraded from {install.previous_version}</p>}
        </TD>
        <TD className="max-w-[14rem]"><span className="block truncate font-mono text-xs text-fg-muted" title={sourceLabel(install)}>{sourceLabel(install)}</span></TD>
        <TD>
          {install.signed
            ? <Tooltip content={fingerprint ? <span className="font-mono">{fingerprint}</span> : 'Signed'}><span><Badge tone="success">Signed</Badge></span></Tooltip>
            : <span className="text-xs text-fg-muted">Unsigned</span>}
        </TD>
        <TD className="num whitespace-nowrap text-fg-muted">
          <Tooltip content={formatAbsolute(install.installed_at)}><span>{formatRelative(install.installed_at)}</span></Tooltip>
        </TD>
        <TD><InstallStatus status={install.status} count={install.incomplete_count} /></TD>
        <TD className="w-px whitespace-nowrap text-right">
          <div className="inline-flex items-center gap-1">
            {canInstall && install.status === 'incomplete' && <Button size="sm" onClick={() => setCompleteOpen(true)} data-testid="complete-setup">Complete setup</Button>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><IconButton size="sm" label={`More actions for ${install.name}`} icon={<MoreHorizontal />} /></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem icon={<Info />} onSelect={() => setExpanded((v) => !v)}>{expanded ? 'Hide details' : 'Details'}</DropdownMenuItem>
                {canInstall && <DropdownMenuItem icon={<Upload />} onSelect={onUpgrade}>Upgrade</DropdownMenuItem>}
                <DropdownMenuItem icon={<History />} onSelect={onHistory} data-testid="install-history">History</DropdownMenuItem>
                {canInstall && <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem danger icon={<Trash2 />} onSelect={() => setUninstallOpen(true)} data-testid="install-uninstall">Uninstall</DropdownMenuItem>
                </>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <CompleteSetupDialog open={completeOpen} onOpenChange={setCompleteOpen} install={install} onDone={(status) => { onNotice({ tone: status === 'complete' ? 'success' : 'warning', message: status === 'complete' ? `${install.name}: setup complete — its items are enabled.` : `${install.name}: some values are still missing.` }); onChanged() }} />
          <UninstallDialog open={uninstallOpen} onOpenChange={setUninstallOpen} install={install} onDone={(message) => { onNotice({ tone: 'success', message }); onChanged() }} onShowHistory={onHistory} />
        </TD>
      </TR>
      {expanded && (
        <tr className="border-b border-border-subtle">
          <td colSpan={LIBRARY_COLUMNS} className="px-[var(--theme-density-cell-x)] pb-4 pt-1">
            <div className="grid gap-6 rounded-md bg-subtle p-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium text-fg-muted">Setup checklist</p>
                {install.checklist.length === 0 ? <p className="text-ui text-fg-muted">Nothing to configure.</p> : (
                  <ul className="space-y-1.5" data-testid="install-checklist">
                    {install.checklist.map((item: any) => (
                      <li key={item.id} className="flex items-start gap-2 text-ui text-fg">
                        {item.status === 'missing' ? <CircleAlert size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden /> : <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" aria-hidden />}
                        <span>{item.label}{item.status === 'missing' && <span className="text-xs text-fg-muted"> — needs configuration</span>}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-fg-muted">Installed assets</p>
                <ul className="max-h-48 space-y-1 overflow-y-auto scrollbar-thin text-ui">
                  {(details.data?.assets ?? []).filter((a: any) => a.section !== 'references').map((asset: any) => (
                    <li key={asset.id} className="flex items-center gap-2">
                      <span className="w-28 shrink-0 text-xs text-fg-muted first-letter:uppercase">{String(asset.section).replace(/_/g, ' ')}</span>
                      <span className="truncate text-fg">{asset.name}</span>
                      {asset.status === 'needs_config' && <Badge tone="warning">Needs configuration</Badge>}
                      {asset.status === 'removed_upstream' && <Badge>Not in this version</Badge>}
                    </li>
                  ))}
                  {details.data && details.data.data_rows > 0 && <li className="num text-xs text-fg-muted">{plural(details.data.data_rows, 'table row')}</li>}
                </ul>
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function CompleteSetupDialog({ open, onOpenChange, install, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; install: Install; onDone: (status: string) => void }) {
  const jobs = useJobs()
  const [values, setValues] = useState<RequirementValues>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requirements = install.requirements as RequirementView[]
  // Synchronous guard: two clicks in one frame both see busy === false.
  const submitGuard = useSubmitGuard()
  const submit = async () => {
    await submitGuard.run(async () => {
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
    })
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Complete setup — ${install.name}`}
      description="Add the missing values. Connections are enabled and the package’s workflows activated once everything required is set. Saved values are kept on upgrades."
      footer={<>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button onClick={() => void submit()} loading={busy} data-testid="complete-submit">{missingCount(requirements, values) ? 'Save (still incomplete)' : 'Complete setup'}</Button>
      </>}>
      {error && <InlineNotice tone="error" message={error} className="mb-3" />}
      <RequirementsForm requirements={requirements} values={values} onChange={setValues} />
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
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const detail = useQuery({ queryKey: ['package', pkg.id], queryFn: async () => { const r = await getPackageAction(pkg.id); if (!r.ok) throw new Error(r.error); return r.data } })
  // Synchronous guard: two clicks in one frame both see busy === false.
  const buildGuard = useSubmitGuard()
  // Build + sign + download as a background job: the popup offers the .utpkg.
  const build = async () => {
    await buildGuard.run(async () => {
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
    })
  }
  const download = async (v: string) => {
    try {
      await jobs.start('package.download', { package_id: pkg.id, version: v, name: pkg.name }, { effect: 'download', pendingMessage: `Preparing ${pkg.name} ${v}…` })
    } catch (startError) {
      onNotice({ tone: 'error', message: startError instanceof Error ? startError.message : 'Could not start the download' })
    }
  }
  const remove = async () => {
    setDeleting(true)
    const r = await deletePackageAction(pkg.id)
    setDeleting(false)
    setDeleteOpen(false)
    if (r.ok) onChanged(); else onNotice({ tone: 'error', message: r.error })
  }
  const continueElsewhere = async () => {
    setBusy(true)
    const result = await downloadPackageVersionAction(pkg.id, targetVersion)
    setBusy(false)
    if (!result.ok) { onNotice({ tone: 'error', message: result.error }); return }
    const target = targets.find((t) => t.id === targetId)!
    setElsewhereOpen(false)
    onInstallElsewhere({ name: result.data.file_name, base64: result.data.file_base64 }, { tenantId: target.id, name: target.name })
  }
  const versions = (detail.data?.versions ?? []) as any[]
  const contents = [plural(pkg.roots.length, 'root'), pkg.items.length ? `${pkg.items.length} added` : '', pkg.excluded.length ? `${pkg.excluded.length} left out` : ''].filter(Boolean).join(', ')
  return (
    <Card padding="none">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-fg">{pkg.name} {pkg.latest_version && <Tag mono>v{pkg.latest_version}</Tag>}</p>
          {pkg.description && <p className="mt-1 text-sm text-fg-muted">{pkg.description}</p>}
          <p className="mt-1 text-xs text-fg-muted"><span className="font-mono">{pkg.slug}</span> · {contents}</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" leadingIcon={<Pencil />} onClick={onEdit}>Edit</Button>
            <Button size="sm" leadingIcon={<Hammer />} onClick={() => setBuildOpen(true)} data-testid="build-version">Build version</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><IconButton size="sm" label={`More actions for ${pkg.name}`} icon={<MoreHorizontal />} /></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {targets.length > 0 && pkg.latest_version && (
                  <DropdownMenuItem icon={<Send />} onSelect={() => { setTargetId(targets[0].id); setElsewhereOpen(true) }} data-testid="install-elsewhere">Install in another workspace</DropdownMenuItem>
                )}
                {targets.length > 0 && pkg.latest_version && <DropdownMenuSeparator />}
                <DropdownMenuItem danger icon={<Trash2 />} onSelect={() => setDeleteOpen(true)}>Delete package</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {versions.length > 0 && (
        <ul className="divide-y divide-border-subtle border-t border-border-subtle">
          {versions.slice(0, 5).map((v) => (
            <li key={v.id} className="flex h-[var(--theme-density-row-height)] items-center gap-3 px-4 text-ui">
              <span className="w-16 font-mono text-xs text-fg">{v.version}</span>
              <span className="num min-w-0 flex-1 truncate text-xs text-fg-muted">
                {plural(v.asset_count, 'asset')} · {formatBytes(v.size_bytes)} · {v.signed ? 'signed' : 'unsigned'} · <Tooltip content={formatAbsolute(v.created_at)}><span>{formatRelative(v.created_at)}</span></Tooltip>
              </span>
              <Button size="sm" variant="ghost" leadingIcon={<Download />} onClick={() => void download(v.version)}>.utpkg</Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} destructive busy={deleting}
        title={`Delete “${pkg.name}”?`} description="Its built versions are deleted too. Installs in other workspaces are not affected."
        confirmLabel="Delete package" onConfirm={remove} />
      <Modal open={elsewhereOpen} onOpenChange={setElsewhereOpen} size="sm" title={`Install ${pkg.name} in another workspace`}
        description="Takes a built version of this package and opens the import wizard for a workspace you belong to (and can install packages in)."
        footer={<>
          <Button variant="secondary" onClick={() => setElsewhereOpen(false)}>Cancel</Button>
          <Button leadingIcon={<Send />} disabled={!targetId} loading={busy} onClick={() => void continueElsewhere()}>Continue</Button>
        </>}>
        <div className="space-y-4">
          <Field label="Workspace">
            <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} options={targets.map((t) => ({ value: t.id, label: t.name }))} />
          </Field>
          <Field label="Version">
            <Select value={targetVersion} onChange={(e) => setTargetVersion(e.target.value)}
              options={[{ value: 'latest', label: `Latest (${pkg.latest_version})` }, ...versions.map((v) => ({ value: String(v.version), label: String(v.version) }))]} />
          </Field>
        </div>
      </Modal>
      <Modal open={buildOpen} onOpenChange={setBuildOpen} size="sm" title={`Build ${pkg.name}`}
        description="Exports the current state of every item (secrets removed), signs it with this instance’s key and prepares the .utpkg in the background — we’ll let you know when it’s ready to download."
        footer={<>
          <Button variant="secondary" onClick={() => setBuildOpen(false)} disabled={busy}>Cancel</Button>
          <Button leadingIcon={<Hammer />} onClick={() => void build()} loading={busy} data-testid="build-submit">Build &amp; download</Button>
        </>}>
        {error && <InlineNotice tone="error" message={error} className="mb-3" />}
        <div className="space-y-4">
          <Field label="Version" optional description={pkg.latest_version ? `Leave empty for the next patch after ${pkg.latest_version}.` : undefined}>
            <Input placeholder={pkg.latest_version ? 'Next patch' : '1.0.0'} value={version} onChange={(e) => setVersion(e.target.value)} className="font-mono" />
          </Field>
          <Field label="Release notes" optional>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </Card>
  )
}
