'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import type { DesignerState } from '@/lib/forms/designer-state'
import {
  FORM_PARAM_SOURCE_LABELS, FORM_PARAM_TYPES, FORM_PARAM_TYPE_LABELS, FORM_VARIABLE_TYPES, formContextNameProblem, formContextProblems, freeFormContextName,
  normalizeFormParams, normalizeFormVariables, requiredParamsWithoutDefault, type FormParam, type FormParamType, type FormVariable, type FormVariableType,
} from '@/lib/forms/form-params'
import { DISPLAY_FIELD_TYPES } from '@/lib/task-field-schema'
import { designerInputClass as inputClass } from './designer-controls'

/**
 * The form designer's Data tab: the form's parameters (inputs from the URL
 * or the embedding context) and variables (values rules keep while the form
 * is open) — lib/forms/form-params.ts. Both are read as {{param.<name>}} /
 * {{var.<name>}} wherever placeholders are accepted; the placeholder menus
 * list them in "Parameters" and "Variables" groups.
 */


function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-semibold text-fg-muted">{children}</label>
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '').slice(0, 40)
}

/**
 * A parameter / variable name box: what is typed stays in the box (a half-typed or reserved
 * name is shown with the reason) and the declaration is renamed once the name is usable.
 */
function NameField({ id, name, names, onRename }: { id: string; name: string; names: Set<string>; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState(name)
  useEffect(() => { setDraft(name) }, [name])
  const others = [...names].filter((n) => n !== name)
  const problem = draft === name ? null : formContextNameProblem(draft, others)
  return (
    <>
      <input id={id} className={inputClass} value={draft} aria-invalid={Boolean(problem)} aria-describedby={problem ? `${id}-problem` : undefined}
        onChange={(e) => { const next = slug(e.target.value); setDraft(next); if (!formContextNameProblem(next, others)) onRename(next) }}
        onBlur={() => setDraft(name)} />
      {problem && <p id={`${id}-problem`} className="mt-0.5 text-2xs text-danger">{problem}</p>}
    </>
  )
}

/** "Add parameter / variable": name and type first, so the new entry is usable (and visible) at once. */
function AddContextRow({ kind, names, types, onAdd }: { kind: 'param' | 'var'; names: Set<string>; types: FormVariableType[]; onAdd: (name: string, type: FormVariableType) => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<FormVariableType>('text')
  const problem = name ? formContextNameProblem(name, names) : null
  const add = () => {
    const chosen = name && !problem ? name : freeFormContextName(kind === 'param' ? 'customer_id' : 'selected', names)
    onAdd(chosen, type)
    setName('')
  }
  const noun = kind === 'param' ? 'parameter' : 'variable'
  return (
    <div className="mb-2 rounded border border-dashed p-1.5 border-border" data-testid={`add-form-${kind}-row`}>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,7rem)_auto] items-start gap-1">
        <div className="min-w-0">
          <input aria-label={`New ${noun} name`} className={inputClass} value={name} placeholder={kind === 'param' ? 'customer_id' : 'selected_customer'}
            aria-invalid={Boolean(problem)} data-testid={`new-form-${kind}-name`}
            onChange={(e) => setName(slug(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!problem) add() } }} />
        </div>
        <select aria-label={`New ${noun} type`} className={inputClass} value={type} onChange={(e) => setType(e.target.value as FormVariableType)} data-testid={`new-form-${kind}-type`}>
          {types.map((t) => <option key={t} value={t}>{FORM_PARAM_TYPE_LABELS[t]}</option>)}
        </select>
        <button type="button" className="flex h-8 items-center gap-1 rounded-md px-2 text-2xs font-medium disabled:opacity-50 bg-primary text-primary-fg" disabled={Boolean(problem)}
          data-testid={`add-form-${kind}`} aria-label={`Add ${noun}`} onClick={add}>
          <Plus size={12} aria-hidden /> Add
        </button>
      </div>
      {problem && <p className="mt-0.5 text-2xs text-danger" role="alert">{problem}</p>}
    </div>
  )
}

function Check({ checked, onChange, children, id }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; id: string }) {
  return (
    <label htmlFor={id} className="flex items-center gap-1.5 text-2xs">
      <input className="accent-primary" id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

function ParamEditor({ param, names, onChange, onRemove }: { param: FormParam; names: Set<string>; onChange: (next: FormParam, tag?: string) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(!param.label)
  const id = (k: string) => `param-${param.name}-${k}`
  const bounds = param.type === 'date' ? 'date' : param.type === 'boolean' ? null : 'number'
  const boundLabel = param.type === 'number' ? ['Minimum', 'Maximum'] : param.type === 'text' ? ['Min length', 'Max length'] : param.type === 'text_list' ? ['Min items', 'Max items'] : ['Earliest', 'Latest']
  return (
    <li className="rounded border border-border" data-form-param={param.name}>
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button type="button" className="flex flex-1 items-center gap-1 text-left text-2xs font-semibold" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
          <span className="truncate">{param.label ?? param.name}</span>
          <code className="ml-1 truncate rounded px-1 font-mono text-2xs font-normal bg-input">{`{{param.${param.name}}}`}</code>
        </button>
        <span className="text-2xs text-fg-muted">{FORM_PARAM_TYPE_LABELS[param.type]}{param.required ? ' · required' : ''}</span>
        <button type="button" className="rounded p-0.5" aria-label={`Remove parameter ${param.name}`} onClick={onRemove}><Trash2 size={11} aria-hidden /></button>
      </div>
      {open && (
        <div className="space-y-2 border-t px-2 py-2 border-border">
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <Label htmlFor={id('name')}>Name</Label>
              <NameField id={id('name')} name={param.name} names={names} onRename={(name) => onChange({ ...param, name }, 'param-name')} />
            </div>
            <div>
              <Label htmlFor={id('label')}>Label</Label>
              <input id={id('label')} className={inputClass} value={param.label ?? ''} placeholder={param.name} onChange={(e) => onChange({ ...param, label: e.target.value || undefined }, `param-label-${param.name}`)} />
            </div>
            <div>
              <Label htmlFor={id('type')}>Type</Label>
              <select id={id('type')} className={inputClass} value={param.type}
                onChange={(e) => onChange({ ...param, type: e.target.value as FormParamType, min: undefined, max: undefined, pattern: undefined, ...(e.target.value === 'boolean' ? { allowed: undefined } : {}) })}>
                {FORM_PARAM_TYPES.map((t) => <option key={t} value={t}>{FORM_PARAM_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor={id('default')}>Default</Label>
              <input id={id('default')} className={inputClass} value={param.default ?? ''} placeholder={param.type === 'text_list' ? 'a, b' : param.type === 'boolean' ? 'true / false' : param.type === 'date' ? 'YYYY-MM-DD' : 'None'}
                onChange={(e) => onChange({ ...param, default: e.target.value || undefined }, `param-default-${param.name}`)} />
            </div>
          </div>
          <div>
            <Label htmlFor={id('source')}>Comes from</Label>
            <select id={id('source')} className={inputClass} value={param.source} onChange={(e) => onChange({ ...param, source: e.target.value === 'context' ? 'context' : 'url', query_name: undefined })}>
              {(['url', 'context'] as const).map((s) => <option key={s} value={s}>{FORM_PARAM_SOURCE_LABELS[s]}</option>)}
            </select>
            {param.source === 'url' ? (
              <div className="mt-1 flex items-center gap-1">
                <label htmlFor={id('query')} className="shrink-0 text-2xs text-fg-muted">?</label>
                <input id={id('query')} aria-label="Query parameter name" className={inputClass} value={param.query_name ?? ''} placeholder={param.name}
                  onChange={(e) => onChange({ ...param, query_name: e.target.value.replace(/[^A-Za-z0-9_.~-]/g, '') || undefined }, `param-query-${param.name}`)} />
                <span className="shrink-0 text-2xs text-fg-muted">=…</span>
              </div>
            ) : (
              <p className="mt-1 text-2xs text-fg-muted">A task form gets it from the User Task step&apos;s Form parameters; a start form from the Run dialog. Never read from the URL.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <Check id={id('required')} checked={param.required === true} onChange={(v) => onChange({ ...param, required: v || undefined })}>Required</Check>
            <Check id={id('include')} checked={param.include === true} onChange={(v) => onChange({ ...param, include: v || undefined })}>Include in submission</Check>
          </div>
          {param.type !== 'boolean' && (
            <details className="text-2xs">
              <summary className="cursor-pointer text-2xs font-semibold text-fg-muted">Validation</summary>
              <div className="mt-1.5 space-y-1.5">
                <div>
                  <Label htmlFor={id('allowed')}>Allowed values (comma-separated)</Label>
                  <input id={id('allowed')} className={inputClass} value={(param.allowed ?? []).join(', ')} placeholder="Any"
                    onChange={(e) => onChange({ ...param, allowed: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} />
                </div>
                {(param.type === 'text' || param.type === 'text_list') && (
                  <div>
                    <Label htmlFor={id('pattern')}>Pattern (regular expression)</Label>
                    <input id={id('pattern')} className={`${inputClass} font-mono`} value={param.pattern ?? ''} placeholder="[A-Z]{5}"
                      onChange={(e) => onChange({ ...param, pattern: e.target.value || undefined }, `param-pattern-${param.name}`)} />
                  </div>
                )}
                {bounds && (
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['min', 'max'] as const).map((k, i) => (
                      <div key={k}>
                        <Label htmlFor={id(k)}>{boundLabel[i]}</Label>
                        <input id={id(k)} type={bounds} className={inputClass} value={param[k] ?? ''}
                          onChange={(e) => onChange({ ...param, [k]: e.target.value === '' ? undefined : bounds === 'number' ? Number(e.target.value) : e.target.value })} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </li>
  )
}

function VariableEditor({ variable, names, params, onChange, onRemove }: { variable: FormVariable; names: Set<string>; params: FormParam[]; onChange: (next: FormVariable, tag?: string) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(!variable.label)
  const id = (k: string) => `var-${variable.name}-${k}`
  const kind = variable.initial?.kind ?? 'none'
  return (
    <li className="rounded border border-border" data-form-variable={variable.name}>
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button type="button" className="flex flex-1 items-center gap-1 text-left text-2xs font-semibold" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
          <span className="truncate">{variable.label ?? variable.name}</span>
          <code className="ml-1 truncate rounded px-1 font-mono text-2xs font-normal bg-input">{`{{var.${variable.name}}}`}</code>
        </button>
        <span className="text-2xs text-fg-muted">{FORM_PARAM_TYPE_LABELS[variable.type]}{variable.include ? ' · submitted' : ''}</span>
        <button type="button" className="rounded p-0.5" aria-label={`Remove variable ${variable.name}`} onClick={onRemove}><Trash2 size={11} aria-hidden /></button>
      </div>
      {open && (
        <div className="space-y-2 border-t px-2 py-2 border-border">
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <Label htmlFor={id('name')}>Name</Label>
              <NameField id={id('name')} name={variable.name} names={names} onRename={(name) => onChange({ ...variable, name }, 'var-name')} />
            </div>
            <div>
              <Label htmlFor={id('label')}>Label</Label>
              <input id={id('label')} className={inputClass} value={variable.label ?? ''} placeholder={variable.name} onChange={(e) => onChange({ ...variable, label: e.target.value || undefined }, `var-label-${variable.name}`)} />
            </div>
            <div>
              <Label htmlFor={id('type')}>Type</Label>
              <select id={id('type')} className={inputClass} value={variable.type} onChange={(e) => onChange({ ...variable, type: e.target.value as FormVariableType })}>
                {FORM_VARIABLE_TYPES.map((t) => <option key={t} value={t}>{FORM_PARAM_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor={id('initial')}>Starts as</Label>
              <select id={id('initial')} className={inputClass} value={kind}
                onChange={(e) => {
                  const k = e.target.value
                  onChange({ ...variable, initial: k === 'none' ? undefined : { kind: k as 'constant' | 'param' | 'expression', value: k === 'param' ? (params[0]?.name ?? '') : '' } })
                }}>
                <option value="none">Empty</option>
                <option value="constant">A constant</option>
                <option value="param" disabled={!params.length}>A parameter</option>
                <option value="expression">An expression</option>
              </select>
            </div>
          </div>
          {kind === 'param' && (
            <select aria-label="Parameter" className={inputClass} value={variable.initial?.value ?? ''} onChange={(e) => onChange({ ...variable, initial: { kind: 'param', value: e.target.value } })}>
              {params.map((p) => <option key={p.name} value={p.name}>{p.label ?? p.name}</option>)}
            </select>
          )}
          {(kind === 'constant' || kind === 'expression') && (
            <input aria-label={kind === 'constant' ? 'Initial value' : 'Initial expression'} className={`${inputClass} ${kind === 'expression' ? 'font-mono' : ''}`}
              value={variable.initial?.value ?? ''} placeholder={kind === 'constant' ? (variable.type === 'object' ? '{"id": 1}' : 'A value') : '{{param.customer}}-{{today}}'}
              onChange={(e) => onChange({ ...variable, initial: { kind, value: e.target.value } }, `var-initial-${variable.name}`)} />
          )}
          <Check id={id('include')} checked={variable.include === true} onChange={(v) => onChange({ ...variable, include: v || undefined })}>Include in submission (stored as a hidden value for the workflow)</Check>
        </div>
      )}
    </li>
  )
}

export function FormContextPanel({ state, onChange }: { state: DesignerState; onChange: (next: DesignerState, tag?: string) => void }) {
  const params = normalizeFormParams(state.layout.params)
  const variables = normalizeFormVariables(state.layout.variables, params.map((p) => p.name))
  const names = new Set([...params.map((p) => p.name), ...variables.map((v) => v.name)])
  const fieldKeys = state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type)).map((f) => f.key)
  const problems = formContextProblems(state.layout, fieldKeys)
  const setParams = (next: FormParam[], tag?: string) => onChange({ ...state, layout: { ...state.layout, params: next.length ? next : undefined } }, tag)
  const setVariables = (next: FormVariable[], tag?: string) => onChange({ ...state, layout: { ...state.layout, variables: next.length ? next : undefined } }, tag)
  return (
    <div className="space-y-4" data-form-context-panel>
      <section aria-labelledby="form-params-heading">
        <div className="mb-1 flex items-center">
          <h3 id="form-params-heading" className="flex-1 text-xs font-semibold">Parameters</h3>
        </div>
        <p className="mb-2 text-2xs text-fg-muted">
          Inputs the form opens with: a URL query parameter (<code className="font-mono">/f/…?customer=ALFKI</code>) or a value the task step or Run dialog passes. Use them as <code className="font-mono">{'{{param.<name>}}'}</code> in rules, defaults, Data table filters, lookups and API mappings.
        </p>
        <AddContextRow kind="param" names={names} types={FORM_PARAM_TYPES} onAdd={(name, type) => setParams([...params, { name, type: type as FormParamType, source: 'url' }])} />
        {params.length ? (
          <ul className="space-y-1.5">
            {params.map((p, i) => (
              <ParamEditor key={i} param={p} names={names} onRemove={() => setParams(params.filter((_, j) => j !== i))}
                onChange={(next, tag) => setParams(params.map((x, j) => (j === i ? next : x)), tag)} />
            ))}
          </ul>
        ) : <p className="rounded border border-dashed px-2 py-2 text-2xs border-border text-fg-muted">No parameters. The form opens the same for everyone.</p>}
      </section>

      <section aria-labelledby="form-vars-heading">
        <div className="mb-1 flex items-center">
          <h3 id="form-vars-heading" className="flex-1 text-xs font-semibold">Variables</h3>
        </div>
        <p className="mb-2 text-2xs text-fg-muted">
          Values the form keeps while it is open. Rules change them with <strong>Set a variable</strong> (or an API reference&apos;s response); read them as <code className="font-mono">{'{{var.<name>}}'}</code>. Data tables and lookups that use one query again when it changes. Not submitted unless you include them.
        </p>
        <AddContextRow kind="var" names={names} types={FORM_VARIABLE_TYPES} onAdd={(name, type) => setVariables([...variables, { name, type }])} />
        {variables.length ? (
          <ul className="space-y-1.5">
            {variables.map((v, i) => (
              <VariableEditor key={i} variable={v} names={names} params={params} onRemove={() => setVariables(variables.filter((_, j) => j !== i))}
                onChange={(next, tag) => setVariables(variables.map((x, j) => (j === i ? next : x)), tag)} />
            ))}
          </ul>
        ) : <p className="rounded border border-dashed px-2 py-2 text-2xs border-border text-fg-muted">No variables yet.</p>}
      </section>

      {requiredParamsWithoutDefault(state.layout).length > 0 && (
        <p className="rounded border px-2 py-1.5 text-2xs border-border text-fg-muted" data-form-params-menu-note>
          This form needs {requiredParamsWithoutDefault(state.layout).map((p) => `"${p.label ?? p.name}"`).join(', ')} to open, so it is not listed in the Forms menu (which opens forms without parameters). Share a link with the values instead (Form link → QR code → Link with parameters).
        </p>
      )}
      {problems.length > 0 && (
        <ul className="space-y-1" role="status">
          {problems.map((p) => (
            <li key={p} className="flex items-start gap-1 text-2xs text-danger"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />{p}</li>
          ))}
        </ul>
      )}
      <p className="text-2xs text-fg-muted">
        Parameters and variables are input from the person filling in the form, like field values: the server checks them against these declarations, and they can only narrow a Data table&apos;s base filter or fill an API reference&apos;s mapped inputs.
      </p>
    </div>
  )
}
