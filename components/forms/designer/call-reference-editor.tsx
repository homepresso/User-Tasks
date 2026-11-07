'use client'

/* eslint-disable @typescript-eslint/no-explicit-any -- reference rows are free-form JSON */

import { useMemo, useState } from 'react'
import { Wand2, X } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import { LoadSampleButton } from '@/components/integrations/response-collection-picker'
import { isWriteReference, referencePickerHint } from '@/lib/custom-references/types'
import type { DesignerState } from '@/lib/forms/designer-state'
import type { FieldButtonAction } from '@/lib/forms/field-buttons'
import { FORM_PARAM_TYPE_LABELS, layoutFormParams, layoutFormVariables } from '@/lib/forms/form-params'
import { isResultPath, normalizeResultPath, resultPathOptions, resultTypeNote, suggestResultMappings, type ResultPathOption } from '@/lib/forms/reference-results'
import { referenceResponseSchema, type ResponseSchema } from '@/lib/response-schema'
import { runtimeView } from '@/lib/response-collections'
import { DISPLAY_FIELD_TYPES, TASK_FIELD_TYPE_LABELS, type TaskFieldType } from '@/lib/task-field-schema'
import { designerInputClass as inputClass } from './designer-controls'
import { cn } from '@/lib/utils'

/**
 * A form rule's "Call an API reference" (lib/forms/field-buttons.ts
 * `call_reference`), laid out the way a designer reads it:
 *
 *   1. the reference;
 *   2. **Inputs** — each of the reference's inputs, mapped to a placeholder
 *      (the picker lists This form, Parameters, Variables, This event…);
 *      an input named like a parameter or field is mapped to it at once;
 *   3. **Then map the response** — response field → form field or variable,
 *      typed, from the reference's response model (**Load sample** fills it
 *      in) or a typed path; **Map matching names** suggests the obvious ones;
 *   4. **If the call fails** — show a message (the default, or the author's
 *      text) or leave the fields unchanged and go on.
 *
 * The call and the mapping run on the server (lib/services/form-rule-actions.ts,
 * lib/forms/reference-results.ts): the browser never chooses the URL, and
 * only the declared fields / variables mapped here are written.
 */

const muted = { color: 'var(--theme-muted-text)' }

function Heading({ children }: { children: React.ReactNode }) {
  return <p className="text-2xs font-semibold text-fg-muted">{children}</p>
}

interface Target { value: string; label: string; type: string; hint: string }

function typeLabel(type: ResultPathOption['type']): string {
  return type === 'integer' ? 'number' : type === 'array' ? 'list' : type
}

function exampleText(v: unknown): string {
  if (v === undefined || v === null) return ''
  const s = String(v)
  return s.length > 28 ? `${s.slice(0, 27)}…` : s
}

/** Inputs named like a parameter or a field are mapped to it (`customer_id` ← {{param.customer_id}}). */
export function guessReferenceInputs(inputs: Array<{ name: string }>, state: Pick<DesignerState, 'fields' | 'layout'>): Record<string, string> {
  const params = new Set(layoutFormParams(state.layout).map((p) => p.name))
  const fields = new Set(state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type)).map((f) => f.key))
  const out: Record<string, string> = {}
  for (const { name } of inputs) {
    if (params.has(name)) out[name] = `{{param.${name}}}`
    else if (fields.has(name)) out[name] = `{{${name}}}`
  }
  return out
}

export function CallReferenceEditor({ action, state, references, placeholders, onChange }: {
  action: FieldButtonAction
  state: DesignerState
  references: any[]
  placeholders: Array<{ name: string; group: string; label?: string }>
  onChange: (next: FieldButtonAction, tag?: string) => void
}) {
  const ref = references.find((r) => String(r.id) === action.reference_id)
  const inputs: Array<{ name: string; required?: boolean; description?: string; default_value?: unknown }> = Array.isArray(ref?.inputs) ? ref.inputs : []
  const [loaded, setLoaded] = useState<{ id: string; schema: ResponseSchema } | null>(null)
  const model = loaded && loaded.id === action.reference_id ? loaded.schema : referenceResponseSchema(ref)
  const root = runtimeView(model).root
  const options = resultPathOptions(root && root.type !== 'any' ? root : null)
  const targets = useMemo<Target[]>(() => [
    ...state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type) && f.type !== 'data_table' && f.type !== 'attachments' && !f.read_only)
      .map((f) => ({ value: f.key, label: f.label || f.key, type: f.type, hint: `field · ${TASK_FIELD_TYPE_LABELS[f.type as TaskFieldType] ?? f.type}` })),
    ...layoutFormVariables(state.layout).map((v) => ({ value: `var.${v.name}`, label: `{{var.${v.name}}}`, type: `var:${v.type}`, hint: `variable · ${FORM_PARAM_TYPE_LABELS[v.type].toLowerCase()}` })),
  ], [state.fields, state.layout])
  const results = action.results ?? {}
  const suggestions = suggestResultMappings(options, targets, results)
  const setResults = (next: Record<string, string>) => onChange({ ...action, results: Object.keys(next).length ? next : undefined })

  return (
    <div className="min-w-0 space-y-2" data-testid="call-reference-editor">
      <AutocompleteSelect value={action.reference_id ?? ''} placeholder="Choose an API reference…" options={references.map((r) => ({ value: String(r.id), label: String(r.name), hint: referencePickerHint(r) }))}
        onChange={(v) => {
          const chosen = references.find((r) => String(r.id) === v)
          const guessed = guessReferenceInputs(Array.isArray(chosen?.inputs) ? chosen.inputs : [], state)
          onChange({ ...action, reference_id: v || undefined, integration_id: chosen?.integration?.id ?? undefined, inputs: Object.keys(guessed).length ? guessed : undefined })
        }} />
      {isWriteReference(ref) && (
        <p className="text-2xs text-warning" role="note" data-testid="rule-writes-data">
          &#9888; Writes data — it runs on the server, for real, every time this rule fires (each click of a button). Guard it with a condition or a confirmation question if it should not repeat.
        </p>
      )}
      {ref && <InputsSection inputs={inputs} action={action} placeholders={placeholders} onChange={onChange} />}
      {ref && (
        <section className="min-w-0 space-y-1.5" aria-label="Then map the response" data-testid="call-reference-results">
          <Heading>Then map the response</Heading>
          <LoadSampleButton referenceId={String(ref.id)} inputs={inputs} mappings={action.inputs} compact={Boolean(root)}
            onLoaded={(schema) => setLoaded({ id: String(ref.id), schema })} />
          {!options.length && <p className="text-2xs text-fg-muted">No response model yet: <strong>Load sample</strong> to pick from the response, or type a path (<code className="font-mono">data.name</code>, <code className="font-mono">[0].email</code>).</p>}
          {Object.entries(results).map(([path, key]) => (
            <ResultRow key={path} path={path} target={key} options={options} targets={targets}
              onRemove={() => { const next = { ...results }; delete next[path]; setResults(next) }}
              onTarget={(t) => setResults({ ...results, [path]: t })} />
          ))}
          <ResultAdder options={options.filter((o) => !(o.path in results))} targets={targets} onAdd={(path, key) => setResults({ ...results, [path]: key })} />
          {Object.keys(suggestions).length > 0 && (
            <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" data-testid="map-matching-names"
              onClick={() => setResults({ ...results, ...suggestions })}>
              <Wand2 size={11} aria-hidden /> Map matching names ({Object.entries(suggestions).map(([p, k]) => `${p} → ${targets.find((t) => t.value === k)?.label ?? k}`).join(', ')})
            </button>
          )}
          <p className="text-2xs text-fg-muted">Mapped on the server: only the fields and variables listed here are written, each converted to its type. A value the response doesn&apos;t have leaves the field as it is.</p>
        </section>
      )}
      {ref && <OnErrorSection action={action} placeholders={placeholders} onChange={onChange} />}
    </div>
  )
}

function InputsSection({ inputs, action, placeholders, onChange }: {
  inputs: Array<{ name: string; required?: boolean; description?: string }>
  action: FieldButtonAction
  placeholders: Array<{ name: string; group: string; label?: string }>
  onChange: (next: FieldButtonAction, tag?: string) => void
}) {
  if (!inputs.length) return <p className="text-2xs text-fg-muted">This reference takes no inputs.</p>
  return (
    <section className="min-w-0 space-y-1.5" aria-label="Inputs" data-testid="call-reference-inputs">
      <Heading>Inputs</Heading>
      {inputs.map((input) => {
        const missing = input.required && !action.inputs?.[input.name]
        return (
          <div key={input.name} className="min-w-0" data-reference-input={input.name}>
            <p className="flex items-baseline gap-1 text-2xs">
              <span className="font-mono">{input.name}</span>
              {input.required && <span className="text-2xs" style={missing ? { color: 'var(--status-blocked)' } : muted}>required</span>}
              {input.description && <span className="truncate text-2xs text-fg-muted">— {input.description}</span>}
            </p>
            <VariableInput value={action.inputs?.[input.name] ?? ''} extraVariables={placeholders} placeholder="{{param.customer_id}}, {{field}} or a value" ariaLabel={`Input ${input.name}`}
              onChange={(v) => { const next = { ...(action.inputs ?? {}) }; if (v) next[input.name] = v; else delete next[input.name]; onChange({ ...action, inputs: next }, `ref-in-${input.name}`) }} />
          </div>
        )
      })}
      <p className="text-2xs text-fg-muted">Values go only into these inputs (never the URL or headers). A parameter is the person&apos;s input: the server checks it against the Data tab first.</p>
    </section>
  )
}

function ResultRow({ path, target, options, targets, onRemove, onTarget }: {
  path: string
  target: string
  options: ResultPathOption[]
  targets: Target[]
  onRemove: () => void
  onTarget: (key: string) => void
}) {
  const option = options.find((o) => o.path === path)
  const t = targets.find((x) => x.value === target)
  const note = resultTypeNote(option?.type, t?.type)
  return (
    <div className="min-w-0" data-result-row={path}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-1 text-2xs">
        <span className="min-w-0 truncate rounded border px-1.5 py-1 font-mono text-2xs border-border" title={path || '(the whole response)'}>
          {path || '(the whole response)'}{option ? <span className="text-fg-muted"> · {typeLabel(option.type)}</span> : null}
        </span>
        <span aria-hidden>→</span>
        <AutocompleteSelect value={target} options={targets.map((x) => ({ value: x.value, label: x.label, hint: x.hint }))} onChange={(v) => { if (v) onTarget(v) }} />
        <button type="button" className="rounded p-0.5" aria-label={`Stop mapping ${path || 'the response'}`} onClick={onRemove}><X size={10} /></button>
      </div>
      {!t && <p className="mt-0.5 text-2xs text-danger" role="alert">&quot;{target}&quot; is not an editable field or variable of this form.</p>}
      {note && t && <p className="mt-0.5 text-2xs text-fg-muted">The response has {note}.</p>}
    </div>
  )
}

function ResultAdder({ options, targets, onAdd }: { options: ResultPathOption[]; targets: Target[]; onAdd: (path: string, key: string) => void }) {
  const [path, setPath] = useState('')
  const [typed, setTyped] = useState(!options.length)
  const [key, setKey] = useState('')
  const clean = normalizeResultPath(path)
  const valid = isResultPath(clean)
  const add = () => { if (!key || !valid) return; onAdd(clean, key); setPath(''); setKey('') }
  return (
    <div className="min-w-0 space-y-1 rounded border border-dashed p-1.5 border-border" data-testid="result-adder">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-1">
        {typed || !options.length ? (
          <input aria-label="Response path" className={`${inputClass} font-mono`} value={path} placeholder="data.name, [0].email" aria-invalid={Boolean(path) && !valid}
            onChange={(e) => setPath(e.target.value)} data-testid="result-path-input" />
        ) : (
          <AutocompleteSelect value={path} placeholder="Response field…" options={options.map((o) => ({ value: o.path, label: `${'  '.repeat(o.level)}${o.path}`, hint: `${typeLabel(o.type)}${o.example !== undefined ? ` · e.g. ${exampleText(o.example)}` : ''}` }))}
            onChange={setPath} />
        )}
        <AutocompleteSelect value={key} placeholder="Field or variable…" options={targets.map((x) => ({ value: x.value, label: x.label, hint: x.hint }))} onChange={setKey} />
        <button type="button" className="h-8 rounded border px-2 text-2xs disabled:opacity-50 border-border" disabled={!key || !valid} onClick={add} data-testid="result-add">Add</button>
      </div>
      {path && !valid && <p className="text-2xs text-danger" role="alert">Not a response path: use names and [0] for a list&apos;s item, e.g. data.items[0].name.</p>}
      {path && valid && options.length > 0 && (() => {
        const note = resultTypeNote(options.find((o) => o.path === clean)?.type, targets.find((t) => t.value === key)?.type)
        return note ? <p className="text-2xs text-fg-muted">The response has {note}.</p> : null
      })()}
      {options.length > 0 && (
        <button type="button" className="text-2xs underline text-fg-muted" onClick={() => { setTyped(!typed); setPath('') }}>{typed ? 'Pick from the response' : 'Type a path instead'}</button>
      )}
    </div>
  )
}

function OnErrorSection({ action, placeholders, onChange }: {
  action: FieldButtonAction
  placeholders: Array<{ name: string; group: string; label?: string }>
  onChange: (next: FieldButtonAction, tag?: string) => void
}) {
  const mode = action.on_error === 'ignore' ? 'ignore' : 'message'
  return (
    <section className="min-w-0 space-y-1" aria-label="If the call fails" data-testid="call-reference-on-error">
      <Heading>If the call fails</Heading>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="If the call fails">
        {([['message', 'Show a message'], ['ignore', 'Leave the fields unchanged']] as const).map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => onChange({ ...action, on_error: v === 'ignore' ? 'ignore' : undefined, ...(v === 'ignore' ? { error_text: undefined } : {}) })}
            className={cn('h-7 min-w-0 flex-1 rounded border px-1 text-2xs font-medium', mode === v ? 'border-primary' : 'border-border', mode === v ? 'bg-primary-wash' : '', mode === v ? 'text-primary-text' : '')}
           >{label}</button>
        ))}
      </div>
      {mode === 'message' ? (
        <VariableInput value={action.error_text ?? ''} extraVariables={placeholders} placeholder="We couldn't find customer {{param.customer_id}}" ariaLabel="Message when the call fails"
          onChange={(v) => onChange({ ...action, error_text: v || undefined }, 'ref-error-text')} />
      ) : null}
      <p className="text-2xs text-fg-muted">
        {mode === 'message'
          ? 'Shown to the person (empty: the service’s own message); the rule’s later steps don’t run.'
          : 'Nothing is shown and nothing is written; the rule goes on with its next step.'}
      </p>
    </section>
  )
}
