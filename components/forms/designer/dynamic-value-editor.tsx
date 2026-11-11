'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Play, Plus, X, Zap } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import { ResponseCollectionPicker } from '@/components/integrations/response-collection-picker'
import { serverRead } from '@/lib/server-read'
import { isWriteReference, referencePickerHint } from '@/lib/custom-references/types'
import { referenceResponseSchema, type ResponseSchema } from '@/lib/response-schema'
import { collectionItemFields, runtimeView, validateCollectionPath } from '@/lib/response-collections'
import {
  DYNAMIC_BINDING_KIND_LABELS, DYNAMIC_LIMITS, DYNAMIC_VALUE_TYPE_LABELS, coerceDynamicValue, describeBinding, isSourceBinding, normalizeDynamicBinding,
  resolveExpression, type DynamicBinding, type DynamicBindingKind, type DynamicColumn, type DynamicValueType, type ReferenceBinding, type TableBinding,
} from '@/lib/forms/dynamic-values'
import type { DesignerField, DesignerState } from '@/lib/forms/designer-state'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { DATA_TABLE_ROW_ID, type DataTableConditionGroup } from '@/lib/forms/data-table'
import { withFormContext } from '@/lib/forms/form-params'
import { DesignerVariableScope } from './designer-variable-scope'
import { useDesignerPreviewValues } from './designer-preview-context'
import { GroupEditor } from './data-table-properties'
import { cn } from '@/lib/utils'
import { designerInputClass as inputClass } from './designer-controls'

/* eslint-disable @typescript-eslint/no-explicit-any -- tables / references are read as the browser sees them */

/**
 * Dynamic properties in the form designer (lib/forms/dynamic-values.ts): a
 * "Static / Dynamic" switch beside a bindable property; Dynamic opens the
 * binding editor — Expression, Data table or API reference — with a live
 * preview of the resolved value, type-checked against what the property
 * expects. The static value stays the preview and the fallback.
 */

const on = { borderColor: 'var(--theme-primary)', backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</span>
}
function Toggle({ checked, onChange, children, testId }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; testId?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-2xs" data-testid={testId}>
      <input className="accent-primary" type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

/** Needs one value column (options, text lists, scalars) or item columns (lists / objects). */
function wantsColumns(expects: DynamicValueType): boolean {
  return expects === 'list' || expects === 'object' || expects === 'any'
}

/**
 * A bindable property: its label with the Static / Dynamic switch, then the
 * static editor (children) or the binding's summary and editor.
 */
export function DynamicProp({ state, field, prop, label, expects, onPatch, children, htmlFor }: {
  state: DesignerState
  field: DesignerField
  /** `options`, `max`, `props.data`… */
  prop: string
  label: string
  expects: DynamicValueType
  onPatch: (patch: Partial<TaskFieldDef>, tag?: string) => void
  children: React.ReactNode
  htmlFor?: string
}) {
  const binding = field.dynamic?.[prop]
  const [open, setOpen] = useState(false)
  const setBinding = (next: DynamicBinding | undefined, tag?: string) => {
    const dynamic = { ...(field.dynamic ?? {}) }
    if (next) dynamic[prop] = next
    else delete dynamic[prop]
    onPatch({ dynamic: Object.keys(dynamic).length ? dynamic : undefined }, tag)
  }
  const slug = prop.replace(/[^a-z0-9_]/gi, '-')
  return (
    <div data-dynamic-prop={prop}>
      <div className="mb-0.5 flex items-center gap-1">
        <label htmlFor={htmlFor} className="flex-1 text-2xs font-medium text-fg-muted">{label}</label>
        <div className="flex overflow-hidden rounded border text-2xs font-medium border-border" role="radiogroup" aria-label={`${label}: static or dynamic`}>
          <button type="button" role="radio" aria-checked={!binding} className="px-1.5 py-0.5" style={!binding ? on : { color: 'var(--theme-muted-text)' }} onClick={() => { setBinding(undefined); setOpen(false) }} data-testid={`dyn-static-${slug}`}>Static</button>
          <button type="button" role="radio" aria-checked={Boolean(binding)} className="flex items-center gap-0.5 px-1.5 py-0.5" style={binding ? on : { color: 'var(--theme-muted-text)' }}
            onClick={() => { if (!binding) setBinding({ kind: 'expr', expr: '', ...(prop.startsWith('props.') ? { expects } : {}) } as DynamicBinding); setOpen(true) }} data-testid={`dyn-dynamic-${slug}`}>
            <Zap size={9} aria-hidden /> Dynamic
          </button>
        </div>
      </div>
      {!binding ? children : (
        <div className="space-y-1">
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-1 rounded border px-2 py-1 text-left text-2xs border-primary text-fg" data-testid={`dyn-summary-${slug}`}>
            <Zap className="text-primary-text" size={11} aria-hidden />
            <span className="font-medium">{DYNAMIC_BINDING_KIND_LABELS[binding.kind]}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-2xs text-fg-muted">{binding.kind === 'expr' && !binding.expr ? 'not set' : describeBinding(binding)}</span>
            <span className="text-2xs text-primary-text">{open ? 'Close' : 'Edit'}</span>
          </button>
          {open && <BindingEditor state={state} field={field} prop={prop} expects={expects} binding={binding} onChange={setBinding} />}
          <p className="text-2xs text-fg-muted">The static value is the preview and the fallback while it loads.</p>
        </div>
      )}
    </div>
  )
}

/** The binding editor: three tabs and the preview. */
export function BindingEditor({ state, field, prop, expects, binding, onChange }: {
  state: DesignerState
  field: DesignerField
  prop: string
  expects: DynamicValueType
  binding: DynamicBinding
  onChange: (next: DynamicBinding | undefined, tag?: string) => void
}) {
  const custom = prop.startsWith('props.')
  const withExpects = <T extends DynamicBinding>(b: T): T => (custom ? { ...b, expects } : b)
  const switchKind = (kind: DynamicBindingKind) => {
    if (kind === binding.kind) return
    if (kind === 'expr') onChange(withExpects({ kind: 'expr', expr: '' }))
    else if (kind === 'table') onChange(withExpects({ kind: 'table', table_id: '' } as TableBinding))
    else onChange(withExpects({ kind: 'reference', reference_id: '' } as ReferenceBinding))
  }
  return (
    <DesignerVariableScope state={state} context={{ kind: 'dynamic_value', exclude: field.key }}>
      <div className="space-y-2 rounded-md border p-2 border-border" data-testid="dynamic-binding-editor">
        <div className="flex gap-1" role="tablist" aria-label="Where the value comes from">
          {(['expr', 'table', 'reference'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={binding.kind === k} onClick={() => switchKind(k)} className={cn('h-7 flex-1 rounded border text-2xs font-medium', binding.kind === k ? 'bg-primary' : '', binding.kind === k ? 'border-primary' : 'border-border', binding.kind === k ? 'text-primary-fg' : 'text-fg')} data-dyn-tab={k}>
              {DYNAMIC_BINDING_KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <p className="text-2xs text-fg-muted">Expects {DYNAMIC_VALUE_TYPE_LABELS[expects]}.</p>
        {binding.kind === 'expr' && (
          <div>
            <Label>Expression</Label>
            <VariableInput value={binding.expr} ariaLabel="Expression" placeholder="e.g. {{var.limit}}, {{param.region}}, {{form.country}}, {{today+30d}}"
              onChange={(v) => onChange(withExpects({ kind: 'expr', expr: v }), `dyn-expr-${prop}`)} />
            <p className="mt-1 text-2xs text-fg-muted">One placeholder alone keeps its value (a number, a list); text around it makes text. Resolved again whenever what it reads changes.</p>
          </div>
        )}
        {binding.kind === 'table' && <TableTab binding={binding} expects={expects} onChange={(b, tag) => onChange(withExpects(b), tag)} />}
        {binding.kind === 'reference' && <ReferenceTab binding={binding} expects={expects} onChange={(b, tag) => onChange(withExpects(b), tag)} />}
        {isSourceBinding(binding) && (
          <div className="space-y-1 border-t pt-2 border-border">
            {prop === 'options' && <Toggle checked={binding.restrict !== false} onChange={(v) => onChange({ ...binding, restrict: v ? undefined : false })}>Restrict to the list (the server checks each submitted value)</Toggle>}
            {prop === 'options' && <Toggle checked={binding.when_inputs_blank === 'keep'} onChange={(v) => onChange({ ...binding, when_inputs_blank: v ? 'keep' : undefined })}>When a field it reads is empty, keep the options (default: offer none — a cascade waiting for its parent)</Toggle>}
            <Toggle checked={binding.anonymous_read === true} onChange={(v) => onChange({ ...binding, anonymous_read: v || undefined })} testId="dyn-anonymous-read">Allow anonymous read</Toggle>
            {binding.anonymous_read !== true
              ? <p className="flex items-start gap-1 text-2xs text-danger" data-testid="dyn-anonymous-warning"><AlertTriangle size={11} className="mt-px shrink-0" aria-hidden /> On a public link (anonymous form) this resolves empty — turn on &ldquo;Allow anonymous read&rdquo; to let visitors read it.</p>
              : <p className="text-2xs text-danger">On: ANYONE with the link can read the declared columns, within the filter (at most {DYNAMIC_LIMITS.options} options / {DYNAMIC_LIMITS.rows} rows).</p>}
          </div>
        )}
        <Preview field={field} prop={prop} expects={expects} binding={binding} layout={state.layout} />
      </div>
    </DesignerVariableScope>
  )
}

function ColumnsEditor({ columns, available, onChange, placeholder }: { columns: DynamicColumn[]; available: Array<{ value: string; label: string }>; onChange: (next: DynamicColumn[] | undefined) => void; placeholder: string }) {
  const notAdded = available.filter((a) => !columns.some((c) => c.key === a.value))
  return (
    <div className="space-y-1" data-testid="dyn-columns">
      {columns.map((c, i) => (
        <div key={c.key} className="grid grid-cols-[1fr_1fr_auto] gap-1">
          <span className="truncate rounded border px-2 py-1 font-mono text-2xs border-border">{c.key}</span>
          <input aria-label={`${c.key} output name`} className={inputClass} placeholder="as (optional)" value={c.as ?? ''}
            onChange={(e) => onChange(columns.map((x, j) => (j === i ? { key: x.key, ...(e.target.value ? { as: e.target.value.replace(/[^A-Za-z0-9_]/g, '') } : {}) } : x)))} />
          <button type="button" className="rounded p-0.5" aria-label={`Remove ${c.key}`} onClick={() => { const next = columns.filter((_, j) => j !== i); onChange(next.length ? next : undefined) }}><X size={11} /></button>
        </div>
      ))}
      <AutocompleteSelect value="" placeholder={placeholder} options={notAdded} onChange={(v) => v && onChange([...columns, { key: v }])} />
    </div>
  )
}

function ShapeEditor({ expects, value, label, columns, available, onChange }: {
  expects: DynamicValueType
  value?: string
  label?: string
  columns?: DynamicColumn[]
  available: Array<{ value: string; label: string }>
  onChange: (patch: { value?: string; label?: string; columns?: DynamicColumn[] }) => void
}) {
  if (wantsColumns(expects)) {
    return (
      <div>
        <Label>Columns each item keeps (rename with &ldquo;as&rdquo;)</Label>
        <ColumnsEditor columns={columns ?? []} available={available} placeholder="Add a column…" onChange={(next) => onChange({ columns: next })} />
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-1">
      <div>
        <Label>{expects === 'options' ? 'Option value' : 'Value'}</Label>
        <AutocompleteSelect value={value ?? ''} placeholder="Column…" options={available} onChange={(v) => onChange({ value: v || undefined })} />
      </div>
      {expects === 'options' && (
        <div>
          <Label>Option label</Label>
          <AutocompleteSelect value={label ?? ''} placeholder="Same as value" clearable options={available} onChange={(v) => onChange({ label: v || undefined })} />
        </div>
      )}
    </div>
  )
}

function placeholdersFor(): Array<{ name: string; group: string; label?: string }> {
  return [{ name: 'today', group: 'Dates', label: 'Today' }, { name: 'user.email', group: 'Current user', label: 'Email' }]
}

function FilterAndSort({ binding, columns, onChange }: { binding: TableBinding | ReferenceBinding; columns: Array<{ value: string; label: string }>; onChange: (patch: Partial<Pick<TableBinding, 'base_filter' | 'sort' | 'limit'>>, tag?: string) => void }) {
  const sort = binding.sort?.[0]
  return (
    <>
      <div>
        <Label>Filter (values may be placeholders: {'{{param.region}}'}, {'{{form.country}}'} — they only narrow)</Label>
        {binding.base_filter
          ? <GroupEditor group={binding.base_filter} depth={0} columns={columns} placeholders={placeholdersFor()} onChange={(next: DataTableConditionGroup | undefined, tag?: string) => onChange({ base_filter: next }, tag)} />
          : <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" disabled={!columns.length}
              onClick={() => onChange({ base_filter: { match: 'all', conditions: [{ column: columns[0]?.value ?? '', operator: 'eq', value: '' }] } })} data-testid="dyn-add-filter"><Plus size={11} /> Add a filter</button>}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_4rem] gap-1">
        <div><Label>Sort by</Label><AutocompleteSelect value={sort?.column ?? ''} placeholder="Source order" clearable options={columns} onChange={(v) => onChange({ sort: v ? [{ column: v, direction: sort?.direction ?? 'asc' }] : undefined })} /></div>
        <div><Label>Direction</Label><AutocompleteSelect value={sort?.direction ?? 'asc'} disabled={!sort} options={[{ value: 'asc', label: 'A → Z' }, { value: 'desc', label: 'Z → A' }]} onChange={(v) => sort && onChange({ sort: [{ column: sort.column, direction: v === 'desc' ? 'desc' : 'asc' }] })} /></div>
        <div><Label>Limit</Label><input type="number" min={1} max={DYNAMIC_LIMITS.rows} className={inputClass} value={binding.limit ?? ''} placeholder="auto" onChange={(e) => onChange({ limit: e.target.value ? Math.max(1, Math.min(DYNAMIC_LIMITS.rows, Number(e.target.value))) : undefined }, 'dyn-limit')} /></div>
      </div>
    </>
  )
}

function TableTab({ binding, expects, onChange }: { binding: TableBinding; expects: DynamicValueType; onChange: (next: TableBinding, tag?: string) => void }) {
  const { data: tables = [] } = useQuery({ queryKey: ['forms-table-columns'], staleTime: 60_000, queryFn: async () => (await serverRead('forms.tableColumns')).data ?? [] })
  const table = (tables as any[]).find((t) => t.id === binding.table_id) as { columns?: Array<{ key: string; label: string }> } | undefined
  const available = (table?.columns ?? []).map((c) => ({ value: c.key, label: c.label || c.key }))
  const set = (patch: Partial<TableBinding>, tag?: string) => onChange({ ...binding, ...patch }, tag)
  return (
    <div className="space-y-2" data-testid="dyn-table-tab">
      <div>
        <Label>Data table</Label>
        <AutocompleteSelect value={binding.table_id} placeholder="Choose a table…" options={(tables as any[]).map((t) => ({ value: t.id, label: t.name }))}
          onChange={(v) => onChange({ kind: 'table', table_id: v, ...(binding.expects ? { expects: binding.expects } : {}) })} />
      </div>
      {binding.table_id && (
        <>
          <ShapeEditor expects={expects} value={binding.value} label={binding.label} columns={binding.columns} available={available} onChange={(p) => set(p)} />
          <FilterAndSort binding={binding} columns={[{ value: DATA_TABLE_ROW_ID, label: 'Row id' }, ...available]} onChange={(p, tag) => set(p, tag)} />
          <Toggle checked={binding.open_access === true} onChange={(v) => set({ open_access: v || undefined })}>Open access (people filling in the form read it without the data.view permission)</Toggle>
        </>
      )}
    </div>
  )
}

function ReferenceTab({ binding, expects, onChange }: { binding: ReferenceBinding; expects: DynamicValueType; onChange: (next: ReferenceBinding, tag?: string) => void }) {
  const queryClient = useQueryClient()
  const { data: references = [] } = useQuery({
    queryKey: ['forms-lookup-references'], staleTime: 60_000,
    queryFn: async () => { const { data, error } = await serverRead('integrations.references'); if (error) throw new Error(error.message); return (data ?? []) as any[] },
  })
  const reference = (references as any[]).find((r) => r.id === binding.reference_id)
  const model = reference ? referenceResponseSchema(reference) : null
  const root = runtimeView(model).root
  const rows = validateCollectionPath(root, binding.results_path ?? '')
  const itemFields = collectionItemFields(rows.ok ? rows.itemSchema ?? null : null).filter((f) => !f.container)
  const available = itemFields.map((f) => ({ value: f.path, label: f.path }))
  const inputs: Array<{ name: string; required?: boolean; location?: string }> = Array.isArray(reference?.inputs) ? reference.inputs : []
  const set = (patch: Partial<ReferenceBinding>, tag?: string) => onChange({ ...binding, ...patch }, tag)
  const onSchemaLoaded = (loaded: ResponseSchema) => queryClient.setQueryData(['forms-lookup-references'], (list: any[] | undefined) =>
    (list ?? []).map((r) => (r.id === binding.reference_id ? { ...r, request_config: { ...(r.request_config ?? {}), response_schema: loaded } } : r)))
  return (
    <div className="space-y-2" data-testid="dyn-reference-tab">
      <div>
        <Label>API reference / connector operation (custom references included)</Label>
        <AutocompleteSelect value={binding.reference_id} placeholder="Choose a reference…"
          options={(references as any[]).filter((r) => !isWriteReference(r)).map((r) => ({ value: String(r.id), label: String(r.name), hint: referencePickerHint(r) }))}
          onChange={(v) => { const ref = (references as any[]).find((r) => r.id === v); onChange({ kind: 'reference', reference_id: v, ...(ref?.integration?.id ? { integration_id: String(ref.integration.id) } : {}), ...(binding.expects ? { expects: binding.expects } : {}) }) }} />
      </div>
      {reference && (
        <>
          <div>
            <Label>Inputs</Label>
            {inputs.length === 0 && <p className="text-2xs text-fg-muted">This reference takes no inputs.</p>}
            {inputs.map((input) => (
              <div key={input.name}>
                <p className="font-mono text-2xs">{input.name}{input.required ? ' *' : ''}</p>
                <VariableInput value={binding.input_mappings?.[input.name] ?? ''} placeholder="{{param.x}}, {{var.x}}, {{form.x}}…"
                  onChange={(v) => { const m = { ...(binding.input_mappings ?? {}) }; if (v) m[input.name] = v; else delete m[input.name]; set({ input_mappings: Object.keys(m).length ? m : undefined }, `dyn-in-${input.name}`) }} />
              </div>
            ))}
          </div>
          <ResponseCollectionPicker key={binding.reference_id} schema={model} value={binding.results_path} referenceId={binding.reference_id} inputs={inputs} mappings={binding.input_mappings}
            onChange={(path) => set({ results_path: path || undefined })} onSchemaLoaded={onSchemaLoaded} label="Rows list" testId="dyn-rows-list"
            fields={wantsColumns(expects) ? { selected: (binding.columns ?? []).map((c) => c.key), onAdd: (fs) => set({ columns: [...(binding.columns ?? []), ...fs.map((f) => ({ key: f.path })).filter((c) => !(binding.columns ?? []).some((x) => x.key === c.key))].slice(0, DYNAMIC_LIMITS.columns) }) } : undefined} />
          <ShapeEditor expects={expects} value={binding.value} label={binding.label} columns={binding.columns} available={available} onChange={(p) => set(p)} />
          <FilterAndSort binding={binding} columns={available} onChange={(p, tag) => set(p, tag)} />
        </>
      )}
    </div>
  )
}

/** The resolved value: expressions here, sources through the server (the designer's unsaved field). */
function Preview({ field, prop, expects, binding, layout }: { field: DesignerField; prop: string; expects: DynamicValueType; binding: DynamicBinding; layout: unknown }) {
  // The live preview's values with the parameters' defaults and the variables' initial values filled in.
  const raw = useDesignerPreviewValues()
  const values = useMemo(() => withFormContext(layout, raw ?? {}), [layout, raw])
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; value?: unknown; error?: string; truncated?: boolean }>({ status: 'idle' })
  const clean = normalizeDynamicBinding(binding)
  const local = binding.kind === 'expr' && clean ? coerceDynamicValue(expects, resolveExpression(binding.expr, { values: values ?? {}, now: new Date() })) : null
  async function run() {
    setState({ status: 'loading' })
    try {
      const plain = Object.fromEntries(Object.entries(field).filter(([k]) => !k.startsWith('_')))
      const res = await fetch('/api/internal/forms/dynamic-value', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ field: { ...plain, dynamic: { ...(field.dynamic ?? {}), [prop]: binding } }, prop, values: values ?? {} }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'The preview failed')
      setState({ status: 'done', value: json.value, truncated: json.truncated })
    } catch (e) {
      setState({ status: 'error', error: e instanceof Error ? e.message : 'The preview failed' })
    }
  }
  const shown = local ? (local.ok ? { status: 'done' as const, value: local.value } : { status: 'error' as const, error: local.error }) : state
  return (
    <div className="space-y-1 border-t pt-2 border-border" data-testid="dyn-preview">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-2xs font-semibold text-fg-muted">Preview</span>
        {isSourceBinding(binding) && (
          <button type="button" onClick={() => void run()} disabled={!clean || state.status === 'loading'} className="flex items-center gap-1 rounded border px-2 py-0.5 text-2xs font-medium disabled:opacity-50 border-border text-fg" data-testid="dyn-run-preview">
            {state.status === 'loading' ? <Loader2 size={10} className="animate-spin" aria-hidden /> : <Play size={10} aria-hidden />} Run
          </button>
        )}
      </div>
      {shown.status === 'idle' && <p className="text-2xs text-fg-muted">{isSourceBinding(binding) ? 'Run it with the preview’s values (parameters, variables, fields).' : 'Type an expression.'}</p>}
      {shown.status === 'error' && <p className="text-2xs text-danger" role="alert">{shown.error}</p>}
      {shown.status === 'done' && <PreviewValue expects={expects} value={shown.value} truncated={'truncated' in shown ? shown.truncated : undefined} />}
    </div>
  )
}

function PreviewValue({ expects, value, truncated }: { expects: DynamicValueType; value: unknown; truncated?: boolean }) {
  if (value === undefined || value === null || (Array.isArray(value) && !value.length)) return <p className="text-2xs text-fg-muted">Empty — the static value is used{expects === 'options' ? ' (no options are offered)' : ''}.</p>
  const ok = <span className="rounded px-1 text-2xs font-semibold bg-primary-wash text-primary-text">✓ {DYNAMIC_VALUE_TYPE_LABELS[expects]}</span>
  if (expects === 'options' && Array.isArray(value)) {
    const list = value as Array<{ value: string; label: string }>
    return (
      <div className="space-y-1">
        <p className="text-2xs text-fg-muted">{ok} {list.length} option{list.length === 1 ? '' : 's'}{truncated ? ' (cut at the limit)' : ''}</p>
        <ul className="max-h-32 overflow-auto rounded border text-2xs border-border" data-testid="dyn-preview-options">
          {list.slice(0, 50).map((o) => <li key={o.value} className="flex gap-2 border-b px-2 py-0.5 last:border-b-0 border-border"><span className="flex-1 truncate">{o.label}</span><span className="font-mono text-2xs text-fg-muted">{o.value}</span></li>)}
        </ul>
      </div>
    )
  }
  const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
  return (
    <div className="space-y-1">
      <p className="text-2xs text-fg-muted">{ok}{Array.isArray(value) ? ` ${value.length} item${value.length === 1 ? '' : 's'}` : ''}{truncated ? ' (cut at the limit)' : ''}</p>
      <pre className="max-h-40 overflow-auto rounded border p-1.5 font-mono text-2xs border-border" data-testid="dyn-preview-value">{text.slice(0, 4000)}</pre>
    </div>
  )
}
