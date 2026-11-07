'use client'

import { isWriteReference, referencePickerHint } from '@/lib/custom-references/types'
import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import { serverRead } from '@/lib/server-read'
import {
  LOOKUP_FILTER_OPERATORS, LOOKUP_FILTER_OPERATOR_LABELS, LOOKUP_LIMITS, LOOKUP_ROW_ID, lookupItemKey,
  type LookupConfig, type LookupFilterOperator,
} from '@/lib/forms/lookup'
import { referenceResponseSchema, type ResponseSchema, type SchemaNode } from '@/lib/response-schema'
import { collectionItemFields, runtimeView, validateCollectionPath } from '@/lib/response-collections'
import { ResponseCollectionPicker } from '@/components/integrations/response-collection-picker'
import type { DesignerField, DesignerState } from '@/lib/forms/designer-state'
import { DISPLAY_FIELD_TYPES } from '@/lib/task-field-schema'
import { contextVariableOptions } from '@/lib/forms/form-params'
import { controlVariables, ruleVariableOptions } from '@/lib/forms/rule-variables'
import { DesignerVariableScope } from './designer-variable-scope'
import { designerInputClass as inputClass } from './designer-controls'
import { cn } from '@/lib/utils'

/* eslint-disable @typescript-eslint/no-explicit-any -- reference rows are read as the browser sees them */


function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-2xs text-fg-muted">{children}</p>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2 border-t pt-3 border-border">
      <legend className="pr-2 text-2xs font-semibold text-fg-muted">{title}</legend>
      {children}
    </fieldset>
  )
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-2xs">
      <input className="accent-primary" type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
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
          <div key={v} className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs border-border">
            <span className="flex-1 truncate">{labelOf(v)}{i === 0 && value.length > 1 ? <span className="text-fg-muted"> · primary</span> : null}</span>
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

/** Item fields of a model (dotted paths, up to 3 levels deep). */
function itemFieldOptions(schema: SchemaNode | null | undefined): Array<{ value: string; label: string; hint?: string }> {
  return collectionItemFields(schema)
    .filter((f) => !f.container && f.type !== 'array' && f.type !== 'object')
    .map((f) => ({ value: f.path, label: f.path, hint: f.example !== undefined && f.example !== null ? String(f.example) : f.type }))
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
    ...contextVariableOptions(state.layout),
    // {{control.<key>.*}}: other controls' state (a query sends it; the server keeps declared columns only).
    ...ruleVariableOptions(controlVariables(state.fields.filter((f) => f._id !== field._id) as never)),
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
    // Lookups read: write references are refused at run time, so they are not offered.
    .filter((r: any) => !isWriteReference(r) || r.id === config.reference_id)
    .map((r: any) => ({ value: String(r.id), label: String(r.name), hint: referencePickerHint(r) }))
  const model = reference ? referenceResponseSchema(reference) : null
  const resultsCheck = validateCollectionPath(runtimeView(model).root, config.results_path ?? '')
  const chosen = resultsCheck.ok && resultsCheck.itemSchema ? resultsCheck : null
  const itemOptions = itemFieldOptions(chosen?.itemSchema ?? null)
  const refInputs: Array<{ name: string; label?: string; required?: boolean; location?: string; default_value?: unknown }> = Array.isArray(reference?.inputs) ? reference.inputs : []
  const queryClient = useQueryClient()
  const onSchemaLoaded = (loaded: ResponseSchema) => queryClient.setQueryData(['forms-lookup-references'], (rows: any[] | undefined) =>
    (rows ?? []).map((r) => (r.id === config.reference_id ? { ...r, request_config: { ...(r.request_config ?? {}), response_schema: loaded } } : r)))

  const fill = config.fill ?? []
  const fillSources = config.source === 'table' ? [{ value: LOOKUP_ROW_ID, label: 'Row id' }, ...columnOptions] : itemOptions

  return (
    <DesignerVariableScope state={state} context={{ kind: 'lookup_query', exclude: field.key }}>
    <div className="space-y-3" data-testid="lookup-properties">
      <Section title="Suggestions from">
        <div className="flex gap-1" role="radiogroup" aria-label="Lookup source">
          {(['table', 'reference'] as const).map((src) => (
            <button key={src} type="button" role="radio" aria-checked={config.source === src}
              onClick={() => src !== config.source && onPatch({ source: src, multiple: config.multiple, allow_free_text: config.allow_free_text, max_results: config.max_results, min_chars: config.min_chars })}
              className={cn('h-7 flex-1 rounded border text-2xs font-medium', config.source === src ? 'border-primary' : 'border-border', config.source === src ? 'bg-primary-wash' : '', config.source === src ? 'text-primary-text' : 'text-fg')}
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
                      <div key={i} className="space-y-1 rounded border p-1.5 border-border">
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
                      <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text"
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
                        <p className="text-2xs font-mono text-fg">{input.name}{input.required ? ' *' : ''}{input.location ? <span className="text-fg-muted"> · {input.location}</span> : null}</p>
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
                <ResponseCollectionPicker
                  key={config.reference_id}
                  schema={model}
                  value={config.results_path}
                  onChange={(path, { auto }) => set(auto ? { results_path: path || undefined } : { results_path: path || undefined, display_fields: undefined, value_field: undefined, fill: undefined })}
                  referenceId={config.reference_id}
                  inputs={refInputs}
                  mappings={config.input_mappings}
                  onSchemaLoaded={onSchemaLoaded}
                  label="Results list"
                  testId="lookup-results-path"
                />
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
                    <input id={id('debounce')} type="number" min={0} max={LOOKUP_LIMITS.maxDebounceMs} className={inputClass} value={config.debounce_ms ?? LOOKUP_LIMITS.defaultDebounceMs}
                      onChange={(e) => set({ debounce_ms: e.target.value === '' ? undefined : Number(e.target.value) }, `lkd-${field._id}`)} />
                  </div>
                  <div>
                    <Label htmlFor={id('ttl')}>Cache responses (s)</Label>
                    <input id={id('ttl')} type="number" min={0} max={LOOKUP_LIMITS.maxCacheTtlS} className={inputClass} value={config.cache_ttl_s ?? 0}
                      onChange={(e) => set({ cache_ttl_s: Number(e.target.value) || undefined }, `lkt-${field._id}`)} />
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </Section>

      <Section title="Display">
        <div>
          <Label htmlFor={id('label-template')}>Display template (optional)</Label>
          <input id={id('label-template')} className={inputClass} value={config.label_template ?? ''} placeholder={config.source === 'table' ? '{{name}} ({{code}})' : '{{name}} ({{id}})'}
            onChange={(e) => set({ label_template: e.target.value || undefined }, `lklt-${field._id}`)} data-testid="lookup-label-template" />
          <Hint>What people see in the input, in read-only views and submissions. Empty: the first shown {config.source === 'table' ? 'column' : 'field'}. The stored value stays the &quot;Store as the value&quot; {config.source === 'table' ? 'column' : 'field'}.</Hint>
        </div>
        <div>
          <Label htmlFor={id('desc-template')}>Secondary text in the list (optional)</Label>
          <input id={id('desc-template')} className={inputClass} value={config.description_template ?? ''} placeholder="{{city}}, {{country}}"
            onChange={(e) => set({ description_template: e.target.value || undefined }, `lkdt-${field._id}`)} data-testid="lookup-description-template" />
        </div>
        <Toggle checked={config.search_value === true} onChange={(v) => set({ search_value: v || undefined })}>Search also matches the stored value</Toggle>
      </Section>

      <Section title="Behaviour">
        <div className="grid grid-cols-2 gap-1">
          <div>
            <Label htmlFor={id('max')}>Max suggestions</Label>
            <input id={id('max')} type="number" min={1} max={LOOKUP_LIMITS.maxResults} className={inputClass} value={config.max_results ?? LOOKUP_LIMITS.defaultMaxResults}
              onChange={(e) => set({ max_results: e.target.value === '' ? undefined : Number(e.target.value) }, `lkm-${field._id}`)} />
          </div>
          <div>
            <Label htmlFor={id('min')}>Min characters</Label>
            <input id={id('min')} type="number" min={0} max={LOOKUP_LIMITS.maxMinChars} className={inputClass} value={config.min_chars ?? LOOKUP_LIMITS.defaultMinChars}
              onChange={(e) => set({ min_chars: e.target.value === '' ? undefined : Number(e.target.value) }, `lkc-${field._id}`)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Toggle checked={config.multiple === true} onChange={(v) => set({ multiple: v || undefined })}>Allow several</Toggle>
          <Toggle checked={config.allow_free_text === true} onChange={(v) => set({ allow_free_text: v || undefined })}>Allow free text</Toggle>
          <Toggle checked={config.anonymous_read === true} onChange={(v) => set({ anonymous_read: v || undefined })}>Allow anonymous read</Toggle>
        </div>
        <Hint>
          Anonymous read: on a public form link, visitors who aren&apos;t signed in get suggestions from this lookup (off: nothing).
          {config.anonymous_read === true && <span className="text-danger"> Anyone with the link can search this source&apos;s shown columns / fields (at most 20 results a search).</span>}
        </Hint>
        <Hint>
          Without free text the value must be one of the suggestions — checked again on the server when the task is completed.
          Downstream: <code className="text-primary-text">{`{{task_data.${field.key}}}`}</code> (the value), <code className="text-primary-text">{`{{task_data.${field.key}_label}}`}</code> (what was shown) and <code className="text-primary-text">{`{{task_data.${lookupItemKey(field.key)}}}`}</code>.
        </Hint>
      </Section>

      <Section title="Fill other fields">
        <div className="space-y-1" data-testid="lookup-fill">
          {fill.map((f, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-1">
              <AutocompleteSelect value={f.from} options={fillSources} placeholder="Item field" onChange={(v) => set({ fill: fill.map((x, j) => (j === i ? { ...x, from: v } : x)) })} />
              <span className="text-2xs text-fg-muted">→</span>
              <AutocompleteSelect value={f.to} options={otherFields.filter((o) => o.type !== 'lookup').map((o) => ({ value: o.key, label: o.label || o.key }))} placeholder="Field" onChange={(v) => set({ fill: fill.map((x, j) => (j === i ? { ...x, to: v } : x)) })} />
              <button type="button" className="rounded p-0.5" aria-label={`Remove fill ${i + 1}`} onClick={() => set({ fill: fill.filter((_, j) => j !== i) })}><X size={11} /></button>
            </div>
          ))}
          {fillSources.length > 0 && otherFields.length > 0 && fill.length < LOOKUP_LIMITS.maxFill && (
            <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text"
              onClick={() => set({ fill: [...fill, { from: fillSources[0].value, to: '' }] })}>
              <Plus size={11} /> Add mapping
            </button>
          )}
        </div>
        <Hint>When the assignee picks an item, these fields are filled from it (they can still edit them).</Hint>
      </Section>
    </div>
    </DesignerVariableScope>
  )
}
