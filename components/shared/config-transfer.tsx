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
 *  useImportConfig()   the same import flow without its button, for menus
 *     ("Import ▾ → Configuration file…")
 *
 * Both use lib/services/config, so files are interchangeable with GET
 * /config/export, MCP config_export and `usertasks config export --ids`.
 */

import { useRef, useState, type ReactNode } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { Download, FileUp, Upload } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { InlineNotice } from '@/components/ui/inline-notice'
import { importConfigAction } from '@/app/actions/config-transfer'
import type { ConfigApplyResult } from '@/lib/services/config'
import { useJobs } from '@/components/jobs/jobs-provider'
import { plural } from '@/lib/format/plural'
import { cn } from '@/lib/utils'

export function ExportAssetButton({
  ids,
  name,
  allowRows = false,
  size = 'sm',
  variant = 'secondary',
  label = 'Export',
  iconOnly = false,
  className,
  style,
}: {
  ids: string[]
  name: string
  /** Data tables: offer "Include rows". */
  allowRows?: boolean
  /** Any Button size; with `iconOnly`, `sm`/`icon-sm` render a 28px IconButton, anything else 32px. */
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
  label?: string
  iconOnly?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const onClick = (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); setOpen(true) }
  return (
    // Safe inside a row <Link>: the click never reaches the anchor, and
    // clicks inside the (portalled) dialog don't bubble to it either.
    <span className="contents" onClick={(event) => event.stopPropagation()}>
      {iconOnly ? (
        <IconButton
          type="button"
          label={`Export ${name}`}
          icon={<Download />}
          size={size === 'sm' || size === 'icon-sm' ? 'sm' : 'md'}
          variant={variant === 'secondary' || variant === 'outline' ? 'ghost' : variant}
          className={className}
          style={style}
          onClick={onClick}
          data-testid="export-asset"
        />
      ) : (
        <Button
          type="button"
          size={size}
          variant={variant}
          className={className}
          style={style}
          leadingIcon={<Download />}
          onClick={onClick}
          data-testid="export-asset"
        >
          {label}
        </Button>
      )}
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title={`Export “${name}”`}
        description="A configuration file you can import into another workspace. Secrets and credentials are never included."
      >
        <DialogBody className="space-y-4">
          <p className="text-ui text-fg-muted">
            It is prepared in the background: keep working, and we&apos;ll let you know when it&apos;s ready to download. Import it with
            the Import button, <code className="font-mono text-xs">usertasks config apply</code> or the API.
          </p>
          <div className="space-y-3">
            <Checkbox
              checked={withDependencies}
              onChange={(event) => setWithDependencies(event.target.checked)}
              label="Include dependencies"
              description="Sub-workflows, activities, rules, data tables, integrations and connectors, email templates, agents and custom roles it uses"
            />
            {allowRows && (
              <Checkbox
                checked={includeRows}
                onChange={(event) => setIncludeRows(event.target.checked)}
                label="Include table rows"
                description="Up to 10,000 rows per table"
              />
            )}
          </div>
          {error && <InlineNotice tone="danger" message={error} />}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void run()} loading={busy} disabled={ids.length === 0} leadingIcon={<Download />}>
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const ACTION_STYLE: Record<string, { label: string; className: string }> = {
  create: { label: 'Create', className: 'text-success' },
  update: { label: 'Update', className: 'text-warning' },
  unchanged: { label: 'Unchanged', className: 'text-fg-muted' },
  error: { label: 'Error', className: 'text-danger' },
}

export function PlanList({ plan }: { plan: ConfigApplyResult['plan'] }) {
  return (
    <div className="divide-y divide-border-subtle rounded-lg border border-border text-ui">
      {plan.assets.map((asset, index) => (
        <div key={`${asset.section}:${asset.source_id ?? index}`} className="px-3 py-2">
          <div className="flex items-center gap-2">
            <span className={cn('w-20 shrink-0 text-xs font-medium', ACTION_STYLE[asset.action]?.className)}>{ACTION_STYLE[asset.action]?.label ?? asset.action}</span>
            <span className="w-32 shrink-0 truncate text-xs text-fg-muted">{asset.section.replace(/_/g, ' ')}</span>
            <span className="truncate">{asset.name}</span>
          </div>
          {asset.error && <p className="mt-1 ml-[5.5rem] text-xs text-danger">{asset.error}</p>}
          {asset.action === 'update' && asset.diffs?.length ? (
            <ul className="mt-1 ml-[5.5rem] space-y-0.5 text-xs text-fg-muted">
              {asset.diffs.slice(0, 5).map((diff) => <li key={diff.path} className="truncate font-mono">{diff.path}</li>)}
              {(asset.diffs.length > 5 || asset.diffs_truncated) && <li>… more changes</li>}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/**
 * The import flow without a button: `pick()` opens the file chooser, and
 * `element` (the hidden input plus the plan dialog) must be rendered once.
 */
export function useImportConfig({ onImported, allowRows = false }: { onImported?: (result: ConfigApplyResult) => void; allowRows?: boolean } = {}): { pick: () => void; element: ReactNode } {
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
  // Synchronous guard: a double click must not apply the import twice.
  const applyGuard = useSubmitGuard()
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
    await applyGuard.run(async () => {
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
    })
  }

  const hasRows = Boolean(plan?.plan.assets.some((asset) => asset.section === 'table_rows'))
  const summary = plan?.plan.summary
  const changes = summary ? summary.create + summary.update : 0
  const created = applied?.result ? Object.values(applied.result.created).reduce((a, b) => a + b, 0) : 0
  const updated = applied?.result ? Object.values(applied.result.updated).reduce((a, b) => a + b, 0) : 0

  const element = (
    <>
      <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" data-testid="import-config-file" onChange={(event) => void onFile(event.target.files?.[0])} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          size="lg"
          title="Import configuration"
          description={<span className="inline-flex items-center gap-1.5"><FileUp className="size-3.5" aria-hidden="true" /> {fileName || 'No file'}: nothing is deleted, and assets imported before are updated in place.</span>}
        >
          <DialogBody className="space-y-4">
            {error && <InlineNotice tone="danger" message={error} />}
            {busy && !plan && <p className="text-ui text-fg-muted">Checking the file…</p>}
            {plan && !applied && (
              <>
                {summary && (
                  <p className="text-ui num">
                    {summary.create} to create, {summary.update} to update, {summary.unchanged} unchanged{summary.error ? `, ${summary.error} with errors` : ''}.
                  </p>
                )}
                <PlanList plan={plan.plan} />
                {(plan.warnings?.length ?? 0) > 0 && (
                  <ul className="space-y-1">
                    {plan.warnings.map((warning, index) => <li key={index}><InlineNotice tone="warning" message={warning.warning} /></li>)}
                  </ul>
                )}
                {plan.missing_permissions?.length ? (
                  <InlineNotice tone="danger" message={`You need ${[...new Set(plan.missing_permissions.map((m) => m.permission))].join(', ')} to import this file.`} />
                ) : null}
                <Checkbox
                  checked={adoptByName}
                  onChange={(event) => { const value = event.target.checked; setAdoptByName(value); void planFor(document_, value, rowsMode) }}
                  label="Match existing assets by name"
                  description="Update an asset with the same unique name instead of creating a copy"
                />
                {(hasRows || allowRows) && (
                  <Field label="Table rows" className="max-w-xs">
                    <Select
                      value={rowsMode}
                      onChange={(event) => { const mode = event.target.value as typeof rowsMode; setRowsMode(mode); void planFor(document_, adoptByName, mode) }}
                      options={[
                        { value: 'merge', label: 'Merge (update, then add)' },
                        { value: 'replace', label: 'Replace all rows' },
                        { value: 'skip', label: 'Skip rows' },
                      ]}
                    />
                  </Field>
                )}
              </>
            )}
            {applied && (
              <>
                <InlineNotice tone={applied.result?.errors.length ? 'warning' : 'success'} message={`Imported: ${created} created, ${updated} updated${applied.result?.errors.length ? `, ${applied.result.errors.length} failed` : ''}.`} />
                {applied.result?.errors.map((e, index) => <p key={index} className="text-xs text-danger">{e.asset_type}: {e.error}</p>)}
                {[...(applied.warnings ?? []), ...(applied.result?.warnings ?? [])].map((w, index) => <p key={`w${index}`} className="text-xs text-warning">{w.warning}</p>)}
              </>
            )}
          </DialogBody>
          <DialogFooter>
            {applied ? (
              <Button onClick={() => setOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
                {plan && (
                  <Button onClick={() => void apply()} loading={busy} disabled={changes === 0 || Boolean(plan.missing_permissions?.length)} data-testid="import-config-apply">
                    {changes === 0 ? 'Nothing to import' : `Import ${plural(changes, 'change')}`}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  return { pick: () => inputRef.current?.click(), element }
}

export function ImportConfigButton({
  label = 'Import',
  size = 'sm',
  variant = 'secondary',
  onImported,
  allowRows = false,
}: {
  label?: string
  /** Any Button size (`default` = md is still accepted). */
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
  onImported?: (result: ConfigApplyResult) => void
  /** Offer the rows mode (files with data-table rows). */
  allowRows?: boolean
}) {
  const { pick, element } = useImportConfig({ onImported, allowRows })
  return (
    <>
      <Button type="button" size={size} variant={variant} leadingIcon={<Upload />} onClick={pick} data-testid="import-config">
        {label}
      </Button>
      {element}
    </>
  )
}
