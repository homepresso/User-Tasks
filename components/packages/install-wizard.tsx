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
import { BadgeCheck, FileWarning, PackageOpen, ShieldAlert, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

const ACTION_COLOR: Record<string, string> = {
  create: 'var(--theme-success)', update: 'var(--theme-warning)', unchanged: 'var(--theme-muted-text)', error: 'var(--theme-danger)',
}

export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function SignatureBadge({ verification }: { verification: { signed: boolean; signature_ok: boolean | null; fingerprint: string | null; trust: string; valid: boolean } }) {
  if (!verification.valid) return <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--theme-danger)' }}><ShieldAlert size={13} /> Modified or corrupt</span>
  if (!verification.signed) return <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--theme-warning)' }}><FileWarning size={13} /> Unsigned</span>
  const label = verification.trust === 'instance' ? 'Signed by this instance' : verification.trust === 'trusted' ? 'Signed by a trusted key' : 'Signed by an unknown key'
  return (
    <span className="inline-flex items-center gap-1 text-xs" style={{ color: verification.trust === 'untrusted' ? 'var(--theme-warning)' : 'var(--theme-success)' }} title={verification.fingerprint ?? ''}>
      <BadgeCheck size={13} /> {label} <code className="text-[10px] opacity-80">{verification.fingerprint?.slice(0, 23)}</code>
    </span>
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
  }

  const requirements = (plan?.requirements ?? []) as RequirementView[]
  const missing = missingCount(requirements, values)
  const otherBlockers = (plan?.blockers ?? []).filter((b) => !b.startsWith('Missing required values'))
  const summary = plan?.plan.summary

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next) }} title={expectUpgradeOf ? `Upgrade ${expectUpgradeOf.name}` : target ? `Import into ${target.name}` : 'Import a package'}>
      {target && <InlineNotice tone="warning" className="mb-3" message={`Installing into the workspace “${target.name}” — not the one you are in. Its own permissions and requirement values apply.`} />}
      <ol className="flex items-center gap-2 mb-5 text-xs" aria-label="Steps">
        {STEPS.map((label, index) => (
          <li key={label} className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold"
              style={{ backgroundColor: index <= step ? 'var(--theme-primary)' : 'var(--theme-surface)', color: index <= step ? 'var(--theme-on-primary, #fff)' : 'var(--theme-muted-text)' }}>{index + 1}</span>
            <span style={{ color: index === step ? 'var(--theme-card-text)' : 'var(--theme-muted-text)' }} className={index === step ? 'font-medium' : ''}>{label}</span>
            {index < STEPS.length - 1 && <span className="w-6 border-t" style={{ borderColor: 'var(--theme-surface-border)' }} />}
          </li>
        ))}
      </ol>
      {error && <InlineNotice tone="error" message={error} className="mb-3" />}

      {step === 0 && (
        <div className="space-y-4">
          <input ref={inputRef} type="file" accept=".utpkg,application/zip" className="hidden" data-testid="package-file" onChange={(event) => void onPick(event.target.files?.[0])} />
          <button type="button" onClick={() => inputRef.current?.click()} data-testid="wizard-dropzone"
            onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); void onPick(event.dataTransfer.files?.[0]) }}
            className="w-full rounded-xl border-2 border-dashed p-6 text-center text-sm hover:opacity-80"
            style={{ borderColor: dragging ? 'var(--theme-primary)' : 'var(--theme-surface-border)', color: 'var(--theme-muted-text)', backgroundColor: dragging ? 'var(--theme-surface)' : undefined }}>
            <Upload size={18} className="mx-auto mb-2" />
            {file ? file.name : 'Drop a .utpkg file here, or choose one'}
          </button>
          {busy && !inspect && <p className="text-sm">Verifying…</p>}
          {inspect && (
            <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: 'var(--theme-surface-border)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold flex items-center gap-2"><PackageOpen size={16} /> {inspect.package.name} <span className="text-xs font-normal" style={{ color: 'var(--theme-muted-text)' }}>v{inspect.package.version}{inspect.package.author ? ` · ${inspect.package.author}` : ''}</span></p>
                <SignatureBadge verification={inspect.verification} />
              </div>
              {inspect.package.description && <p className="text-sm">{inspect.package.description}</p>}
              {inspect.installed && <InlineNotice tone="warning" message={`Installed here: version ${inspect.installed.version} (${inspect.installed.status}). Continuing upgrades it in place — local connection details are kept.`} />}
              {inspect.package.readme && (
                <pre className="text-xs whitespace-pre-wrap rounded p-3 max-h-40 overflow-y-auto" style={{ backgroundColor: 'var(--theme-surface)' }}>{inspect.package.readme}</pre>
              )}
              <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                {inspect.assets.length} assets · {inspect.requirements.length} requirement{inspect.requirements.length === 1 ? '' : 's'}
                {inspect.data.filter((d) => d.mode === 'rows').length ? ` · rows for ${inspect.data.filter((d) => d.mode === 'rows').length} table(s)` : ''}
              </p>
              {inspect.verification.errors.map((e) => <p key={e} className="text-xs" style={{ color: 'var(--theme-danger)' }}>{e}</p>)}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" data-testid="wizard-next" disabled={!inspect || !inspect.verification.valid || busy || Boolean(error)} onClick={async () => { if (await replan()) setStep(1) }}>Review changes</Button>
          </div>
        </div>
      )}

      {step === 1 && plan && (
        <div className="space-y-4">
          <p className="text-sm">
            {plan.mode === 'install' ? 'New install' : plan.mode === 'upgrade' ? `Upgrade ${plan.installed_version} → ${plan.package.version}` : plan.mode === 'reinstall' ? `Reinstall ${plan.package.version}` : `Downgrade ${plan.installed_version} → ${plan.package.version}`}:
            {' '}{summary?.create ?? 0} to create, {summary?.update ?? 0} to update, {summary?.unchanged ?? 0} unchanged.
          </p>
          <div className="rounded-lg border divide-y text-sm max-h-72 overflow-y-auto" style={{ borderColor: 'var(--theme-surface-border)' }} data-testid="install-plan">
            {[...plan.plan.assets].sort((a, b) => ACTION_ORDER[a.action] - ACTION_ORDER[b.action]).map((asset, index) => (
              <div key={`${asset.section}:${asset.source_id ?? index}`} className="px-3 py-2" style={{ borderColor: 'var(--theme-surface-border)' }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold w-20 shrink-0 capitalize" style={{ color: ACTION_COLOR[asset.action] }}>{asset.action}</span>
                  <span className="text-xs w-28 shrink-0" style={{ color: 'var(--theme-muted-text)' }}>{asset.section.replace(/_/g, ' ')}</span>
                  <span className="truncate">{asset.name}</span>
                  {asset.locally_modified && <span className="text-[10px] px-1.5 rounded" style={{ backgroundColor: 'var(--status-warning-bg)', color: 'var(--theme-warning)' }}>changed here</span>}
                  {asset.needs_config && <span className="text-[10px] px-1.5 rounded" style={{ backgroundColor: 'var(--status-warning-bg)', color: 'var(--theme-warning)' }}>needs configuration</span>}
                </div>
                {asset.action === 'update' && asset.diffs?.length ? (
                  <ul className="text-xs mt-1 ml-[5.5rem] space-y-0.5" style={{ color: 'var(--theme-muted-text)' }}>
                    {asset.diffs.slice(0, 4).map((diff) => <li key={diff.path} className="truncate">{diff.path}</li>)}
                  </ul>
                ) : null}
              </div>
            ))}
            {plan.removed_upstream.map((removed) => (
              <div key={`removed:${removed.source_id}`} className="px-3 py-2 text-sm" style={{ borderColor: 'var(--theme-surface-border)' }}>
                <span className="text-xs font-semibold w-20 inline-block" style={{ color: 'var(--theme-muted-text)' }}>kept</span>
                <span className="text-xs w-28 inline-block" style={{ color: 'var(--theme-muted-text)' }}>{removed.section.replace(/_/g, ' ')}</span>
                {removed.name} <span className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>— no longer in this version; not deleted</span>
              </div>
            ))}
          </div>
          {plan.data.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Table rows</p>
              {plan.data.map((table) => (
                <label key={table.table_id} className="flex items-center justify-between gap-3 text-sm">
                  <span>{table.name} <span className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>({table.rows} rows)</span></span>
                  <select className="rounded border px-2 py-1 text-sm" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }} value={rows[table.table_id] ?? 'merge'}
                    onChange={(event) => { const next = { ...rows, [table.table_id]: event.target.value as RowMode }; setRows(next); void replan(values, next) }}>
                    <option value="merge">Merge (update, then add)</option>
                    <option value="replace">Replace all rows</option>
                    <option value="skip">Skip</option>
                  </select>
                </label>
              ))}
            </div>
          )}
          {plan.mode === 'install' ? (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={adoptByName} onChange={(event) => { setAdoptByName(event.target.checked); void replan(values, rows, event.target.checked) }} /> Match existing assets by name instead of creating copies</label>
          ) : plan.plan.assets.some((a) => a.locally_modified) ? (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={keepLocal} onChange={(event) => { setKeepLocal(event.target.checked); void replan(values, rows, adoptByName, event.target.checked) }} /> Keep assets changed in this workspace (don’t overwrite them)</label>
          ) : null}
          {plan.warnings.map((w, i) => <InlineNotice key={i} tone="warning" message={w.warning} />)}
          {otherBlockers.map((b) => <InlineNotice key={b} tone="error" message={b} />)}
          {plan.missing_permissions?.length ? <InlineNotice tone="error" message={`You need ${[...new Set(plan.missing_permissions.map((m) => m.permission))].join(', ')} to install this package.`} /> : null}
          <div className="flex justify-between gap-2">
            <Button size="sm" variant="outline" onClick={() => setStep(0)}>Back</Button>
            <Button size="sm" data-testid="wizard-next" disabled={busy || otherBlockers.length > 0 || Boolean(plan.missing_permissions?.length)} onClick={() => setStep(2)}>
              {requirements.length ? 'Configure' : 'Continue'}
            </Button>
          </div>
        </div>
      )}

      {step === 2 && plan && (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>
            Credentials and environment settings are not part of the package. Fill them in now, or keep the install incomplete and finish later from the package library — items that need configuration stay disabled until then.
          </p>
          <RequirementsForm requirements={requirements} values={values} onChange={setValues} />
          {missing > 0 && (
            <label className="flex items-start gap-2 text-sm rounded-lg p-3" style={{ backgroundColor: 'var(--status-warning-bg)' }}>
              <input type="checkbox" className="mt-0.5" checked={keepIncomplete} onChange={(event) => setKeepIncomplete(event.target.checked)} data-testid="keep-incomplete" />
              <span>Keep incomplete — {missing} required value{missing === 1 ? ' is' : 's are'} missing. Affected connections are installed disabled and dependent workflows can’t be activated until setup is completed.</span>
            </label>
          )}
          <div className="flex justify-between gap-2">
            <Button size="sm" variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button size="sm" data-testid="wizard-install" disabled={busy || (missing > 0 && !keepIncomplete)} onClick={() => void install()}>
              {busy ? 'Installing…' : plan.mode === 'install' ? 'Install' : plan.mode === 'upgrade' ? 'Upgrade' : 'Apply'}
            </Button>
          </div>
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
          {(result.result?.errors ?? []).map((e, i) => <p key={i} className="text-xs" style={{ color: 'var(--theme-danger)' }}>{e.asset_type}: {e.error}</p>)}
          {((result.result?.rows ?? []) as Array<{ table_id: string; name: string; inserted: number; updated: number; error?: string }>).map((r) => <p key={r.table_id} className="text-xs">{r.name}: {r.inserted} rows added, {r.updated} updated{r.error ? ` — ${r.error}` : ''}</p>)}
          {result.warnings.map((w, i) => <p key={i} className="text-xs" style={{ color: 'var(--theme-warning)' }}>{w.warning}</p>)}
          <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>Recorded in the package history{target ? ` of ${target.name}` : ''}.</p>
          <div className="flex justify-end"><Button size="sm" onClick={() => { reset(); onOpenChange(false) }} data-testid="wizard-done">Done</Button></div>
        </div>
      )}
    </Modal>
  )
}
