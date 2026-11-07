'use client'

/**
 * Import (install / upgrade) wizard: 1 Package (verify, readme, contents) →
 * 2 Changes (dry-run plan: create / update / unchanged, changed locally,
 * removed in this version, data rows per table) → 3 Configure (requirement
 * values, or keep the install incomplete) → 4 Done.
 *
 * The file comes from the picker / drop zone in step 1, or pre-loaded
 * (`initialFile`: dropped on the Packages page, or a version of a package
 * authored here, installed into another workspace via `target`).
 */

import { useEffect, useRef, useState } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { BadgeCheck, Check, FileWarning, PackageOpen, ShieldAlert, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { plural } from '@/lib/format/plural'
import { Button } from '@/components/ui/button'
import { Badge, type Tone } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/select'
import { Tooltip } from '@/components/ui/tooltip'
import { InlineNotice } from '@/components/ui/inline-notice'
import { inspectPackageFileAction, planInstallAction } from '@/app/actions/packages'
import { useJobs } from '@/components/jobs/jobs-provider'
import { cleanValues, missingCount, Modal, RequirementsForm, type RequirementValues, type RequirementView } from './requirements-form'

type Inspect = Extract<Awaited<ReturnType<typeof inspectPackageFileAction>>, { ok: true }>['data']
type Plan = Extract<Awaited<ReturnType<typeof planInstallAction>>, { ok: true }>['data']
type RowMode = 'merge' | 'replace' | 'skip'

const STEPS = ['Package', 'Changes', 'Configure', 'Done'] as const
/** Changes first, then what stays the same. */
const ACTION_ORDER: Record<string, number> = { error: 0, update: 1, create: 2, unchanged: 3 }

const ACTION_TONE: Record<string, Tone> = { create: 'success', update: 'warning', unchanged: 'neutral', error: 'danger' }

export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function SignatureBadge({ verification }: { verification: { signed: boolean; signature_ok: boolean | null; fingerprint: string | null; trust: string; valid: boolean } }) {
  if (!verification.valid) return <Badge tone="danger"><ShieldAlert size={14} aria-hidden /> Modified or corrupt</Badge>
  if (!verification.signed) return <Badge tone="warning"><FileWarning size={14} aria-hidden /> Unsigned</Badge>
  const label = verification.trust === 'instance' ? 'Signed by this instance' : verification.trust === 'trusted' ? 'Signed by a trusted key' : 'Signed by an unknown key'
  return (
    <Tooltip content={verification.fingerprint ? <span className="font-mono">{verification.fingerprint}</span> : null}>
      <span className="inline-flex items-center gap-2">
        <Badge tone={verification.trust === 'untrusted' ? 'warning' : 'success'}><BadgeCheck size={14} aria-hidden /> {label}</Badge>
        {verification.fingerprint && <code className="font-mono text-2xs text-fg-muted">{verification.fingerprint.slice(0, 23)}</code>}
      </span>
    </Tooltip>
  )
}

export interface WizardFile { name: string; base64: string }


export function InstallWizard({ open, onOpenChange, onInstalled, expectUpgradeOf, initialFile, target, source }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInstalled: () => void
  expectUpgradeOf?: { name: string; package_uid: string }
  /** A file to start from (dropped on the page, or a version from the Authored library). */
  initialFile?: WizardFile | null
  /** Install into another workspace the user belongs to. */
  target?: { tenantId: string; name: string } | null
  source?: 'file' | 'library'
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [step, setStep] = useState(0)
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null)
  const [inspect, setInspect] = useState<Inspect | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [values, setValues] = useState<RequirementValues>({})
  const [rows, setRows] = useState<Record<string, RowMode>>({})
  const [adoptByName, setAdoptByName] = useState(false)
  const [keepLocal, setKeepLocal] = useState(false)
  const [keepIncomplete, setKeepIncomplete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Plan | null>(null)
  const jobs = useJobs()

  const reset = () => {
    setStep(0); setFile(null); setInspect(null); setPlan(null); setValues({}); setRows({}); setAdoptByName(false); setKeepLocal(false); setKeepIncomplete(false); setError(null); setResult(null)
  }

  const tenantId = target?.tenantId ?? null
  // Synchronous guard: two clicks in one frame both see busy === false.
  const installGuard = useSubmitGuard()
  const loadFile = async (name: string, base64: string) => {
    reset()
    setBusy(true)
    setFile({ name, base64 })
    const inspected = await inspectPackageFileAction(base64, tenantId)
    setBusy(false)
    if (!inspected.ok) { setError(inspected.error); return }
    if (expectUpgradeOf && inspected.data.package.id !== expectUpgradeOf.package_uid) {
      setError(`This file is “${inspected.data.package.name}”, not “${expectUpgradeOf.name}”.`)
    }
    setInspect(inspected.data)
    if (inputRef.current) inputRef.current.value = ''
  }
  const onPick = async (picked: File | undefined) => {
    if (!picked) return
    if (!/\.utpkg$/i.test(picked.name) && picked.type !== 'application/zip') { setError(`“${picked.name}” is not a .utpkg package file.`); return }
    await loadFile(picked.name, await fileToBase64(picked))
  }

  // Start from a pre-loaded file each time the wizard opens with one.
  const loadedFor = useRef<WizardFile | null>(null)
  useEffect(() => {
    if (!open) { loadedFor.current = null; return }
    if (initialFile && loadedFor.current !== initialFile) {
      loadedFor.current = initialFile
      void loadFile(initialFile.name, initialFile.base64)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadFile is recreated every render; the file identity is what matters
  }, [open, initialFile])

  const replan = async (nextValues = values, nextRows = rows, adopt = adoptByName, keep = keepLocal) => {
    if (!file) return
    setBusy(true)
    setError(null)
    const planned = await planInstallAction({ file: file.base64, file_name: file.name, values: cleanValues(nextValues), keep_incomplete: true, adopt_by_name: adopt, data: nextRows, keep_local_changes: keep, tenant_id: tenantId, source })
    setBusy(false)
    if (!planned.ok) { setError(planned.error); return null }
    setPlan(planned.data)
    return planned.data
  }

  const install = async () => {
    await installGuard.run(async () => {
      if (!file) return
      setBusy(true)
      setError(null)
      // A background job (`package.install`): a quick install shows its result
      // here; a long one continues after the wizard closes (popup + Jobs panel).
      try {
        const job = await jobs.start('package.install', {
          file_name: file.name, name: inspect?.package.name ?? file.name, values: cleanValues(values),
          keep_incomplete: keepIncomplete, adopt_by_name: adoptByName, data: rows, keep_local_changes: keepLocal, source: source ?? 'file',
        }, { effect: 'change', quietIfInline: true, input: { base64: file.base64 }, tenantId, onSuccess: () => onInstalled() })
        if (!job) return
        if (job.status === 'failed') { setError(job.error ?? 'The install failed'); return }
        if (job.status === 'succeeded' && job.result?.data) {
          setResult(job.result.data as Plan)
          setStep(3)
          return
        }
        onOpenChange(false)
      } catch (startError) {
        setError(startError instanceof Error ? startError.message : 'Could not start the install')
      } finally {
        setBusy(false)
      }
    })
  }

  const requirements = (plan?.requirements ?? []) as RequirementView[]
  const missing = missingCount(requirements, values)
  const otherBlockers = (plan?.blockers ?? []).filter((b) => !b.startsWith('Missing required values'))
  const summary = plan?.plan.summary
  const close = () => onOpenChange(false)

  const footer = step === 0 ? (
    <>
      <Button variant="secondary" onClick={close}>Cancel</Button>
      <Button data-testid="wizard-next" disabled={!inspect || !inspect.verification.valid || busy || Boolean(error)} onClick={async () => { if (await replan()) setStep(1) }}>Review changes</Button>
    </>
  ) : step === 1 && plan ? (
    <>
      <Button variant="secondary" className="mr-auto" onClick={() => setStep(0)}>Back</Button>
      <Button data-testid="wizard-next" disabled={busy || otherBlockers.length > 0 || Boolean(plan.missing_permissions?.length)} onClick={() => setStep(2)}>
        {requirements.length ? 'Configure' : 'Continue'}
      </Button>
    </>
  ) : step === 2 && plan ? (
    <>
      <Button variant="secondary" className="mr-auto" onClick={() => setStep(1)}>Back</Button>
      <Button data-testid="wizard-install" disabled={busy || (missing > 0 && !keepIncomplete)} loading={busy} onClick={() => void install()}>
        {plan.mode === 'install' ? 'Install' : plan.mode === 'upgrade' ? 'Upgrade' : 'Apply'}
      </Button>
    </>
  ) : step === 3 && result ? (
    <Button onClick={() => { reset(); close() }} data-testid="wizard-done">Done</Button>
  ) : null

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next) }} footer={footer}
      title={expectUpgradeOf ? `Upgrade ${expectUpgradeOf.name}` : target ? `Import into ${target.name}` : 'Import a package'}>
      {target && <InlineNotice tone="warning" className="mb-4" message={`Installing into the workspace “${target.name}” — not the one you are in. Its own permissions and requirement values apply.`} />}
      <ol className="mb-5 flex flex-wrap items-center gap-2 text-xs" aria-label="Steps">
        {STEPS.map((label, index) => (
          <li key={label} className="flex items-center gap-2" aria-current={index === step ? 'step' : undefined}>
            <span className={cn('flex size-5 items-center justify-center rounded-full text-2xs font-semibold',
              index < step ? 'bg-primary text-primary-fg' : index === step ? 'bg-primary text-primary-fg' : 'bg-muted text-fg-muted')}>
              {index < step ? <Check size={12} aria-hidden /> : index + 1}
            </span>
            <span className={index === step ? 'font-medium text-fg' : 'text-fg-muted'}>{label}</span>
            {index < STEPS.length - 1 && <span className="w-6 border-t border-border" aria-hidden />}
          </li>
        ))}
      </ol>
      {error && <InlineNotice tone="error" message={error} className="mb-4" />}

      {step === 0 && (
        <div className="space-y-4">
          <input ref={inputRef} type="file" accept=".utpkg,application/zip" className="hidden" data-testid="package-file" onChange={(event) => void onPick(event.target.files?.[0])} />
          <button type="button" onClick={() => inputRef.current?.click()} data-testid="wizard-dropzone"
            onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); void onPick(event.dataTransfer.files?.[0]) }}
            className={cn('w-full rounded-lg border border-dashed p-6 text-center text-ui transition-colors duration-[var(--ds-dur-fast)]',
              dragging ? 'border-primary bg-primary-wash text-fg' : 'border-border-strong text-fg-muted hover:bg-subtle hover:text-fg')}>
            <Upload size={20} className="mx-auto mb-2" aria-hidden />
            {file ? <span className="font-mono text-xs text-fg">{file.name}</span> : 'Drop a .utpkg file here, or choose one'}
          </button>
          {busy && !inspect && <p className="text-ui text-fg-muted" role="status">Verifying…</p>}
          {inspect && (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                  <PackageOpen size={16} className="text-fg-muted" aria-hidden /> {inspect.package.name}
                  <span className="font-mono text-xs font-normal text-fg-muted">v{inspect.package.version}</span>
                  {inspect.package.author && <span className="text-xs font-normal text-fg-muted">· {inspect.package.author}</span>}
                </p>
                <SignatureBadge verification={inspect.verification} />
              </div>
              {inspect.package.description && <p className="text-sm text-fg">{inspect.package.description}</p>}
              {inspect.installed && <InlineNotice tone="warning" message={`Installed here: version ${inspect.installed.version} (${inspect.installed.status}). Continuing upgrades it in place — local connection details are kept.`} />}
              {inspect.package.readme && (
                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-subtle p-3 font-mono text-xs text-fg scrollbar-thin">{inspect.package.readme}</pre>
              )}
              <p className="num text-xs text-fg-muted">
                {plural(inspect.assets.length, 'asset')} · {plural(inspect.requirements.length, 'requirement')}
                {inspect.data.filter((d) => d.mode === 'rows').length ? ` · rows for ${plural(inspect.data.filter((d) => d.mode === 'rows').length, 'table')}` : ''}
              </p>
              {(inspect.network_controls ?? []).length > 0 && (
                <div data-testid="wizard-network-controls">
                  <InlineNotice tone="warning" message={`Network access to approve after install: ${inspect.network_controls.map((c) => `${c.name} (${c.tag}) → ${c.hosts.join(', ') || 'no hosts declared'}`).join('; ')}. These controls stay offline until an admin approves their hosts in Extensibility → Form controls.`} />
                </div>
              )}
              {inspect.verification.errors.map((e) => <p key={e} className="text-xs text-danger">{e}</p>)}
            </div>
          )}
        </div>
      )}

      {step === 1 && plan && (
        <div className="space-y-4">
          <p className="num text-sm text-fg">
            {plan.mode === 'install' ? 'New install' : plan.mode === 'upgrade' ? `Upgrade ${plan.installed_version} → ${plan.package.version}` : plan.mode === 'reinstall' ? `Reinstall ${plan.package.version}` : `Downgrade ${plan.installed_version} → ${plan.package.version}`}:
            {' '}{summary?.create ?? 0} to create, {summary?.update ?? 0} to update, {summary?.unchanged ?? 0} unchanged.
          </p>
          <div className="max-h-72 divide-y divide-border-subtle overflow-y-auto rounded-lg border border-border text-ui scrollbar-thin" data-testid="install-plan">
            {[...plan.plan.assets].sort((a, b) => ACTION_ORDER[a.action] - ACTION_ORDER[b.action]).map((asset, index) => (
              <div key={`${asset.section}:${asset.source_id ?? index}`} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-20 shrink-0"><Badge tone={ACTION_TONE[asset.action] ?? 'neutral'}><span className="first-letter:uppercase">{asset.action}</span></Badge></span>
                  <span className="w-28 shrink-0 text-xs text-fg-muted first-letter:uppercase">{asset.section.replace(/_/g, ' ')}</span>
                  <span className="truncate text-fg">{asset.name}</span>
                  {asset.locally_modified && <Badge tone="warning">Changed here</Badge>}
                  {asset.needs_config && <Badge tone="warning">Needs configuration</Badge>}
                </div>
                {asset.action === 'update' && asset.diffs?.length ? (
                  <ul className="ml-[13.5rem] mt-1 space-y-0.5 font-mono text-xs text-fg-muted max-sm:ml-0">
                    {asset.diffs.slice(0, 4).map((diff) => <li key={diff.path} className="truncate">{diff.path}</li>)}
                  </ul>
                ) : null}
              </div>
            ))}
            {plan.removed_upstream.map((removed) => (
              <div key={`removed:${removed.source_id}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="w-20 shrink-0"><Badge>Kept</Badge></span>
                <span className="w-28 shrink-0 text-xs text-fg-muted first-letter:uppercase">{removed.section.replace(/_/g, ' ')}</span>
                <span className="text-fg">{removed.name}</span> <span className="text-xs text-fg-muted">— no longer in this version; not deleted</span>
              </div>
            ))}
          </div>
          {plan.data.length > 0 && (
            <div className="space-y-2">
              <p className="text-ui font-medium text-fg">Table rows</p>
              {plan.data.map((table) => (
                <label key={table.table_id} className="flex items-center justify-between gap-3 text-ui">
                  <span className="text-fg">{table.name} <span className="num text-xs text-fg-muted">({plural(table.rows, 'row')})</span></span>
                  <Select wrapperClassName="w-56" value={rows[table.table_id] ?? 'merge'}
                    onChange={(event) => { const next = { ...rows, [table.table_id]: event.target.value as RowMode }; setRows(next); void replan(values, next) }}
                    options={[{ value: 'merge', label: 'Merge (update, then add)' }, { value: 'replace', label: 'Replace all rows' }, { value: 'skip', label: 'Skip' }]} />
                </label>
              ))}
            </div>
          )}
          {plan.mode === 'install' ? (
            <Checkbox checked={adoptByName} onChange={(event) => { setAdoptByName(event.target.checked); void replan(values, rows, event.target.checked) }} label="Match existing assets by name instead of creating copies" />
          ) : plan.plan.assets.some((a) => a.locally_modified) ? (
            <Checkbox checked={keepLocal} onChange={(event) => { setKeepLocal(event.target.checked); void replan(values, rows, adoptByName, event.target.checked) }} label="Keep assets changed in this workspace (don’t overwrite them)" />
          ) : null}
          {plan.warnings.map((w, i) => <InlineNotice key={i} tone="warning" message={w.warning} />)}
          {otherBlockers.map((b) => <InlineNotice key={b} tone="error" message={b} />)}
          {plan.missing_permissions?.length ? <InlineNotice tone="error" message={`You need ${[...new Set(plan.missing_permissions.map((m) => m.permission))].join(', ')} to install this package.`} /> : null}
        </div>
      )}

      {step === 2 && plan && (
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">
            Credentials and environment settings are not part of the package. Fill them in now, or keep the install incomplete and finish later from the package library — items that need configuration stay disabled until then.
          </p>
          <RequirementsForm requirements={requirements} values={values} onChange={setValues} />
          {missing > 0 && (
            <div className="rounded-lg bg-warning-wash p-3">
              <Checkbox checked={keepIncomplete} onChange={(event) => setKeepIncomplete(event.target.checked)} data-testid="keep-incomplete"
                label={`Keep incomplete — ${missing} required value${missing === 1 ? ' is' : 's are'} missing. Affected connections are installed disabled and dependent workflows can’t be activated until setup is completed.`} />
            </div>
          )}
        </div>
      )}

      {step === 3 && result && (
        <div className="space-y-3">
          <InlineNotice
            tone={result.install?.status === 'incomplete' ? 'warning' : 'success'}
            message={result.install?.status === 'incomplete'
              ? `${result.package.name} ${result.package.version} installed — setup incomplete. Finish it with “Complete setup” in the library.`
              : `${result.package.name} ${result.package.version} ${result.mode === 'upgrade' ? 'upgraded' : 'installed'}.`}
          />
          {(result.result?.errors ?? []).map((e, i) => <p key={i} className="text-xs text-danger">{e.asset_type}: {e.error}</p>)}
          {((result.result?.rows ?? []) as Array<{ table_id: string; name: string; inserted: number; updated: number; error?: string }>).map((r) => <p key={r.table_id} className="num text-xs text-fg">{r.name}: {r.inserted} rows added, {r.updated} updated{r.error ? ` — ${r.error}` : ''}</p>)}
          {result.warnings.map((w, i) => <p key={i} className="text-xs text-warning">{w.warning}</p>)}
          <p className="text-xs text-fg-muted">Recorded in the package history{target ? ` of ${target.name}` : ''}.</p>
        </div>
      )}
    </Modal>
  )
}
