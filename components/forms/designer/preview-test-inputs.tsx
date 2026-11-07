'use client'

import { useId, useState } from 'react'
import { Check, Link2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tag } from '@/components/ui/badge'
import { FORM_PARAM_SOURCE_LABELS, FORM_PARAM_TYPE_LABELS, layoutFormParams, layoutFormVariables, type FormParam, type FormVariable } from '@/lib/forms/form-params'
import { contextValueText, parseVariableInput, type PreviewSeed, type PreviewTestInputs } from '@/lib/forms/preview-inputs'

/**
 * The designer Preview's "Test inputs" panel: one typed input per form
 * parameter (prefilled with its default, required marker, the runtime's
 * validation) and each variable's live value, editable to override it
 * (lib/forms/preview-inputs.ts). Changing a parameter reopens the preview
 * as opening the form with it would (the dialog does that); a variable edit
 * applies to the running preview at once. Nothing is saved into the form.
 */
export function PreviewTestInputsPanel({ layout, inputs, seed, liveVars, initialVars, onParamChange, onClearParams, onVarChange, onVarReset, onResetAllVars, copyLink }: {
  layout: unknown
  inputs: PreviewTestInputs
  seed: PreviewSeed
  /** The variables' current values in the running preview. */
  liveVars: Record<string, unknown>
  /** What each variable starts as for these parameters (no override). */
  initialVars: Record<string, unknown>
  onParamChange: (name: string, text: string) => void
  onClearParams: () => void
  onVarChange: (name: string, text: string, value: unknown | undefined) => void
  onVarReset: (name: string) => void
  onResetAllVars: () => void
  /** The form page link with these parameters (only for a saved reusable form). */
  copyLink?: string | null
}) {
  const id = useId()
  const params = layoutFormParams(layout)
  const variables = layoutFormVariables(layout)
  // A variable box being edited keeps its text (an unparsable value isn't applied until it fits the type).
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState(false)
  if (!params.length && !variables.length) return null

  const paramError = (p: FormParam): string | undefined => seed.params?.errors[p.name] ?? (seed.params?.missing.includes(p.name) ? 'Required: the form page would not open without it' : undefined)
  const changed = (v: FormVariable) => Object.prototype.hasOwnProperty.call(inputs.vars, v.name) || contextValueText(liveVars[v.name]) !== contextValueText(initialVars[v.name])
  const anyVarChanged = variables.some(changed)

  function paramControl(p: FormParam) {
    const value = inputs.params[p.name] ?? ''
    const blank = p.default ? `Default (${p.default})` : '—'
    if (p.type === 'boolean') return <Select size="sm" value={value} onChange={(e) => onParamChange(p.name, e.target.value)} options={[{ value: '', label: blank }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
    if (p.allowed?.length && p.type !== 'text_list') {
      const options = [{ value: '', label: blank }, ...p.allowed.map((a) => ({ value: a, label: a }))]
      if (value && !p.allowed.includes(value)) options.push({ value, label: value })
      return <Select size="sm" value={value} onChange={(e) => onParamChange(p.name, e.target.value)} options={options} />
    }
    return (
      <Input size="sm" type={p.type === 'date' ? 'date' : 'text'} inputMode={p.type === 'number' ? 'decimal' : undefined} value={value}
        placeholder={p.default ?? (p.type === 'text_list' ? 'a, b, c' : '')} onChange={(e) => onParamChange(p.name, e.target.value)} />
    )
  }

  function varControl(v: FormVariable) {
    const text = drafts[v.name] ?? contextValueText(liveVars[v.name])
    const edit = (next: string) => {
      setDrafts((d) => ({ ...d, [v.name]: next }))
      const r = parseVariableInput(v, next)
      onVarChange(v.name, next, 'error' in r ? undefined : r.value)
    }
    const done = () => setDrafts((d) => { if (!(v.name in d)) return d; const next = { ...d }; delete next[v.name]; return next })
    if (v.type === 'boolean') return <Select size="sm" value={text === 'true' || text === 'false' ? text : ''} onChange={(e) => edit(e.target.value)} options={[{ value: '', label: '—' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
    if (v.type === 'object') return <Textarea rows={2} className="font-mono text-xs" value={text} placeholder='{"id": 1}' onChange={(e) => edit(e.target.value)} onBlur={done} />
    return <Input size="sm" type={v.type === 'date' ? 'date' : 'text'} inputMode={v.type === 'number' ? 'decimal' : undefined} value={text} placeholder={v.type === 'text_list' ? 'a, b, c' : ''} onChange={(e) => edit(e.target.value)} onBlur={done} />
  }

  async function copy() {
    if (!copyLink) return
    try { await navigator.clipboard.writeText(copyLink); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard refused */ }
  }

  return (
    <section className="mb-3 rounded-lg border border-border-subtle bg-panel p-3" aria-label="Test inputs" data-preview-test-inputs>
      {params.length > 0 && (
        <div role="group" aria-labelledby={`${id}-params`} data-preview-params>
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <h3 id={`${id}-params`} className="text-xs font-semibold">Parameters</h3>
            <p className="flex-1 text-2xs text-fg-muted">Changing one reopens the preview, as opening the form with it would.</p>
            {copyLink && (
              <Button size="sm" variant="ghost" leadingIcon={copied ? <Check className="size-[var(--btn-icon)]" aria-hidden /> : <Link2 className="size-[var(--btn-icon)]" aria-hidden />} onClick={() => void copy()} data-copy-param-link>
                {copied ? 'Copied' : 'Copy link with these parameters'}
              </Button>
            )}
            {Object.keys(inputs.params).length > 0 && <Button size="sm" variant="ghost" onClick={onClearParams}>Use defaults</Button>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {params.map((p) => (
              <Field key={p.name} id={`${id}-p-${p.name}`} required={p.required} error={paramError(p)}
                label={<>{p.label ?? p.name} <span className="font-mono text-2xs font-normal text-fg-muted">param.{p.name}</span></>}
                description={[FORM_PARAM_TYPE_LABELS[p.type], p.type === 'text_list' ? 'comma-separated' : null, p.source === 'url' ? `?${p.query_name ?? p.name}=` : FORM_PARAM_SOURCE_LABELS.context.split(' (')[0]].filter(Boolean).join(' · ')}>
                {paramControl(p)}
              </Field>
            ))}
          </div>
          {seed.message && <p className="mt-2 text-2xs text-fg-muted" role="status" data-preview-params-message>On the form page this shows instead of the form: {seed.message}</p>}
        </div>
      )}
      {variables.length > 0 && (
        <div role="group" aria-labelledby={`${id}-vars`} className={params.length ? 'mt-3 border-t border-border-subtle pt-3' : undefined} data-preview-vars>
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <h3 id={`${id}-vars`} className="text-xs font-semibold">Variables</h3>
            <p className="flex-1 text-2xs text-fg-muted">Live values: rules change them as you use the preview; edit one to override it.</p>
            {anyVarChanged && <Button size="sm" variant="ghost" leadingIcon={<RotateCcw className="size-[var(--btn-icon)]" aria-hidden />} onClick={() => { setDrafts({}); onResetAllVars() }} data-reset-all-vars>Reset all</Button>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {variables.map((v) => {
              const draft = drafts[v.name]
              const draftError = draft !== undefined ? (() => { const r = parseVariableInput(v, draft); return 'error' in r ? r.error : undefined })() : undefined
              const initial = contextValueText(initialVars[v.name])
              return (
                <Field key={v.name} id={`${id}-v-${v.name}`} error={draftError ?? seed.varErrors[v.name]}
                  label={<>{v.label ?? v.name} <span className="font-mono text-2xs font-normal text-fg-muted">var.{v.name}</span>{Object.prototype.hasOwnProperty.call(inputs.vars, v.name) && <Tag className="ml-1 align-middle">Overridden</Tag>}</>}
                  labelAside={changed(v) ? <button type="button" className="text-2xs font-medium text-primary-text hover:underline" onClick={() => { setDrafts((d) => { const next = { ...d }; delete next[v.name]; return next }); onVarReset(v.name) }} aria-label={`Reset ${v.label ?? v.name}`} data-reset-var={v.name}>Reset</button> : undefined}
                  description={`${FORM_PARAM_TYPE_LABELS[v.type]} · starts as ${initial ? (initial.length > 60 ? `${initial.slice(0, 60)}…` : initial) : 'empty'}`}>
                  {varControl(v)}
                </Field>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
