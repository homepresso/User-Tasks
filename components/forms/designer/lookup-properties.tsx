'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import { serverRead } from '@/lib/server-read'
import {
  LOOKUP_FILTER_OPERATORS, LOOKUP_FILTER_OPERATOR_LABELS, LOOKUP_LIMITS, LOOKUP_ROW_ID, lookupItemKey,
  type LookupConfig, type LookupFilterOperator,
} from '@/lib/forms/lookup'
import { referenceResponseSchema, type SchemaNode } from '@/lib/response-schema'
import { collectArrayCandidates } from '@/lib/workflow-data-picker'
import type { DesignerField, DesignerState } from '@/lib/forms/designer-state'
import { DISPLAY_FIELD_TYPES } from '@/lib/task-field-schema'

/* eslint-disable @typescript-eslint/no-explicit-any -- reference rows are read as the browser sees them */

const inputClass = 'h-8 w-full rounded-md border px-2 text-xs outline-none focus-visible:ring-2'
const inputStyle: React.CSSProperties = {
  borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)',
  ['--tw-ring-color' as string]: 'var(--theme-primary)',
}

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>{children}</label>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{children}</p>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--theme-surface-border)' }}>
      <legend className="pr-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>{title}</legend>
      {children}
    </fieldset>
  )
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: 'var(--theme-primary)' }} />
      {children}
    </label>
  )
}

/** Ordered multi-pick of columns / item fields: chips with up / down / remove, plus an "add" picker. */
function OrderedPicker({ label, value, options, onChange, testId }: {
  label: string
  value: string[]
  options: Array<{ value: string; label: string; hint?: string }>
  onChange: (next: string[]) => void
  testId?: string
}) {
  const remaining = options.filter((o) => !value.includes(o.value))
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v
  return (
    <div data-testid={testId}>
      <Label>{label}</Label>
      <div className="space-y-1">
        {value.map((v, i) => (
          <div key={v} className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <span className="flex-1 truncate">{labelOf(v)}{i === 0 && value.length > 1 ? <span style={{ color: 'var(--theme-muted-text)' }}> · primary</span> : null}</span>
            <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={i === 0} aria-label={`Move ${labelOf(v)} up`} onClick={() => { const next = [...value]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; onChange(next) }}><ArrowUp size={11} /></button>
            <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={i === value.length - 1} aria-label={`Move ${labelOf(v)} down`} onClick={() => { const next = [...value]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; onChange(next) }}><ArrowDown size={11} /></button>
            <button type="button" className="rounded p-0.5" aria-label={`Remove ${labelOf(v)}`} onClick={() => onChange(value.filter((x) => x !== v))}><X size={11} /></button>
          </div>
        ))}
        {remaining.length > 0 && value.length < LOOKUP_LIMITS.maxColumns && (
          <AutocompleteSelect value="" placeholder="Add…" options={remaining} onChange={(v) => v && onChange([...value, v])} />
        )}
      </div>
    </div>
  )
}

/** Primitive item fields of a model (dotted paths, a few levels deep). */
function itemFieldOptions(schema: SchemaNode | null | undefined, prefix = '', depth = 0): Array<{ value: string; label: string; hint?: string }> {
  if (!schema || schema.type !== 'object' || depth > 3) return []
  const out: Array<{ value: string; label: string; hint?: string }> = []
  for (const field of schema.fields ?? []) {
    const path = prefix ? `${prefix}.${field.name}` : field.name
    if (field.type === 'object') out.push(...itemFieldOptions(field, path, depth + 1))
    else if (field.type !== 'array') out.push({ value: path, label: path, hint: field.example !== undefined && field.example !== null ? String(field.example) : field.type })
  }
  return out
}

export function LookupProperties({ state, field, onPatch }: {
  state: DesignerState
  field: DesignerField
  onPatch: (lookup: LookupConfig, tag?: string) => void
}) {
  const config: LookupConfig = field.lookup ?? { source: 'table' }
  const set = (patch: Partial<LookupConfig>, tag?: string) => onPatch({ ...config, ...patch }, tag)
  const id = (name: string) => `lk-${field._id}-${name}`
  const otherFields = state.fields.filter((f) => f._id !== field._id && !DISPLAY_FIELD_TYPES.has(f.type))
  const placeholders = [
    { name: 'search', group: 'Lookup', label: 'The typed text' },
    ...otherFields.map((f) => ({ name: `task_data.${f.key}`, group: 'This form', label: f.label || f.key })),
  ]

  const { data: tables = [] } = useQuery({
    queryKey: ['forms-table-columns'],
    enabled: config.source === 'table',
    staleTime: 60_000,
    queryFn: async () => (await serverRead('forms.tableColumns')).data ?? [],
  })
  const { data: references = [], error: refError } = useQuery({
    queryKey: ['forms-lookup-references'],
    enabled: config.source === 'reference',
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await serverRead('integrations.references')
      if (error) throw new Error(error.message)
      return (data ?? []) as any[]
    },
  })

  const table = tables.find((t: { id: string }) => t.id === config.table_id) as { id: string; name: string; columns: Array<{ key: string; label: string }> } | undefined
  const columnOptions = (table?.columns ?? []).map((c) => ({ value: c.key, label: c.label || c.key, hint: c.key }))
  const valueOptions = [{ value: LOOKUP_ROW_ID, label: 'Row id (default)' }, ...columnOptions]

  const integrations = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of references) if (r.integration?.id) map.set(String(r.integration.id), String(r.integration.name ?? r.integration.id))
    return [...map].map(([value, label]) => ({ value, label }))
  }, [references])
  const reference = references.find((r: any) => r.id === config.reference_id)
  const refOptions = references
    .filter((r: any) => !config.integration_id || String(r.integration?.id ?? r.integration_id) === config.integration_id)
    .map((r: any) => ({ value: String(r.id), label: String(r.name), hint: r.integration?.name }))
  const model = reference ? referenceResponseSchema(reference) : null
  const candidates = model?.root
    ? collectArrayCandidates([{ id: 'ref', label: 'Response', kind: 'step', roots: [{ path: 'response', label: 'response', schema: model.root }] }]).filter((c) => !c.path.includes('[]'))
    : []
  const resultsPath = config.results_path ?? ''
  const chosen = candidates.find((c) => c.path === (resultsPath ? `response.${resultsPath}` : 'response'))
  const itemOptions = itemFieldOptions(chosen?.itemSchema ?? null)
  const refInputs: Array<{ name: string; label?: string; required?: boolean; location?: string }> = Array.isArray(reference?.inputs) ? reference.inputs : []

  const fill = config.fill ?? []
  const fillSources = config.source === 'table' ? [{ value: LOOKUP_ROW_ID, label: 'Row id' }, ...columnOptions] : itemOptions

  return (
    <div className="space-y-3" data-testid="lookup-properties">
      <Section title="Suggestions from">
        <div className="flex gap-1" role="radiogroup" aria-label="Lookup source">
          {(['table', 'reference'] as const).map((src) => (
            <button key={src} type="button" role="radio" aria-checked={config.source === src}
              onClick={() => src !== config.source && onPatch({ source: src, multiple: config.multiple, allow_free_text: config.allow_free_text, max_results: config.max_results, min_chars: config.min_chars })}
              className="h-7 flex-1 rounded border text-[10px] font-medium"
              style={config.source === src
                ? { backgroundColor: 'var(--theme-primary)', borderColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }
                : { borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
              data-lookup-source={src}
            >
              {src === 'table' ? 'Data table' : 'API reference'}
            </button>
          ))}
        </div>

        {config.source === 'table' ? (
          <>
            <div>
              <Label>Data table</Label>
              <AutocompleteSelect
                value={config.table_id ?? ''}
                placeholder="Choose a table…"
                options={tables.map((t: { id: string; name: string }) => ({ value: t.id, label: t.name }))}
                onChange={(value) => {
                  const next = tables.find((t: { id: string }) => t.id === value) as typeof table
                  const first = next?.columns?.find((c) => c.key !== 'id')?.key ?? next?.columns?.[0]?.key
                  onPatch({ source: 'table', table_id: value || undefined, search_columns: first ? [first] : undefined, display_columns: first ? [first] : undefined, multiple: config.multiple, allow_free_text: config.allow_free_text })
                }}
              />
            </div>
            {table && (
              <>
                <OrderedPicker testId="lookup-search-columns" label="Search in columns" value={config.search_columns ?? []} options={columnOptions} onChange={(v) => set({ search_columns: v.length ? v : undefined })} />
                <div>
                  <Label>Match</Label>
                  <AutocompleteSelect value={config.match ?? 'contains'} options={[{ value: 'contains', label: 'Contains the text' }, { value: 'prefix', label: 'Starts with the text' }]} onChange={(v) => set({ match: v === 'prefix' ? 'prefix' : undefined })} />
                </div>
                <OrderedPicker testId="lookup-display-columns" label="Show columns (first = main text, others = second line)" value={config.display_columns ?? []} options={columnOptions} onChange={(v) => set({ display_columns: v.length ? v : undefined })} />
                <div>
                  <Label>Store as the value</Label>
                  <AutocompleteSelect value={config.value_column ?? LOOKUP_ROW_ID} options={valueOptions} onChange={(v) => set({ value_column: v && v !== LOOKUP_ROW_ID ? v : undefined })} />
                </div>
                <div>
                  <Label>Only rows where</Label>
                  <div className="space-y-1">
                    {(config.filters ?? []).map((f, i) => (
                      <div key={i} className="space-y-1 rounded border p-1.5" style={{ borderColor: 'var(--theme-surface-border)' }}>
                        <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
                          <AutocompleteSelect value={f.column} options={columnOptions} onChange={(v) => set({ filters: (config.filters ?? []).map((x, j) => (j === i ? { ...x, column: v } : x)) })} />
                          <AutocompleteSelect value={f.operator} options={LOOKUP_FILTER_OPERATORS.map((op) => ({ value: op, label: LOOKUP_FILTER_OPERATOR_LABELS[op] }))}
                            onChange={(v) => set({ filters: (config.filters ?? []).map((x, j) => (j === i ? { column: x.column, operator: (v || 'eq') as LookupFilterOperator, ...(v === 'is_set' || v === 'is_not_set' ? {} : { value: x.value ?? '' }) } : x)) })} />
                          <button type="button" className="rounded p-0.5" aria-label={`Remove filter ${i + 1}`} onClick={() => set({ filters: (config.filters ?? []).filter((_, j) => j !== i) })}><X size={11} /></button>
                        </div>
                        {f.operator !== 'is_set' && f.operator !== 'is_not_set' && (
                          <VariableInput value={f.value ?? ''} extraVariables={placeholders} placeholder="Value — {{task_data.<field>}} allowed"
                            onChange={(v) => set({ filters: (config.filters ?? []).map((x, j) => (j === i ? { ...x, value: v } : x)) }, `lkf-${field._id}-${i}`)} />
                        )}
                      </div>
                    ))}
                    {(config.filters ?? []).length < LOOKUP_LIMITS.maxFilters && columnOptions.length > 0 && (
                      <button type="button" className="flex items-center gap-1 text-[10px] font-medium" style={{ color: 'var(--theme-primary-text)' }}
                        onClick={() => set({ filters: [...(config.filters ?? []), { column: columnOptions[0].value, operator: 'eq', value: '' }] })}>
                        <Plus size={11} /> Add filter
                      </button>
                    )}
                  </div>
                  <Hint>Fixed by the designer — the assignee can&apos;t change them. Values can use other fields of this form or workflow variables.</Hint>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-1">
                  <div>
                    <Label>Sort by</Label>
                    <AutocompleteSelect value={config.sort?.column ?? ''} placeholder="Table order" clearable options={columnOptions} onChange={(v) => set({ sort: v ? { column: v, direction: config.sort?.direction ?? 'asc' } : undefined })} />
                  </div>
                  <div>
                    <Label>Order</Label>
                    <AutocompleteSelect value={config.sort?.direction ?? 'asc'} disabled={!config.sort} options={[{ value: 'asc', label: 'A→Z' }, { value: 'desc', label: 'Z→A' }]} onChange={(v) => config.sort && set({ sort: { ...config.sort, direction: v === 'desc' ? 'desc' : 'asc' } })} />
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {refError && <Hint>{(refError as Error).message}</Hint>}
            <div>
              <Label>Integration</Label>
              <AutocompleteSelect value={config.integration_id ?? ''} placeholder="Any integration" clearable options={integrations} onChange={(v) => set({ integration_id: v || undefined, reference_id: undefined, input_mappings: undefined, results_path: undefined, display_fields: undefined, value_field: undefined })} />
            </div>
            <div>
              <Label>Reference</Label>
              <AutocompleteSelect
                value={config.reference_id ?? ''}
                placeholder="Choose a reference…"
                options={refOptions}
                onChange={(v) => {
                  const ref = references.find((r: any) => r.id === v)
                  const firstInput = Array.isArray(ref?.inputs) ? ref.inputs.find((i: any) => i?.name)?.name : undefined
                  onPatch({
                    source: 'reference', reference_id: v || undefined,
                    integration_id: ref?.integration?.id ? String(ref.integration.id) : config.integration_id,
                    input_mappings: firstInput ? { [firstInput]: '{{search}}' } : undefined,
                    multiple: config.multiple, allow_free_text: config.allow_free_text,
                  })
                }}
              />
            </div>
            {reference && (
              <>
                <div>
                  <Label>Inputs</Label>
                  {refInputs.length === 0 && <Hint>This reference takes no inputs.</Hint>}
                  <div className="space-y-1">
                    {refInputs.map((input) => (
                      <div key={input.name}>
                        <p className="text-[10px] font-mono" style={{ color: 'var(--theme-card-text)' }}>{input.name}{input.required ? ' *' : ''}{input.location ? <span style={{ color: 'var(--theme-muted-text)' }}> · {input.location}</span> : null}</p>
                        <VariableInput value={config.input_mappings?.[input.name] ?? ''} extraVariables={placeholders} placeholder="{{search}}, {{task_data.<field>}} or a fixed value"
                          onChange={(v) => {
                            const mappings = { ...(config.input_mappings ?? {}) }
                            if (v) mappings[input.name] = v
                            else delete mappings[input.name]
                            set({ input_mappings: Object.keys(mappings).length ? mappings : undefined }, `lki-${field._id}-${input.name}`)
                          }} />
                      </div>
                    ))}
                  </div>
                  <Hint>{'{{search}}'} is what the assignee types.</Hint>
                </div>
                <div>
                  <Label>Results list (from the response model)</Label>
                  {candidates.length === 0 ? (
                    <Hint>The reference has no response model yet — test it on its integration page to capture one.</Hint>
                  ) : (
                    <div role="radiogroup" aria-label="Results list" className="max-h-40 space-y-1 overflow-y-auto" data-testid="lookup-results-path">
                      {candidates.map((c) => {
                        const path = c.path === 'response' ? '' : c.path.replace(/^response\./, '')
                        const on = (chosen?.path ?? null) === c.path
                        return (
                          <button key={c.path} type="button" role="radio" aria-checked={on}
                            onClick={() => set({ results_path: path || undefined, display_fields: undefined, value_field: undefined, fill: undefined })}
                            className="block w-full rounded border px-2 py-1 text-left text-[11px]"
                            style={on ? { borderColor: 'var(--theme-primary)', backgroundColor: 'var(--theme-primary-light)' } : { borderColor: 'var(--theme-surface-border)' }}
                            data-results-path={path}
                          >
                            <span className="font-mono">{c.path.replace(/^response\.?/, '') || '(the whole response)'}</span>
                            <span className="block text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{c.hint}{c.preview ? ` · ${c.preview}` : ''}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                {chosen && (
                  <>
                    <OrderedPicker testId="lookup-display-fields" label="Show fields (first = main text)" value={config.display_fields ?? []} options={itemOptions} onChange={(v) => set({ display_fields: v.length ? v : undefined })} />
                    <div>
                      <Label>Store as the value</Label>
                      <AutocompleteSelect value={config.value_field ?? ''} placeholder="Choose a field…" options={itemOptions} onChange={(v) => set({ value_field: v || undefined })} />
                    </div>
                  </>
                )}
                <div className="grid grid-cols-2 gap-1">
                  <div>
                    <Label htmlFor={id('debounce')}>Wait after typing (ms)</Label>
                    <input id={id('debounce')} type="number" min={0} max={LOOKUP_LIMITS.maxDebounceMs} className={inputClass} style={inputStyle} value={config.debounce_ms ?? LOOKUP_LIMITS.defaultDebounceMs}
                      onChange={(e) => set({ debounce_ms: e.target.value === '' ? undefined : Number(e.target.value) }, `lkd-${field._id}`)} />
                  </div>
                  <div>
                    <Label htmlFor={id('ttl')}>Cache responses (s)</Label>
                    <input id={id('ttl')} type="number" min={0} max={LOOKUP_LIMITS.maxCacheTtlS} className={inputClass} style={inputStyle} value={config.cache_ttl_s ?? 0}
                      onChange={(e) => set({ cache_ttl_s: Number(e.target.value) || undefined }, `lkt-${field._id}`)} />
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </Section>

      <Section title="Behaviour">
        <div className="grid grid-cols-2 gap-1">
          <div>
            <Label htmlFor={id('max')}>Max suggestions</Label>
            <input id={id('max')} type="number" min={1} max={LOOKUP_LIMITS.maxResults} className={inputClass} style={inputStyle} value={config.max_results ?? LOOKUP_LIMITS.defaultMaxResults}
              onChange={(e) => set({ max_results: e.target.value === '' ? undefined : Number(e.target.value) }, `lkm-${field._id}`)} />
          </div>
          <div>
            <Label htmlFor={id('min')}>Min characters</Label>
            <input id={id('min')} type="number" min={0} max={LOOKUP_LIMITS.maxMinChars} className={inputClass} style={inputStyle} value={config.min_chars ?? LOOKUP_LIMITS.defaultMinChars}
              onChange={(e) => set({ min_chars: e.target.value === '' ? undefined : Number(e.target.value) }, `lkc-${field._id}`)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Toggle checked={config.multiple === true} onChange={(v) => set({ multiple: v || undefined })}>Allow several</Toggle>
          <Toggle checked={config.allow_free_text === true} onChange={(v) => set({ allow_free_text: v || undefined })}>Allow free text</Toggle>
        </div>
        <Hint>
          Without free text the value must be one of the suggestions — checked again on the server when the task is completed.
          Downstream: <code style={{ color: 'var(--theme-primary-text)' }}>{`{{task_data.${field.key}}}`}</code> and <code style={{ color: 'var(--theme-primary-text)' }}>{`{{task_data.${lookupItemKey(field.key)}}}`}</code>.
        </Hint>
      </Section>

      <Section title="Fill other fields">
        <div className="space-y-1" data-testid="lookup-fill">
          {fill.map((f, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-1">
              <AutocompleteSelect value={f.from} options={fillSources} placeholder="Item field" onChange={(v) => set({ fill: fill.map((x, j) => (j === i ? { ...x, from: v } : x)) })} />
              <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>→</span>
              <AutocompleteSelect value={f.to} options={otherFields.filter((o) => o.type !== 'lookup').map((o) => ({ value: o.key, label: o.label || o.key }))} placeholder="Field" onChange={(v) => set({ fill: fill.map((x, j) => (j === i ? { ...x, to: v } : x)) })} />
              <button type="button" className="rounded p-0.5" aria-label={`Remove fill ${i + 1}`} onClick={() => set({ fill: fill.filter((_, j) => j !== i) })}><X size={11} /></button>
            </div>
          ))}
          {fillSources.length > 0 && otherFields.length > 0 && fill.length < LOOKUP_LIMITS.maxFill && (
            <button type="button" className="flex items-center gap-1 text-[10px] font-medium" style={{ color: 'var(--theme-primary-text)' }}
              onClick={() => set({ fill: [...fill, { from: fillSources[0].value, to: '' }] })}>
              <Plus size={11} /> Add mapping
            </button>
          )}
        </div>
        <Hint>When the assignee picks an item, these fields are filled from it (they can still edit them).</Hint>
      </Section>
    </div>
  )
}
