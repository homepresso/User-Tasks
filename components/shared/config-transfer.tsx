'use client'

/**
 * Consistent single-asset Export / Import for every configuration type.
 *
 *  <ExportAssetButton ids={[id]} name="Invoice approval" />   prepares
 *     `<name>.usertasks.json` (a config manifest; optional dependencies and,
 *     for data tables, rows) as a background job (`config.export`): the
 *     popup / Jobs panel offers the download when it is ready
 *  <ImportConfigButton />   uploads such a file (or any per-type export),
 *     shows the dry-run plan, then applies it as a job (`config.apply`)
 *
 * Both use lib/services/config, so files are interchangeable with GET
 * /config/export, MCP config_export and `usertasks config export --ids`.
 */

import { useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Download, FileUp, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { importConfigAction } from '@/app/actions/config-transfer'
import type { ConfigApplyResult } from '@/lib/services/config'
import { useJobs } from '@/components/jobs/jobs-provider'

function DialogShell({ open, onOpenChange, title, children, wide = false }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 ${wide ? 'w-[min(44rem,94vw)]' : 'w-[min(26rem,92vw)]'} max-h-[88vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-xl p-6 shadow-xl dialog-content`}
          style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close aria-label="Close" className="opacity-60 hover:opacity-100"><X size={16} /></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm cursor-pointer">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-xs" style={{ color: 'var(--theme-muted-text)' }}>{hint}</span>}
      </span>
    </label>
  )
}

export function ExportAssetButton({
  ids,
  name,
  allowRows = false,
  size = 'sm',
  variant = 'outline',
  label = 'Export',
  iconOnly = false,
  className,
  style,
}: {
  ids: string[]
  name: string
  /** Data tables: offer "Include rows". */
  allowRows?: boolean
  size?: 'sm' | 'default' | 'icon'
  variant?: 'outline' | 'ghost' | 'default'
  label?: string
  iconOnly?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  return (
    // Safe inside a row <Link>: the click never reaches the anchor, and
    // clicks inside the (portalled) dialog don't bubble to it either.
    <span className="contents" onClick={(event) => event.stopPropagation()}>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        style={style}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(true) }}
        title={`Export ${name}`}
        aria-label={iconOnly ? `Export ${name}` : undefined}
        data-testid="export-asset"
      >
        <Download size={iconOnly ? 12 : 14} />
        {!iconOnly && label}
      </Button>
      <ExportAssetDialog ids={ids} name={name} allowRows={allowRows} open={open} onOpenChange={setOpen} />
    </span>
  )
}

/**
 * The export dialog on its own, for row menus (render it outside the menu and
 * open it from a menu item).
 */
export function ExportAssetDialog({
  ids,
  name,
  allowRows = false,
  open,
  onOpenChange,
}: {
  ids: string[]
  name: string
  allowRows?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const jobs = useJobs()
  const [withDependencies, setWithDependencies] = useState(true)
  const [includeRows, setIncludeRows] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A background job: the dialog closes at once, the popup offers the file.
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await jobs.start('config.export', { ids, name, with_dependencies: withDependencies, include_rows: allowRows && includeRows }, {
        effect: 'download', pendingMessage: `Preparing your export of “${name}”…`, quiet: false,
      })
      onOpenChange(false)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start the export')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title={`Export “${name}”`}>
      <p className="text-xs mb-4" style={{ color: 'var(--theme-muted-text)' }}>
        Prepares a configuration file you can import into another workspace (Import button, <code>usertasks config apply</code> or the API).
        It runs in the background — keep working, we&apos;ll let you know when it&apos;s ready to download. Secrets and credentials are never included.
      </p>
      <div className="space-y-3 mb-4">
        <Check checked={withDependencies} onChange={setWithDependencies} label="Include dependencies" hint="Sub-workflows, activities, rules, data tables, integrations and connectors, email templates, agents and custom roles it uses" />
        {allowRows && <Check checked={includeRows} onChange={setIncludeRows} label="Include table rows" hint="Up to 10,000 rows per table" />}
      </div>
      {error && <InlineNotice tone="error" message={error} className="mb-3" />}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={() => void run()} disabled={busy || ids.length === 0}>
          <Download size={14} /> {busy ? 'Starting…' : 'Export'}
        </Button>
      </div>
    </DialogShell>
  )
}

const ACTION_STYLE: Record<string, { label: string; color: string }> = {
  create: { label: 'Create', color: 'var(--theme-success)' },
  update: { label: 'Update', color: 'var(--theme-warning)' },
  unchanged: { label: 'Unchanged', color: 'var(--theme-muted-text)' },
  error: { label: 'Error', color: 'var(--theme-danger)' },
}

export function PlanList({ plan }: { plan: ConfigApplyResult['plan'] }) {
  return (
    <div className="rounded-lg border divide-y text-sm" style={{ borderColor: 'var(--theme-surface-border)' }}>
      {plan.assets.map((asset, index) => (
        <div key={`${asset.section}:${asset.source_id ?? index}`} className="px-3 py-2" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold w-20 shrink-0" style={{ color: ACTION_STYLE[asset.action]?.color }}>{ACTION_STYLE[asset.action]?.label ?? asset.action}</span>
            <span className="text-xs w-32 shrink-0 truncate" style={{ color: 'var(--theme-muted-text)' }}>{asset.section.replace(/_/g, ' ')}</span>
            <span className="truncate">{asset.name}</span>
          </div>
          {asset.error && <p className="text-xs mt-1 ml-[5.5rem]" style={{ color: 'var(--theme-danger)' }}>{asset.error}</p>}
          {asset.action === 'update' && asset.diffs?.length ? (
            <ul className="text-xs mt-1 ml-[5.5rem] space-y-0.5" style={{ color: 'var(--theme-muted-text)' }}>
              {asset.diffs.slice(0, 5).map((diff) => <li key={diff.path} className="truncate">{diff.path}</li>)}
              {(asset.diffs.length > 5 || asset.diffs_truncated) && <li>… more changes</li>}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export function ImportConfigButton({
  label = 'Import',
  size = 'sm',
  variant = 'outline',
  onImported,
  allowRows = false,
}: {
  label?: string
  size?: 'sm' | 'default'
  variant?: 'outline' | 'ghost' | 'default'
  onImported?: (result: ConfigApplyResult) => void
  /** Offer the rows mode (files with data-table rows). */
  allowRows?: boolean
}) {
  const jobs = useJobs()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [document_, setDocument] = useState<unknown>(null)
  const [fileName, setFileName] = useState('')
  const [plan, setPlan] = useState<ConfigApplyResult | null>(null)
  const [applied, setApplied] = useState<ConfigApplyResult | null>(null)
  const [adoptByName, setAdoptByName] = useState(false)
  const [rowsMode, setRowsMode] = useState<'merge' | 'replace' | 'skip'>('merge')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const planFor = async (doc: unknown, adopt: boolean, mode: typeof rowsMode) => {
    setBusy(true)
    setError(null)
    const result = await importConfigAction({ document: doc, dry_run: true, adopt_by_name: adopt, rows_mode: mode })
    setBusy(false)
    if (!result.ok) { setError(result.error); setPlan(null); return }
    setPlan(result.data)
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setApplied(null)
    setPlan(null)
    setFileName(file.name)
    setOpen(true)
    try {
      const parsed = JSON.parse(await file.text())
      setDocument(parsed)
      await planFor(parsed, adoptByName, rowsMode)
    } catch {
      setError('The file is not valid JSON')
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  // The apply is a background job (`config.apply`): a quick one finishes
  // here and shows its result; a long one continues after the dialog closes
  // and reports through the popup / Jobs panel.
  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      const job = await jobs.start('config.apply', { name: fileName || 'configuration file', adopt_by_name: adoptByName, rows_mode: rowsMode }, {
        effect: 'change',
        quietIfInline: true,
        input: { text: JSON.stringify(document_) },
        onSuccess: (done) => { if (done.result?.data) onImported?.(done.result.data as ConfigApplyResult) },
      })
      if (!job) return
      if (job.status === 'succeeded' && job.result?.data) setApplied(job.result.data as ConfigApplyResult)
      else if (job.status === 'failed') setError(job.error ?? 'The import failed')
      else setOpen(false)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start the import')
    } finally {
      setBusy(false)
    }
  }

  const hasRows = Boolean(plan?.plan.assets.some((asset) => asset.section === 'table_rows'))
  const summary = plan?.plan.summary
  const changes = summary ? summary.create + summary.update : 0
  const created = applied?.result ? Object.values(applied.result.created).reduce((a, b) => a + b, 0) : 0
  const updated = applied?.result ? Object.values(applied.result.updated).reduce((a, b) => a + b, 0) : 0

  return (
    <>
      <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" data-testid="import-config-file" onChange={(event) => void onFile(event.target.files?.[0])} />
      <Button type="button" size={size} variant={variant} onClick={() => inputRef.current?.click()} data-testid="import-config">
        <Upload size={14} /> {label}
      </Button>
      <DialogShell open={open} onOpenChange={setOpen} title="Import configuration" wide>
        <p className="text-xs mb-3 flex items-center gap-1.5" style={{ color: 'var(--theme-muted-text)' }}>
          <FileUp size={12} /> {fileName || 'No file'} — nothing is deleted; assets imported before are updated in place.
        </p>
        {error && <InlineNotice tone="error" message={error} className="mb-3" />}
        {busy && !plan && <p className="text-sm">Checking the file…</p>}
        {plan && !applied && (
          <>
            {summary && (
              <p className="text-sm mb-2">
                {summary.create} to create, {summary.update} to update, {summary.unchanged} unchanged{summary.error ? `, ${summary.error} with errors` : ''}.
              </p>
            )}
            <PlanList plan={plan.plan} />
            {(plan.warnings?.length ?? 0) > 0 && (
              <ul className="mt-3 space-y-1">
                {plan.warnings.map((warning, index) => <li key={index}><InlineNotice tone="warning" message={warning.warning} /></li>)}
              </ul>
            )}
            {plan.missing_permissions?.length ? (
              <InlineNotice tone="error" className="mt-3" message={`You need ${[...new Set(plan.missing_permissions.map((m) => m.permission))].join(', ')} to import this file.`} />
            ) : null}
            <div className="mt-4 space-y-2">
              <Check checked={adoptByName} onChange={(value) => { setAdoptByName(value); void planFor(document_, value, rowsMode) }} label="Match existing assets by name" hint="Update an asset with the same unique name instead of creating a copy" />
              {(hasRows || allowRows) && (
                <label className="flex items-center gap-2 text-sm">
                  Table rows
                  <select className="rounded border px-2 py-1 text-sm" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }} value={rowsMode}
                    onChange={(event) => { const mode = event.target.value as typeof rowsMode; setRowsMode(mode); void planFor(document_, adoptByName, mode) }}>
                    <option value="merge">Merge (update, then add)</option>
                    <option value="replace">Replace all rows</option>
                    <option value="skip">Skip rows</option>
                  </select>
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button size="sm" onClick={() => void apply()} disabled={busy || changes === 0 || Boolean(plan.missing_permissions?.length)} data-testid="import-config-apply">
                {busy ? 'Importing…' : changes === 0 ? 'Nothing to import' : `Import ${changes} change${changes === 1 ? '' : 's'}`}
              </Button>
            </div>
          </>
        )}
        {applied && (
          <>
            <InlineNotice tone={applied.result?.errors.length ? 'warning' : 'success'} message={`Imported: ${created} created, ${updated} updated${applied.result?.errors.length ? `, ${applied.result.errors.length} failed` : ''}.`} />
            {applied.result?.errors.map((e, index) => <p key={index} className="text-xs mt-2" style={{ color: 'var(--theme-danger)' }}>{e.asset_type}: {e.error}</p>)}
            {[...(applied.warnings ?? []), ...(applied.result?.warnings ?? [])].map((w, index) => <p key={`w${index}`} className="text-xs mt-2" style={{ color: 'var(--theme-warning)' }}>{w.warning}</p>)}
            <div className="flex justify-end mt-4"><Button size="sm" onClick={() => setOpen(false)}>Done</Button></div>
          </>
        )}
      </DialogShell>
    </>
  )
}
