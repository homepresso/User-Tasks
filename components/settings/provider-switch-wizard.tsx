'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ClipboardCopy, Lock, PlugZap, ScanSearch, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import {
  applyProviderChange,
  checkSecretReference,
  listProviderSwitches,
  loadSwitchWizard,
  planProviderChange,
  saveProviderSettings,
  testProviderChange,
} from '@/app/actions/infrastructure'
import type { ApplyResult, FieldView, PlanResult, SettingsResult, SwitchRecordView, WizardData } from '@/lib/admin/infrastructure-switching'
import type { PreflightCheck } from '@/lib/admin/switch/types'
import { SwitchProgress, useSwitchRecord } from './switch-progress'

/**
 * Settings → Infrastructure → Change… / Settings: a guided provider switch
 * (choose → configure → test and review → apply) or an edit of the current
 * provider's settings. Every step is a server action that re-checks
 * instance-admin access; the plan is the engine's own dry run, and the
 * switch is the engine's own run (app/actions/infrastructure.ts).
 * Stored secrets are never sent to the browser: secret fields only say
 * whether a value is set (or which secret:// reference they use).
 */

const BADGE_LABELS: Record<string, string> = { 'on-prem': 'On-prem', aws: 'AWS', azure: 'Azure', gcp: 'Google Cloud', supabase: 'Supabase', cloud: 'Cloud' }
const SEVERITY: Record<PreflightCheck['severity'], { label: string; color: string }> = {
  ok: { label: 'OK', color: 'var(--status-done)' },
  warn: { label: 'WARN', color: 'var(--status-progress)' },
  error: { label: 'FAIL', color: 'var(--status-blocked)' },
}

type Step = 'choose' | 'configure' | 'review' | 'run'
type Notice = { tone: 'success' | 'warning' | 'error'; message: string } | null

function Checks({ checks }: { checks: PreflightCheck[] }) {
  if (!checks.length) return null
  return (
    <ul className="space-y-1 text-sm" aria-label="Checks">
      {checks.map((c, i) => c.name === 'dba sql' ? (
        <li key={`${c.name}-${i}`} className="space-y-1">
          <p className="text-xs font-medium" style={{ color: SEVERITY[c.severity].color }}>The target role is missing privileges. A DBA runs this once (as a superuser / admin), then test again:</p>
          <CopyBlock text={c.detail.replace(/^run once as an admin, then test again:\n/, '')} />
        </li>
      ) : (
        <li key={`${c.name}-${i}`} className="flex gap-2">
          <span className="shrink-0 w-12 text-xs font-medium pt-0.5" style={{ color: SEVERITY[c.severity].color }}>{SEVERITY[c.severity].label}</span>
          <span className="shrink-0 w-32 text-xs pt-0.5" style={{ color: 'var(--theme-muted-text)' }}>{c.name}</span>
          <span className="min-w-0 break-words">{c.detail}</span>
        </li>
      ))}
    </ul>
  )
}

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative">
      <pre className="rounded-lg p-3 pr-10 text-xs whitespace-pre-wrap break-all" style={{ backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)' }}>{text}</pre>
      <button
        type="button"
        className="absolute right-2 top-2"
        aria-label="Copy command"
        onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      >
        {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
      </button>
    </div>
  )
}

/** The rollback-window warning shown before risky switches. */
export function RollbackWindowWarning({ area }: { area: string }) {
  return (
    <div className="rounded-lg border p-3 text-xs space-y-1" style={{ borderColor: 'color-mix(in srgb, var(--theme-warning) 35%, transparent)', backgroundColor: 'var(--status-warning-bg)', color: 'var(--theme-card-text)' }} role="note">
      <p className="font-medium flex items-center gap-1"><AlertTriangle size={13} /> Rollback window</p>
      <p>
        Keep the app on this release (or newer) until you are sure about the switch. An older release may not know the new
        provider{area === 'kms' ? ' or the re-wrapped data keys' : ''}: to go back to an older release, roll this switch back here first, then
        redeploy. The switch log keeps the rollback snapshot.
      </p>
    </div>
  )
}

function isRef(value: string) {
  return /^secret:\/\/[A-Za-z0-9_./#%-]{1,200}$/.test(value.trim())
}

export function ProviderSwitchWizard({
  area, label, kind, open, onOpenChange,
}: {
  area: string
  label: string
  /** switch: Change provider; settings: edit the current provider's options. */
  kind: 'switch' | 'settings'
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [wizard, setWizard] = useState<WizardData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>(kind === 'settings' ? 'configure' : 'choose')
  const [target, setTarget] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [clear, setClear] = useState<string[]>([])
  const [flags, setFlags] = useState<Record<string, string | boolean>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<Notice>(null)
  const [test, setTest] = useState<PlanResult | SettingsResult | null>(null)
  const [plan, setPlan] = useState<PlanResult | null>(null)
  const [confirm, setConfirm] = useState('')
  const [applied, setApplied] = useState<ApplyResult | null>(null)
  const [record, setRecord] = useState<SwitchRecordView | null>(null)
  const [refChecks, setRefChecks] = useState<Record<string, { found: boolean; detail: string }>>({})
  const [waitingForCli, setWaitingForCli] = useState<string | null>(null)

  const muted = { color: 'var(--theme-muted-text)' }
  const fieldStyle = { borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)' }

  const load = () => startTransition(async () => {
    setLoadError(null)
    const res = await loadSwitchWizard(area)
    if (!res.ok) { setLoadError(res.error); return }
    setWizard(res.wizard)
    if (kind === 'settings') setTarget(res.wizard.current.id)
  })

  // Mounted open (AreaActions renders the wizard only while it is open): load once.
  const [requested, setRequested] = useState(false)
  useEffect(() => {
    if (open && !requested) { setRequested(true); load() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per open
  }, [open, requested])

  const change = (next: boolean) => {
    if (!next && (record || applied)) router.refresh()
    onOpenChange(next)
  }

  const fields: FieldView[] = wizard && target ? wizard.fields[target] ?? [] : []
  const input = () => {
    const changed: Record<string, string> = {}
    for (const field of fields) {
      const v = values[field.option]
      if (v === undefined) continue
      if (field.secret ? v.trim() !== '' : v !== (field.value ?? '')) changed[field.option] = v
    }
    return { area, to: target, values: changed, clear, flags }
  }
  const invalidate = () => { setTest(null); setPlan(null); setConfirm(''); setNotice(null) }

  const runTest = () => startTransition(async () => {
    setNotice(null)
    const res = kind === 'settings' ? await saveProviderSettings({ ...input(), dryRun: true }) : await testProviderChange(input())
    if (!res.ok) { setFieldErrors(res.fieldErrors ?? {}); setNotice({ tone: 'error', message: res.error }); return }
    setFieldErrors({})
    setTest(res)
    const passed = 'passed' in res ? res.passed : true
    setNotice({ tone: passed ? 'success' : 'error', message: passed ? 'Connection test passed: nothing was saved.' : 'The connection test failed: nothing was saved.' })
  })

  const review = () => startTransition(async () => {
    setNotice(null)
    const res = await planProviderChange(input())
    if (!res.ok) { setFieldErrors(res.fieldErrors ?? {}); setNotice({ tone: 'error', message: res.error }); return }
    setFieldErrors({})
    setPlan(res)
    setStep('review')
  })

  const apply = () => startTransition(async () => {
    setNotice(null)
    if (kind === 'settings') {
      const res = await saveProviderSettings({ ...input(), dryRun: false })
      if (!res.ok) { setFieldErrors(res.fieldErrors ?? {}); setNotice({ tone: 'error', message: res.error }); return }
      setTest(res)
      if (!res.saved) { setNotice({ tone: 'error', message: 'The checks failed: nothing was saved.' }); return }
      setRecord(res.record)
      setStep('run')
      return
    }
    const res = await applyProviderChange({ ...input(), confirm })
    if (!res.ok) { setNotice({ tone: 'error', message: res.error }); return }
    setApplied(res)
    setStep('run')
    if (res.record) setRecord(res.record)
    else if (res.mode === 'cli') setWaitingForCli(new Date().toISOString())
  })

  // CLI mode: watch the switch log for the switch the operator starts.
  const pollCli = () => startTransition(async () => {
    const res = await listProviderSwitches()
    if (!res.ok || !waitingForCli) return
    const found = res.records.find((r) => r.area === area && r.kind === 'switch' && r.startedAt >= waitingForCli)
    if (found) { setRecord(found); setWaitingForCli(null) }
    else setNotice({ tone: 'warning', message: 'No new switch in the log yet. Run the command on the server, then check again.' })
  })

  const checkRef = (option: string, ref: string) => startTransition(async () => {
    const res = await checkSecretReference(ref)
    setRefChecks((prev) => ({ ...prev, [option]: res.ok ? { found: res.found, detail: res.detail } : { found: false, detail: res.error } }))
  })

  const choice = wizard?.providers.find((p) => p.id === target)
  const risky = kind === 'switch' && (area === 'kms' || target !== wizard?.current.id)

  const renderField = (field: FieldView) => {
    const id = `pf-${area}-${field.option}`
    const error = fieldErrors[field.option]
    const value = values[field.option] ?? (field.secret ? '' : field.value ?? '')
    const set = (v: string) => { invalidate(); setValues((prev) => ({ ...prev, [field.option]: v })) }
    const cleared = clear.includes(field.option)
    let control: React.ReactNode
    if (field.envPinned) {
      control = (
        <p className="text-sm flex items-center gap-1 h-10" id={id}>
          <Lock size={13} /> {field.secret ? 'Set' : <code className="break-all">{field.value}</code>}
        </p>
      )
    } else if (field.kind === 'boolean' || field.kind === 'select') {
      const choices = field.kind === 'boolean' ? ['true', 'false'] : [...(field.choices ?? [])]
      control = (
        <select id={id} value={value} onChange={(e) => set(e.target.value)} className="w-full h-10 rounded-lg border px-3 text-sm" style={fieldStyle}>
          <option value="">{field.value === null ? 'Default' : `Default (${field.value})`}</option>
          {choices.map((c) => <option key={c} value={c}>{field.kind === 'boolean' ? (c === 'true' ? 'On' : 'Off') : c}</option>)}
        </select>
      )
    } else if (field.kind === 'json') {
      control = (
        <textarea id={id} rows={3} value={value} placeholder={field.secret && field.configured ? '•••••••• stored (leave empty to keep)' : field.placeholder}
          onChange={(e) => set(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-xs font-mono" style={fieldStyle} autoComplete="off" spellCheck={false} />
      )
    } else {
      control = (
        <Input
          id={id}
          type={field.secret && !isRef(value) ? 'password' : field.kind === 'number' ? 'text' : 'text'}
          inputMode={field.kind === 'number' ? 'numeric' : undefined}
          value={value}
          placeholder={field.secret ? (field.ref ? `Uses ${field.ref} (type to replace)` : field.configured ? '•••••••• stored (leave empty to keep)' : 'value or secret://name') : field.placeholder}
          onChange={(e) => set(e.target.value)}
          autoComplete={field.secret ? 'new-password' : 'off'}
          list={field.secret && wizard?.secretNames.length ? `secret-names-${area}` : undefined}
          aria-invalid={Boolean(error)}
        />
      )
    }
    return (
      <div key={field.option}>
        <label htmlFor={id} className="block text-sm font-medium mb-1">
          {field.label}{field.required && <span style={{ color: 'var(--status-blocked)' }}> *</span>}
          {field.secret && <span className="ml-1 text-xs font-normal" style={muted}>(secret)</span>}
        </label>
        {control}
        <p className="text-xs mt-1 break-words" style={error ? { color: 'var(--theme-danger)' } : muted}>
          {error ?? (field.envPinned
            ? `Set by the environment variable ${field.envVar}: change it there.`
            : [field.help, field.envVar ? `Env: ${field.envVar}` : '', kind === 'settings' && field.relocates ? 'Existing files stay where they are: use Change… (same provider) to copy them.' : '', kind === 'settings' && field.switchOnly ? 'Changed with Change… (re-wraps the data keys).' : ''].filter(Boolean).join(' · '))}
        </p>
        {field.secret && !field.envPinned && isRef(value) && (
          <p className="text-xs mt-1 flex items-center gap-2">
            <button type="button" className="underline" onClick={() => checkRef(field.option, value)} disabled={pending}>Check reference</button>
            {refChecks[field.option] && <span style={{ color: refChecks[field.option].found ? 'var(--status-done)' : 'var(--status-blocked)' }}>{refChecks[field.option].detail}</span>}
          </p>
        )}
        {kind === 'settings' && !field.envPinned && !field.switchOnly && field.configured && !field.required && (
          <label className="text-xs mt-1 flex items-center gap-1" style={muted}>
            <input type="checkbox" checked={cleared} onChange={(e) => { invalidate(); setClear((prev) => (e.target.checked ? [...prev, field.option] : prev.filter((o) => o !== field.option))) }} />
            Remove this setting
          </label>
        )}
      </div>
    )
  }

  const title = kind === 'settings' ? `${label} settings` : `Change ${label.toLowerCase()} provider`
  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(46rem,94vw)] max-h-[90vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-xl p-5 shadow-xl dialog-content space-y-4"
          style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
          aria-describedby={undefined}
        >
          <div className="flex items-start gap-2">
            <Dialog.Title className="text-lg font-semibold flex-1">{title}</Dialog.Title>
            <Dialog.Close aria-label="Close" className="p-1"><X size={16} /></Dialog.Close>
          </div>

          {loadError && <InlineNotice tone="error" message={loadError} />}
          {!wizard && !loadError && <p className="text-sm" style={muted}>Loading…</p>}

          {wizard && (
            <>
              <p className="text-xs" style={muted}>
                Now: <strong>{wizard.current.label}</strong> (<code>{wizard.current.id}</code>, set by {wizard.current.source === 'env' ? `the environment variable ${wizard.current.envVar}` : wizard.current.source === 'settings' ? 'an instance setting' : 'default'})
              </p>
              {!wizard.gate.enabled && <InlineNotice tone="warning" message={wizard.gate.reason ?? 'Changes from this page are turned off.'} />}
              {wizard.busy && step !== 'run' && <InlineNotice tone="warning" message="Another provider switch is queued or running: you can review a plan, but applying waits until it has finished." />}
              {wizard.current.source === 'env' && kind === 'switch' && (
                <InlineNotice tone="warning" message={`${wizard.current.envVar} is set in the environment and wins over instance settings: after the switch, change it there and restart the app (the switch says what to set).`} />
              )}

              {step === 'choose' && (
                <div className="space-y-2" role="radiogroup" aria-label="Provider">
                  {wizard.providers.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={target === p.id}
                      disabled={!p.available}
                      onClick={() => { setTarget(p.id); setValues({}); setFlags({}); invalidate() }}
                      className="w-full text-left rounded-lg border p-3 disabled:opacity-50"
                      style={{ borderColor: target === p.id ? 'var(--theme-primary)' : 'var(--theme-surface-border)', boxShadow: target === p.id ? '0 0 0 1px var(--theme-primary)' : undefined }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">{p.label}</span>
                        <code className="text-xs" style={muted}>{p.id}</code>
                        {p.badges.map((b) => <span key={b} className="rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: 'var(--theme-surface-border)' }}>{BADGE_LABELS[b] ?? b}</span>)}
                        {p.current && <span className="text-xs font-medium" style={{ color: 'var(--status-done)' }}>current</span>}
                        {p.isDefault && <span className="text-xs" style={muted}>default</span>}
                        <span className="ml-auto text-xs" style={muted}>{p.switch === 'data' ? 'moves data' : 'configuration only'}</span>
                      </div>
                      {p.capabilities.length > 0 && <p className="text-xs mt-1" style={muted}>{p.capabilities.join(' · ')}</p>}
                      {!p.available && p.reason && <p className="text-xs mt-1" style={{ color: 'var(--status-blocked)' }}>Not available here: {p.reason}</p>}
                    </button>
                  ))}
                  <div className="flex justify-end">
                    <Button type="button" size="sm" disabled={!target} onClick={() => setStep('configure')}>Configure <ArrowRight size={14} /></Button>
                  </div>
                </div>
              )}

              {step === 'configure' && target && (
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (kind === 'switch') review(); else apply() }}>
                  <p className="text-sm">
                    {kind === 'switch' ? <>Options for <strong>{choice?.label ?? target}</strong>. Leave a field empty to keep what is stored (or the default).</> : <>Options of <strong>{wizard.current.label}</strong>. Saving runs the same checks as a switch first.</>}
                  </p>
                  {fields.length === 0 && wizard.flags.length === 0 && <p className="text-sm" style={muted}>This provider has no options.</p>}
                  <div className="grid gap-4 sm:grid-cols-2">{fields.map(renderField)}</div>
                  {wizard.secretNames.length > 0 && (
                    <datalist id={`secret-names-${area}`}>{wizard.secretNames.map((n) => <option key={n} value={`secret://${n}`} />)}</datalist>
                  )}
                  {kind === 'switch' && wizard.flags.length > 0 && (
                    <fieldset className="grid gap-4 sm:grid-cols-2 border-t pt-3" style={{ borderColor: 'var(--theme-surface-border)' }}>
                      <legend className="text-xs font-medium px-1" style={muted}>Switch options (not stored)</legend>
                      {wizard.flags.map((f) => {
                        const id = `pf-${area}-flag-${f.flag}`
                        const error = fieldErrors[`flag:${f.flag}`]
                        return (
                          <div key={f.flag}>
                            {f.kind === 'boolean' ? (
                              <label className="flex items-center gap-2 text-sm h-10">
                                <input id={id} type="checkbox" checked={flags[f.flag] === true} onChange={(e) => { invalidate(); setFlags((prev) => ({ ...prev, [f.flag]: e.target.checked })) }} /> {f.label}
                              </label>
                            ) : f.kind === 'select' ? (
                              <>
                                <label htmlFor={id} className="block text-sm font-medium mb-1">{f.label}</label>
                                <select id={id} value={String(flags[f.flag] ?? '')} onChange={(e) => { invalidate(); setFlags((prev) => ({ ...prev, [f.flag]: e.target.value })) }} className="w-full h-10 rounded-lg border px-3 text-sm" style={fieldStyle}>
                                  <option value="">Default</option>
                                  {(f.choices ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </>
                            ) : f.kind === 'textarea' ? (
                              <>
                                <label htmlFor={id} className="block text-sm font-medium mb-1">{f.label}</label>
                                <textarea id={id} rows={3} value={String(flags[f.flag] ?? '')} placeholder={f.placeholder} spellCheck={false}
                                  onChange={(e) => { invalidate(); setFlags((prev) => ({ ...prev, [f.flag]: e.target.value })) }} className="w-full rounded-lg border px-3 py-2 text-xs font-mono" style={fieldStyle} />
                              </>
                            ) : (
                              <>
                                <label htmlFor={id} className="block text-sm font-medium mb-1">{f.label}{f.required && <span style={{ color: 'var(--status-blocked)' }}> *</span>}</label>
                                <Input id={id} type={f.secret ? 'password' : 'text'} autoComplete="off" value={String(flags[f.flag] ?? '')} placeholder={f.placeholder}
                                  onChange={(e) => { invalidate(); setFlags((prev) => ({ ...prev, [f.flag]: e.target.value })) }} aria-invalid={Boolean(error)} />
                              </>
                            )}
                            <p className="text-xs mt-1" style={error ? { color: 'var(--theme-danger)' } : muted}>{error ?? f.help}</p>
                          </div>
                        )
                      })}
                    </fieldset>
                  )}
                  {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}
                  {test && <Checks checks={test.preflight} />}
                  <div className="flex flex-wrap justify-between gap-2">
                    {kind === 'switch' ? <Button type="button" variant="ghost" size="sm" onClick={() => setStep('choose')}><ArrowLeft size={14} /> Providers</Button> : <span />}
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={pending || !wizard.gate.enabled} onClick={runTest}><PlugZap size={14} /> Test connection</Button>
                      {kind === 'switch'
                        ? <Button type="submit" size="sm" disabled={pending || !wizard.gate.enabled}><ScanSearch size={14} /> Review plan</Button>
                        : <Button type="submit" size="sm" disabled={pending || !wizard.gate.enabled || wizard.busy}>Save settings</Button>}
                    </div>
                  </div>
                </form>
              )}

              {step === 'review' && plan && (
                <div className="space-y-4">
                  <Checks checks={plan.preflight} />
                  {plan.plan ? (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold">Plan</h3>
                      <ol className="ml-4 list-decimal text-sm space-y-1">
                        {plan.plan.steps.map((s) => <li key={s.id}><span className="font-medium">{s.title}</span>{s.detail && <span className="block text-xs break-words" style={muted}>{s.detail}</span>}</li>)}
                      </ol>
                      <p className="text-xs" style={muted}>
                        Backup: <code className="break-all">{plan.plan.backupDir}</code>
                        {plan.plan.dataMoving && ' (config snapshot, the tables the switch changes, and a pg_dump when available)'}
                      </p>
                      {Object.keys(plan.plan.env).length > 0 && <InlineNotice tone="warning" message={`Environment changes needed afterwards: ${Object.entries(plan.plan.env).map(([k, v]) => `${k}=${v}`).join(', ')}`} />}
                      {plan.plan.warnings.map((w, i) => <InlineNotice key={i} tone="warning" message={w.trim()} />)}
                    </div>
                  ) : (
                    <InlineNotice tone="error" message="The pre-flight checks failed: fix the options and review again." />
                  )}
                  <details className="text-xs">
                    <summary className="cursor-pointer" style={muted}>Dry-run output (as usertasks-admin prints it)</summary>
                    <pre className="mt-1 max-h-56 overflow-auto rounded-lg p-2 whitespace-pre-wrap break-words" style={{ backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)' }}>{plan.lines.join('\n')}</pre>
                  </details>
                  {plan.passed && risky && <RollbackWindowWarning area={area} />}
                  {plan.passed && plan.mode === 'background' && <p className="text-sm">This switch moves data: it runs in the background on this server, and you can follow it here (or close this and come back).</p>}
                  {plan.passed && plan.mode === 'chunked' && <p className="text-sm">This switch moves data. On this deployment it runs in time-boxed chunks — one right away, then one per scheduler tick (every minute) — each saving its progress; follow it here or come back later.</p>}
                  {plan.passed && plan.mode === 'cli' && (
                    <InlineNotice tone="warning" message={`This deployment can't run a long switch after the request ends (${wizard.runtime.reason ?? 'serverless'}). Run it with usertasks-admin where the app runs; this page follows the switch log.`} />
                  )}
                  {plan.passed && plan.confirmPhrase && plan.mode !== 'cli' && (
                    <div>
                      <label htmlFor={`pf-${area}-confirm`} className="block text-sm font-medium mb-1">Type <code>{plan.confirmPhrase}</code> to confirm</label>
                      <Input id={`pf-${area}-confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
                    </div>
                  )}
                  {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}
                  <div className="flex flex-wrap justify-between gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setStep('configure'); setPlan(null) }}><ArrowLeft size={14} /> Options</Button>
                    {plan.mode === 'cli' ? (
                      <Button type="button" size="sm" disabled={!plan.passed} onClick={apply}>Show the command</Button>
                    ) : (
                      <Button type="button" size="sm" disabled={pending || !plan.passed || wizard.busy || !wizard.gate.enabled || (plan.confirmPhrase !== null && confirm.trim() !== plan.confirmPhrase)} onClick={apply}>
                        {plan.mode === 'background' || plan.mode === 'chunked' ? 'Start switch' : 'Apply switch'}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {step === 'run' && (
                <div className="space-y-3">
                  {applied?.mode === 'cli' && (
                    <div className="space-y-2">
                      <p className="text-sm">Run this where the app runs (same environment: <code>DATABASE_URL</code>, <code>ENCRYPTION_KEY</code>, the provider variables):</p>
                      <CopyBlock text={applied.cli.command} />
                      {applied.cli.env.length > 0 && (
                        <p className="text-xs" style={muted}>Secret values are not in the command: export {applied.cli.env.join(', ')} first (for example from your secret manager), or use secret:// references instead.</p>
                      )}
                      {waitingForCli && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={pollCli}>I started it — follow the switch</Button>}
                    </div>
                  )}
                  {record && <LiveRecord initial={record} />}
                  {kind === 'settings' && test && 'lines' in test && !record && <Checks checks={test.preflight} />}
                  {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}
                  <div className="flex justify-end">
                    <Button type="button" size="sm" variant="outline" onClick={() => change(false)}>Close</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function LiveRecord({ initial }: { initial: SwitchRecordView }) {
  const record = useSwitchRecord(initial) ?? initial
  return <SwitchProgress record={record} />
}
