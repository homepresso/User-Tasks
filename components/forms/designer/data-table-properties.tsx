'use client'

import { LIST_PENDING_MODES, LIST_PENDING_MODE_LABELS } from '@/lib/forms/list-field'
import { RowCommitKitPanel } from './list-properties'
import { isWriteReference, referencePickerHint } from '@/lib/custom-references/types'
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, EyeOff, Loader2, Play, Plus, X } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import { serverRead } from '@/lib/server-read'
import {
  DATA_TABLE_COLUMN_TYPES, DATA_TABLE_COLUMN_TYPE_LABELS, DATA_TABLE_LIMITS, DATA_TABLE_MODES, DATA_TABLE_MODE_LABELS, DATA_TABLE_OPERATORS,
  DATA_TABLE_OPERATOR_LABELS, DATA_TABLE_ROW_ID, columnFormat, defaultColumnFormat, formatCell, isConditionGroup, remoteCapabilities,
  type DataTableColumn, type DataTableColumnType, type DataTableCondition, type DataTableConditionGroup, type DataTableFieldConfig, type DataTableOperator,
  type DataTableRow,
} from '@/lib/forms/data-table'
import {
  BADGE_COLORS, CELL_FORMAT_KINDS, CELL_FORMAT_LABELS, defaultFormatKind, normalizeCellFormat, type BadgeColor, type CellFormat, type CellFormatKind,
} from '@/lib/formatting/cell-format'
import { referenceResponseSchema, type ResponseSchema } from '@/lib/response-schema'
import { collectionItemFields, pagingHints, runtimeView, validateCollectionPath, type CollectionField } from '@/lib/response-collections'
import { ResponseCollectionPicker } from '@/components/integrations/response-collection-picker'
import type { DesignerField, DesignerState } from '@/lib/forms/designer-state'
import { DISPLAY_FIELD_TYPES } from '@/lib/task-field-schema'
import { FormattedCellView } from '../data-table-cell'
import { useDesignerPreviewValues } from './designer-preview-context'
import { contextVariableOptions } from '@/lib/forms/form-params'
import { controlVariables, ruleVariableOptions } from '@/lib/forms/rule-variables'
import { DesignerVariableScope } from './designer-variable-scope'
import { cn } from '@/lib/utils'
import { designerInputClass as inputClass } from './designer-controls'

/* eslint-disable @typescript-eslint/no-explicit-any -- tables / references are read as the browser sees them */


function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-2xs text-fg-muted">{children}</p>
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-2 border-t pt-3 border-border">
      <legend className="pr-2 text-2xs font-semibold text-fg-muted">{title}</legend>
      {children}
    </fieldset>
  )
}
function Toggle({ checked, onChange, children, testId }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; testId?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-2xs" data-testid={testId}>
      <input className="accent-primary" type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}
function Radio<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cn('h-7 flex-1 rounded border px-1 text-2xs font-medium', value === v ? 'bg-primary' : '', value === v ? 'border-primary' : 'border-border', value === v ? 'text-primary-fg' : 'text-fg')} data-radio={v}>{l}</button>
      ))}
    </div>
  )
}

/** Table column type → the field's column type. */
const FROM_TABLE_TYPE: Record<string, DataTableColumnType> = { number: 'number', boolean: 'boolean', date: 'date', datetime: 'datetime', select: 'choice' }

/** A column type for an API item field (its format comes from suggestFieldFormat). */
export function columnTypeForField(field: Pick<CollectionField, 'type' | 'format'>): DataTableColumnType {
  if (field.type === 'number' || field.type === 'integer') return 'number'
  if (field.type === 'boolean') return 'boolean'
  return field.format === 'date' ? 'date' : field.format === 'datetime' ? 'datetime' : 'text'
}

/* ── Column format editor ────────────────────────────────────────────── */

export function FormatEditor({ col, onChange, hideKind }: {
  col: DataTableColumn
  onChange: (format: CellFormat | undefined, tag?: string) => void
  /** The caller picks the kind and alignment itself (a Label's Display section): only the kind's own settings. */
  hideKind?: boolean
}) {
  const f = columnFormat(col)
  const set = (patch: Partial<CellFormat>, tag?: string) => onChange(normalizeCellFormat({ ...f, ...patch }, f.kind), tag)
  const sample = col.type === 'number' ? -1234.5 : col.type === 'date' ? '2026-10-31' : col.type === 'datetime' ? '2026-10-31T14:05:00Z' : col.type === 'boolean' ? true : col.options?.[0] ?? 'Sample text'
  const preview = formatCell({ ...col, format: f }, sample)
  return (
    <div className="space-y-1.5 rounded border p-1.5 border-border" data-testid={`dt-format-${col.key}`}>
      {!hideKind && <div className="grid grid-cols-[1fr_auto] gap-1">
        <div>
          <Label>Display format</Label>
          <AutocompleteSelect value={f.kind} options={CELL_FORMAT_KINDS.map((k) => ({ value: k, label: CELL_FORMAT_LABELS[k] }))}
            onChange={(v) => onChange(v === defaultColumnFormat(col.type) ? undefined : normalizeCellFormat({ kind: v as CellFormatKind, align: f.align }))} />
        </div>
        <div className="w-24">
          <Label>Align</Label>
          <AutocompleteSelect value={f.align ?? ''} placeholder="Auto" clearable options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]}
            onChange={(v) => set({ align: (v || undefined) as CellFormat['align'] })} />
        </div>
      </div>}
      {f.kind === 'text' && (
        <div className="grid grid-cols-2 items-end gap-1">
          <div><Label>Max length</Label><input type="number" min={1} className={inputClass} value={f.max_length ?? ''} onChange={(e) => set({ max_length: e.target.value ? Number(e.target.value) : undefined }, 'fmt-len')} /></div>
          <Toggle checked={f.wrap === true} onChange={(v) => set({ wrap: v || undefined })}>Wrap</Toggle>
        </div>
      )}
      {(f.kind === 'number' || f.kind === 'percent' || f.kind === 'currency' || f.kind === 'integer') && (
        <div className="grid grid-cols-2 gap-1">
          {f.kind !== 'integer' && <div><Label>Decimals</Label><input type="number" min={0} max={10} className={inputClass} value={f.decimals ?? ''} placeholder="auto" onChange={(e) => set({ decimals: e.target.value === '' ? undefined : Number(e.target.value) }, 'fmt-dec')} /></div>}
          <div><Label>Negatives</Label><AutocompleteSelect value={f.negative ?? 'minus'} options={[{ value: 'minus', label: '-1,234' }, { value: 'parentheses', label: '(1,234)' }, { value: 'red', label: 'Red' }]} onChange={(v) => set({ negative: v === 'minus' ? undefined : v as CellFormat['negative'] })} /></div>
          <Toggle checked={f.thousands !== false} onChange={(v) => set({ thousands: v ? undefined : false })}>Thousands separator</Toggle>
          {f.kind === 'percent' && <div><Label>Stored as</Label><AutocompleteSelect value={f.percent_source ?? 'whole'} options={[{ value: 'whole', label: '0–100' }, { value: 'fraction', label: '0–1' }]} onChange={(v) => set({ percent_source: v === 'fraction' ? 'fraction' : undefined })} /></div>}
          {f.kind === 'currency' && (
            <>
              <div><Label>Currency</Label><input className={`${inputClass} font-mono`} maxLength={3} value={f.currency ?? 'USD'} onChange={(e) => set({ currency: e.target.value.toUpperCase() }, 'fmt-cur')} /></div>
              <div><Label>Show</Label><AutocompleteSelect value={f.currency_display ?? 'symbol'} options={[{ value: 'symbol', label: 'Symbol ($)' }, { value: 'code', label: 'Code (USD)' }]} onChange={(v) => set({ currency_display: v === 'code' ? 'code' : undefined })} /></div>
            </>
          )}
        </div>
      )}
      {(f.kind === 'date' || f.kind === 'datetime' || f.kind === 'time') && (
        <div className="grid grid-cols-2 gap-1">
          <div><Label>Style</Label><AutocompleteSelect value={f.style ?? 'medium'} options={[{ value: 'short', label: 'Short' }, { value: 'medium', label: 'Medium' }, { value: 'long', label: 'Long' }, { value: 'iso', label: 'ISO' }, { value: 'custom', label: 'Custom pattern' }]} onChange={(v) => set({ style: v === 'medium' ? undefined : v as CellFormat['style'], pattern: v === 'custom' ? (f.pattern ?? 'dd MMM yyyy') : undefined })} /></div>
          <div><Label>Time zone</Label><input className={inputClass} placeholder="Viewer's" value={f.time_zone ?? ''} onChange={(e) => onChange({ ...f, time_zone: e.target.value || undefined }, 'fmt-tz')} /></div>
          {f.style === 'custom' && <div className="col-span-2"><Label>Pattern (yyyy MM dd HH mm ss, MMM, EEE, a)</Label><input className={`${inputClass} font-mono`} value={f.pattern ?? ''} onChange={(e) => onChange({ ...f, pattern: e.target.value }, 'fmt-pat')} /></div>}
        </div>
      )}
      {f.kind === 'boolean' && (
        <div className="grid grid-cols-3 gap-1">
          <div className="col-span-3"><AutocompleteSelect value={f.boolean_style ?? 'yes_no'} options={[{ value: 'yes_no', label: 'Yes / No' }, { value: 'check', label: '✓ / ✗' }, { value: 'custom', label: 'Custom labels' }]} onChange={(v) => set({ boolean_style: v === 'yes_no' ? undefined : v as CellFormat['boolean_style'] })} /></div>
          {f.boolean_style === 'custom' && <>
            <input aria-label="Label for yes" className={inputClass} value={f.true_label ?? ''} onChange={(e) => onChange({ ...f, true_label: e.target.value }, 'fmt-t')} />
            <input aria-label="Label for no" className={inputClass} value={f.false_label ?? ''} onChange={(e) => onChange({ ...f, false_label: e.target.value }, 'fmt-f')} />
          </>}
        </div>
      )}
      {f.kind === 'badge' && (
        <div className="space-y-1">
          {(f.badges ?? []).map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_5rem_auto] gap-1">
              <input aria-label={`Badge ${i + 1} value`} className={inputClass} value={b.value} placeholder="value" onChange={(e) => onChange({ ...f, badges: (f.badges ?? []).map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) }, `fmt-b-${i}`)} />
              <input aria-label={`Badge ${i + 1} label`} className={inputClass} value={b.label ?? ''} placeholder="label" onChange={(e) => onChange({ ...f, badges: (f.badges ?? []).map((x, j) => (j === i ? { ...x, label: e.target.value || undefined } : x)) }, `fmt-bl-${i}`)} />
              <AutocompleteSelect value={b.color} options={BADGE_COLORS.map((c) => ({ value: c, label: c }))} onChange={(v) => set({ badges: (f.badges ?? []).map((x, j) => (j === i ? { ...x, color: (v || 'gray') as BadgeColor } : x)) })} />
              <button type="button" className="rounded p-0.5" aria-label={`Remove badge ${i + 1}`} onClick={() => set({ badges: (f.badges ?? []).filter((_, j) => j !== i) })}><X size={11} /></button>
            </div>
          ))}
          <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text"
            onClick={() => set({ badges: [...(f.badges ?? []), { value: col.options?.find((o) => !(f.badges ?? []).some((b) => b.value === o)) ?? `value ${(f.badges?.length ?? 0) + 1}`, color: 'blue' }] })}><Plus size={11} /> Add a value</button>
        </div>
      )}
      {f.kind === 'link' && <AutocompleteSelect value={f.link_type ?? 'auto'} options={[{ value: 'auto', label: 'Detect (web, email, phone)' }, { value: 'url', label: 'Web address' }, { value: 'email', label: 'Email (mailto:)' }, { value: 'phone', label: 'Phone (tel:)' }]} onChange={(v) => set({ link_type: v === 'auto' ? undefined : v as CellFormat['link_type'] })} />}
      {f.kind === 'image' && (
        <div><Label>Allowed image hosts (https, comma-separated; app paths always)</Label>
          <input className={inputClass} value={(f.image_hosts ?? []).join(', ')} placeholder="images.example.com, *.cdn.example.com" onChange={(e) => onChange({ ...f, image_hosts: e.target.value.split(',').map((h) => h.trim()).filter(Boolean) }, 'fmt-img')} />
        </div>
      )}
      <p className="text-2xs text-fg-muted">Preview: <FormattedCellView cell={preview} /></p>
    </div>
  )
}

/* ── Base filter builder ─────────────────────────────────────────────── */

function ConditionRow({ cond, columns, placeholders, onChange, onRemove }: {
  cond: DataTableCondition
  columns: Array<{ value: string; label: string }>
  placeholders: Array<{ name: string; group: string; label?: string }>
  onChange: (next: DataTableCondition, tag?: string) => void
  onRemove: () => void
}) {
  return (
    <div className="space-y-1 rounded border p-1.5 border-border" data-testid="dt-condition">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
        <AutocompleteSelect value={cond.column} options={columns} onChange={(v) => onChange({ ...cond, column: v })} />
        <AutocompleteSelect value={cond.operator} options={DATA_TABLE_OPERATORS.map((op) => ({ value: op, label: DATA_TABLE_OPERATOR_LABELS[op] }))}
          onChange={(v) => onChange({ column: cond.column, operator: (v || 'eq') as DataTableOperator, ...(v === 'is_set' || v === 'is_not_set' ? {} : { value: cond.value ?? '' }) })} />
        <button type="button" className="rounded p-0.5" aria-label="Remove condition" onClick={onRemove}><X size={11} /></button>
      </div>
      {cond.operator !== 'is_set' && cond.operator !== 'is_not_set' && (
        <VariableInput value={cond.value ?? ''} extraVariables={placeholders} placeholder="A value, {{form.<field>}}, {{user.email}}, {{today-30d}}" onChange={(v) => onChange({ ...cond, value: v }, 'dt-cond')} />
      )}
    </div>
  )
}

export function GroupEditor({ group, depth, columns, placeholders, onChange, onRemove }: {
  group: DataTableConditionGroup
  depth: number
  columns: Array<{ value: string; label: string }>
  placeholders: Array<{ name: string; group: string; label?: string }>
  onChange: (next: DataTableConditionGroup | undefined, tag?: string) => void
  onRemove?: () => void
}) {
  const set = (conditions: DataTableConditionGroup['conditions'], tag?: string) => onChange(conditions.length ? { ...group, conditions } : undefined, tag)
  return (
    <div className={cn(depth ? 'space-y-1 rounded border-l-2 pl-2' : 'space-y-1', depth ? 'border-primary' : '')} data-testid={depth ? 'dt-group' : 'dt-base-filter'}>
      <div className="flex items-center gap-1">
        <span className="text-2xs text-fg-muted">Match</span>
        <div className="w-36"><Radio label="Match" value={group.match} options={[['all', 'All (AND)'], ['any', 'Any (OR)']]} onChange={(m) => onChange({ ...group, match: m })} /></div>
        {onRemove && <button type="button" className="ml-auto rounded p-0.5" aria-label="Remove group" onClick={onRemove}><X size={11} /></button>}
      </div>
      {group.conditions.map((c, i) => isConditionGroup(c)
        ? <GroupEditor key={i} group={c} depth={depth + 1} columns={columns} placeholders={placeholders}
            onChange={(next, tag) => set(next ? group.conditions.map((x, j) => (j === i ? next : x)) : group.conditions.filter((_, j) => j !== i), tag)}
            onRemove={() => set(group.conditions.filter((_, j) => j !== i))} />
        : <ConditionRow key={i} cond={c} columns={columns} placeholders={placeholders}
            onChange={(next, tag) => set(group.conditions.map((x, j) => (j === i ? next : x)), tag ? `${tag}-${depth}-${i}` : undefined)}
            onRemove={() => set(group.conditions.filter((_, j) => j !== i))} />)}
      <div className="flex gap-3">
        <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" disabled={!columns.length}
          onClick={() => set([...group.conditions, { column: columns[0]?.value ?? '', operator: 'eq', value: '' }])}><Plus size={11} /> Condition</button>
        {depth === 0 && (
          <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" disabled={!columns.length}
            onClick={() => set([...group.conditions, { match: group.match === 'all' ? 'any' : 'all', conditions: [{ column: columns[0]?.value ?? '', operator: 'eq', value: '' }] }])}><Plus size={11} /> Group</button>
        )}
      </div>
    </div>
  )
}

/* ── The panel ───────────────────────────────────────────────────────── */

export function DataTableProperties({ state, field, onPatch, onAddCommitKit }: {
  /** "New row → fill → Save row" (lib/forms/designer-state.ts addRowCommitKit). */
  onAddCommitKit?: (options: { apply: 'change' | 'button'; save: 'stage' | 'save_now' }) => void
  state: DesignerState
  field: DesignerField
  onPatch: (config: DataTableFieldConfig, tag?: string) => void
}) {
  const config: DataTableFieldConfig = field.data_table ?? { source: 'table', mode: 'display', columns: [] }
  const set = (patch: Partial<DataTableFieldConfig>, tag?: string) => onPatch({ ...config, ...patch }, tag)
  const [open, setOpen] = useState<string | null>(null)
  const previewValues = useDesignerPreviewValues()
  const [preview, setPreview] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; rows?: DataTableRow[]; total?: number | null; error?: string; local?: string[] }>({ status: 'idle' })

  const { data: tables = [] } = useQuery({ queryKey: ['forms-table-columns'], enabled: config.source === 'table', staleTime: 60_000, queryFn: async () => (await serverRead('forms.tableColumns')).data ?? [] })
  const { data: references = [] } = useQuery({
    queryKey: ['forms-lookup-references'], enabled: config.source === 'reference', staleTime: 60_000,
    queryFn: async () => { const { data, error } = await serverRead('integrations.references'); if (error) throw new Error(error.message); return (data ?? []) as any[] },
  })
  const table = (tables as any[]).find((t) => t.id === config.table_id) as { id: string; name: string; columns: Array<{ key: string; label: string; type: string; options?: string[] }> } | undefined
  const queryClient = useQueryClient()
  const reference = (references as any[]).find((r) => r.id === config.reference_id)
  const model = reference ? referenceResponseSchema(reference) : null
  const runtimeRoot = runtimeView(model).root
  const rowsCheck = validateCollectionPath(runtimeRoot, config.results_path ?? '')
  const apiFields = useMemo(() => collectionItemFields(rowsCheck.ok ? rowsCheck.itemSchema ?? null : null).filter((f) => !f.container), [rowsCheck])
  const totalHints = pagingHints(runtimeRoot).filter((h) => h.kind === 'total').map((h) => h.path)
  const refInputs: Array<{ name: string; required?: boolean; location?: string; default_value?: unknown }> = Array.isArray(reference?.inputs) ? reference.inputs : []
  /** A loaded sample's model replaces the reference's in the designer's cache (it is saved on the server when allowed). */
  const onSchemaLoaded = (loaded: ResponseSchema) => queryClient.setQueryData(['forms-lookup-references'], (rows: any[] | undefined) =>
    (rows ?? []).map((r) => (r.id === config.reference_id ? { ...r, request_config: { ...(r.request_config ?? {}), response_schema: loaded } } : r)))

  // What can be added as a column: the table's columns, or the API item's fields.
  const available = useMemo(() => {
    if (config.source === 'table') return (table?.columns ?? []).map((c) => ({ key: c.key, label: c.label || c.key, type: FROM_TABLE_TYPE[c.type] ?? 'text', tableType: c.type, options: c.options }))
    return apiFields.map((f) => ({ key: f.path, label: f.path, type: columnTypeForField(f), tableType: undefined as string | undefined, options: undefined as string[] | undefined, example: f.example, format: f.format }))
  }, [config.source, table, apiFields])
  const notAdded = available.filter((a) => !config.columns.some((c) => c.key === a.key))
  const columnOptions = [...(config.source === 'table' ? [{ value: DATA_TABLE_ROW_ID, label: 'Row id' }] : []), ...config.columns.map((c) => ({ value: c.key, label: c.label }))]
  const filterColumns = config.source === 'table' ? [...columnOptions, ...(table?.columns ?? []).filter((c) => !config.columns.some((x) => x.key === c.key)).map((c) => ({ value: c.key, label: `${c.label || c.key} (not shown)` }))] : columnOptions

  const otherFields = state.fields.filter((f) => f._id !== field._id && !DISPLAY_FIELD_TYPES.has(f.type))
  const placeholders = [
    ...otherFields.map((f) => ({ name: `form.${f.key}`, group: 'This form', label: f.label || f.key })),
    { name: 'user.id', group: 'Current user', label: 'User id' }, { name: 'user.email', group: 'Current user', label: 'Email' }, { name: 'user.name', group: 'Current user', label: 'Name' },
    { name: 'today', group: 'Dates', label: 'Today' }, { name: 'today-7d', group: 'Dates', label: '7 days ago' }, { name: 'today+30d', group: 'Dates', label: 'In 30 days' },
    { name: 'start_of_month', group: 'Dates', label: 'First day of this month' }, { name: 'now', group: 'Dates', label: 'Now' },
    // {{param.x}} / {{var.x}}: the table queries again when they change.
    ...contextVariableOptions(state.layout),
    // {{control.<key>.*}}: other controls' state (a query sends it; the server keeps declared columns only).
    ...ruleVariableOptions(controlVariables(state.fields.filter((f) => f._id !== field._id) as never)),
  ]
  const tablePlaceholders = [
    { name: 'search', group: 'Table', label: 'The search text' }, { name: 'page', group: 'Table', label: 'Page number (1-based)' },
    { name: 'page_size', group: 'Table', label: 'Rows per page' }, { name: 'offset', group: 'Table', label: 'Rows to skip' },
    { name: 'sort', group: 'Table', label: 'Sort column' }, { name: 'sort_dir', group: 'Table', label: 'asc / desc' },
    ...config.columns.filter((c) => c.filterable).map((c) => ({ name: `filter.${c.key}`, group: 'Table', label: `Filter on ${c.label}` })),
    ...placeholders,
  ]
  const remote = remoteCapabilities(config)

  function columnFor(key: string): DataTableColumn | null {
    const a = available.find((x) => x.key === key)
      // API responses without a model (or with fields the model doesn't list): any path can be added by hand.
      ?? (config.source !== 'table' && key.trim() ? { key: key.trim(), label: key.trim(), type: 'text' as DataTableColumnType, tableType: undefined as string | undefined, options: undefined as string[] | undefined } : undefined)
    if (!a) return null
    const col: DataTableColumn = { key: a.key, label: a.label, type: a.type, sortable: true, filterable: a.type !== 'boolean' ? true : undefined }
    if (a.type === 'choice' && a.options?.length) col.options = a.options
    const kind = ('format' in a && a.format) || defaultFormatKind(a.tableType, 'example' in a && a.example !== undefined ? [a.example] : [])
    if (kind !== defaultColumnFormat(a.type)) col.format = { kind }
    return col
  }
  function addColumns(keys: string[]) {
    const next = [...config.columns]
    for (const key of keys) {
      const col = columnFor(key)
      if (col && !next.some((c) => c.key === col.key) && next.length < DATA_TABLE_LIMITS.columns) next.push(col)
    }
    if (next.length !== config.columns.length) set({ columns: next })
  }
  const addColumn = (key: string) => addColumns([key])
  const patchColumn = (i: number, patch: Partial<DataTableColumn>, tag?: string) => set({ columns: config.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) }, tag)
  const move = (i: number, d: number) => { const next = [...config.columns]; [next[i], next[i + d]] = [next[i + d], next[i]]; set({ columns: next }) }

  async function runPreview() {
    setPreview({ status: 'loading' })
    try {
      const res = await fetch('/api/internal/forms/data-table', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ field: { ...field, data_table: config }, query: {}, values: previewValues ?? {} }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'The preview failed')
      setPreview({ status: 'done', rows: json.rows ?? [], total: json.total ?? null, local: json.applied_locally })
    } catch (e) {
      setPreview({ status: 'error', error: e instanceof Error ? e.message : 'The preview failed' })
    }
  }

  return (
    <DesignerVariableScope state={state} context={{ kind: 'table_query', exclude: field.key }}>
    <div className="space-y-3" data-testid="data-table-properties">
      <Section title="Rows from">
        <Radio label="Source" value={config.source} options={[['table', 'Data table'], ['reference', 'API reference']]}
          onChange={(src) => src !== config.source && onPatch({ source: src, mode: config.mode, columns: [], multiple: config.multiple, allow_add: config.allow_add, allow_delete: config.allow_delete, page_size: config.page_size })} />
        {config.source === 'table' ? (
          <div>
            <Label>Data table</Label>
            <AutocompleteSelect value={config.table_id ?? ''} placeholder="Choose a table…" options={(tables as any[]).map((t) => ({ value: t.id, label: t.name }))}
              onChange={(v) => onPatch({ ...config, table_id: v || undefined, columns: [], base_filter: undefined, sort: undefined, key_column: undefined })} />
          </div>
        ) : (
          <>
            <div>
              <Label>API reference / connector operation</Label>
              <AutocompleteSelect value={config.reference_id ?? ''} placeholder="Choose a reference…"
                options={(references as any[]).filter((r) => !isWriteReference(r) || r.id === config.reference_id).map((r) => ({ value: String(r.id), label: String(r.name), hint: referencePickerHint(r) }))}
                onChange={(v) => { const ref = (references as any[]).find((r) => r.id === v); onPatch({ ...config, reference_id: v || undefined, integration_id: ref?.integration?.id ? String(ref.integration.id) : undefined, input_mappings: undefined, results_path: undefined, columns: [] }) }} />
              {isWriteReference(reference) && (
                <p className="mt-1 text-2xs text-danger" role="alert" data-testid="dt-write-reference">
                  This reference writes data — a Data table only reads, so it is refused here. Use it in a &ldquo;For each changed row&rdquo; rule or a rule action instead.
                </p>
              )}
            </div>
            {reference && (
              <>
                <div>
                  <Label>Request parameters</Label>
                  {refInputs.length === 0 && <Hint>This reference takes no inputs.</Hint>}
                  {refInputs.map((input) => (
                    <div key={input.name}>
                      <p className="font-mono text-2xs">{input.name}{input.required ? ' *' : ''}{input.location ? <span className="text-fg-muted"> · {input.location}</span> : null}</p>
                      <VariableInput value={config.input_mappings?.[input.name] ?? ''} extraVariables={tablePlaceholders} placeholder="{{search}}, {{page}}, {{sort}}, {{filter.<col>}}, {{form.<field>}}…"
                        onChange={(v) => { const m = { ...(config.input_mappings ?? {}) }; if (v) m[input.name] = v; else delete m[input.name]; set({ input_mappings: Object.keys(m).length ? m : undefined }, `dt-in-${input.name}`) }} />
                    </div>
                  ))}
                  <Hint>
                    Passed to the API: {[remote.search && 'search', remote.sort && 'sort', remote.page && 'paging', remote.filters.length && `filters on ${remote.filters.join(', ')}`].filter(Boolean).join(', ') || 'nothing'}.
                    {' '}Everything else (and the base filter) is applied by the server to the rows the API returns — at most {DATA_TABLE_LIMITS.referenceRows}{remote.page ? ' per page' : ''}.
                  </Hint>
                </div>
                <ResponseCollectionPicker
                  key={config.reference_id}
                  schema={model}
                  value={config.results_path}
                  // A designer's pick starts the columns afresh; the automatic one keeps any added by hand.
                  onChange={(path, { auto }) => set({ results_path: path || undefined, ...(auto ? {} : { columns: [] }) })}
                  referenceId={config.reference_id}
                  inputs={refInputs}
                  mappings={config.input_mappings}
                  onSchemaLoaded={onSchemaLoaded}
                  fields={{ selected: config.columns.map((c) => c.key), onAdd: (fs) => addColumns(fs.map((f) => f.path)) }}
                  label="Rows list"
                  testId="dt-rows-list"
                />
                {remote.page && (
                  <div>
                    <Label>Total count path (optional)</Label>
                    <input className={`${inputClass} font-mono`} value={config.total_path ?? ''} placeholder={totalHints[0] ? `e.g. ${totalHints[0]}` : 'e.g. meta.total'} list={totalHints.length ? `dt-total-${field._id}` : undefined}
                      onChange={(e) => set({ total_path: e.target.value || undefined }, 'dt-total')} />
                    {totalHints.length > 0 && <datalist id={`dt-total-${field._id}`}>{totalHints.map((h) => <option key={h} value={h} />)}</datalist>}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Section>

      <Section title="Columns">
        <div className="space-y-1" data-testid="dt-columns">
          {config.columns.map((col, i) => {
            const isOpen = open === col.key
            return (
              <div key={col.key} className="rounded border border-border" data-dt-column={col.key}>
                <div className="flex items-center gap-1 px-1.5 py-1 text-2xs">
                  <button type="button" className="rounded p-0.5" aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Edit'} ${col.label}`} onClick={() => setOpen(isOpen ? null : col.key)}>{isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
                  <span className={`flex-1 truncate ${col.hidden ? 'opacity-50' : ''}`}>{col.label}<span className="font-mono text-fg-muted"> · {col.key}</span></span>
                  <button type="button" className="rounded p-0.5" aria-pressed={!col.hidden} aria-label={col.hidden ? `Show ${col.label}` : `Hide ${col.label}`} onClick={() => patchColumn(i, { hidden: col.hidden ? undefined : true })}>{col.hidden ? <EyeOff size={11} /> : <Eye size={11} />}</button>
                  <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={i === 0} aria-label={`Move ${col.label} up`} onClick={() => move(i, -1)}><ArrowUp size={11} /></button>
                  <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={i === config.columns.length - 1} aria-label={`Move ${col.label} down`} onClick={() => move(i, 1)}><ArrowDown size={11} /></button>
                  <button type="button" className="rounded p-0.5" aria-label={`Remove ${col.label}`} onClick={() => set({ columns: config.columns.filter((_, j) => j !== i) })}><X size={11} /></button>
                </div>
                {isOpen && (
                  <div className="space-y-1.5 border-t p-1.5 border-border">
                    <div className="grid grid-cols-2 gap-1">
                      <div><Label>Label</Label><input className={inputClass} value={col.label} onChange={(e) => patchColumn(i, { label: e.target.value }, `dt-col-label-${i}`)} /></div>
                      <div><Label>Type</Label><AutocompleteSelect value={col.type} options={DATA_TABLE_COLUMN_TYPES.map((t) => ({ value: t, label: DATA_TABLE_COLUMN_TYPE_LABELS[t] }))} onChange={(v) => patchColumn(i, { type: (v || 'text') as DataTableColumnType, format: undefined })} /></div>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <Toggle checked={col.sortable === true} onChange={(v) => patchColumn(i, { sortable: v || undefined })}>People can sort</Toggle>
                      <Toggle checked={col.filterable === true} onChange={(v) => patchColumn(i, { filterable: v || undefined })}>People can filter</Toggle>
                      {config.mode === 'edit' && <Toggle checked={col.read_only === true} onChange={(v) => patchColumn(i, { read_only: v || undefined })}>Read-only when editing</Toggle>}
                      {config.mode === 'edit' && <Toggle checked={col.required === true} onChange={(v) => patchColumn(i, { required: v || undefined })}>Required</Toggle>}
                    </div>
                    {config.mode === 'edit' && col.read_only && <p className="text-2xs text-fg-muted" data-readonly-help>An existing row keeps this value: the cell can&apos;t be edited, rules leave it alone and the server ignores a changed value. A new row gets it only from the default below.</p>}
                    {config.mode === 'edit' && (
                      <div><Label>Default for a new row (rules&apos; New row)</Label><input className={inputClass} value={col.default ?? ''} placeholder="A value, or {{form.x}}, {{today}}, {{user.id}}" onChange={(e) => patchColumn(i, { default: e.target.value || undefined }, `dt-col-def-${i}`)} /></div>
                    )}
                    {col.type === 'choice' && (
                      <div><Label>Choices (comma-separated)</Label><input className={inputClass} value={(col.options ?? []).join(', ')} onChange={(e) => patchColumn(i, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) }, `dt-col-opt-${i}`)} /></div>
                    )}
                    {col.type === 'number' && config.mode === 'edit' && (
                      <div className="grid grid-cols-2 gap-1">
                        <div><Label>Minimum</Label><input type="number" className={inputClass} value={col.min ?? ''} onChange={(e) => patchColumn(i, { min: e.target.value === '' ? undefined : Number(e.target.value) }, `dt-col-min-${i}`)} /></div>
                        <div><Label>Maximum</Label><input type="number" className={inputClass} value={col.max ?? ''} onChange={(e) => patchColumn(i, { max: e.target.value === '' ? undefined : Number(e.target.value) }, `dt-col-max-${i}`)} /></div>
                      </div>
                    )}
                    <FormatEditor col={col} onChange={(format, tag) => patchColumn(i, { format }, tag ? `${tag}-${i}` : undefined)} />
                  </div>
                )}
              </div>
            )
          })}
          {notAdded.length > 0 && config.columns.length < DATA_TABLE_LIMITS.columns && (
            <AutocompleteSelect value="" placeholder="+ Add a column (search)…" options={notAdded.map((a) => ({ value: a.key, label: a.label, hint: a.type }))} onChange={(v) => v && addColumn(v)} />
          )}
          {config.source !== 'table' && config.reference_id && config.columns.length < DATA_TABLE_LIMITS.columns && <ManualColumn onAdd={addColumn} />}
          {!available.length && <Hint>{config.source === 'table' ? 'Choose a data table first.' : 'Choose a reference and its rows list, or type a field path (e.g. name, address.city) to add a column by hand.'}</Hint>}
          <Hint>Only these columns are fetched and sent to the browser. Hidden columns are fetched (for the value and rules) but not shown.</Hint>
        </div>
        <div>
          <Label>Row key (identifies a row)</Label>
          <AutocompleteSelect value={config.key_column ?? (config.source === 'table' ? DATA_TABLE_ROW_ID : '')} placeholder="Choose the key column…" options={columnOptions}
            onChange={(v) => set({ key_column: v && !(config.source === 'table' && v === DATA_TABLE_ROW_ID) ? v : undefined })} />
        </div>
      </Section>

      <Section title="What people can do">
        <Radio label="Mode" value={config.mode} options={DATA_TABLE_MODES.map((m) => [m, DATA_TABLE_MODE_LABELS[m]] as [typeof m, string])} onChange={(m) => onPatch({ ...config, mode: m, multiple: undefined, allow_add: undefined, allow_delete: undefined, max_rows: undefined })} />
        {config.mode === 'select' && <Toggle checked={config.multiple === true} onChange={(v) => set({ multiple: v || undefined })}>Several rows</Toggle>}
        {config.mode === 'edit' && (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <Toggle checked={config.allow_add === true} onChange={(v) => set({ allow_add: v || undefined })}>Add rows</Toggle>
            <Toggle checked={config.allow_delete === true} onChange={(v) => set({ allow_delete: v || undefined })}>Delete rows</Toggle>
            <Toggle checked={config.row_commit_controls === true} onChange={(v) => set({ row_commit_controls: v || undefined })}>✓ / ✕ on pending rows</Toggle>
          </div>
        )}
        {config.mode === 'edit' && config.allow_add && onAddCommitKit && <RowCommitKitPanel table onAdd={onAddCommitKit} />}
        {config.mode === 'edit' && (
          <div><Label>Pending rows at submit (made by a rule&apos;s New row / Set row values, not committed)</Label>
            <select className={inputClass} value={config.on_submit_pending ?? 'block'} onChange={(e) => set({ on_submit_pending: e.target.value === 'block' ? undefined : e.target.value as 'exclude' | 'commit' })}>
              {LIST_PENDING_MODES.map((m) => <option key={m} value={m}>{LIST_PENDING_MODE_LABELS[m]}</option>)}
            </select>
          </div>
        )}
        {config.mode !== 'display' && (
          <div className="w-40"><Label>{config.mode === 'select' ? 'Max rows selected' : 'Max changes per submit'}</Label>
            <input type="number" min={1} max={config.mode === 'select' ? DATA_TABLE_LIMITS.maxSelected : DATA_TABLE_LIMITS.maxChanges} className={inputClass} value={config.max_rows ?? ''} placeholder={String(config.mode === 'select' ? DATA_TABLE_LIMITS.defaultMaxSelected : DATA_TABLE_LIMITS.defaultMaxChanges)}
              onChange={(e) => set({ max_rows: e.target.value ? Number(e.target.value) : undefined }, 'dt-max')} />
          </div>
        )}
        <Hint>
          Downstream: <code className="text-primary-text">{`{{task_data.${field.key}}}`}</code>
          {config.mode === 'select' ? ' — the selected rows.' : config.mode === 'edit' ? ' — the changes { added, updated, deleted }; add a "For each changed row" step to a button to write them back.' : ' — a read-only table holds no value.'}
        </Hint>
      </Section>

      <Section title="Base filter (always applied)">
        <GroupEditor group={config.base_filter ?? { match: 'all', conditions: [] }} depth={0} columns={filterColumns} placeholders={placeholders}
          onChange={(next, tag) => set({ base_filter: next }, tag)} />
        <Hint>Runs on the server before anything people do: their search and filters only narrow it.</Hint>
      </Section>

      <Section title="Sort and paging">
        <div className="space-y-1" data-testid="dt-sort">
          {(config.sort ?? []).map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_auto] gap-1">
              <AutocompleteSelect value={s.column} options={filterColumns} onChange={(v) => set({ sort: (config.sort ?? []).map((x, j) => (j === i ? { ...x, column: v } : x)) })} />
              <AutocompleteSelect value={s.direction} options={[{ value: 'asc', label: 'A→Z / 1→9' }, { value: 'desc', label: 'Z→A / 9→1' }]} onChange={(v) => set({ sort: (config.sort ?? []).map((x, j) => (j === i ? { ...x, direction: v === 'desc' ? 'desc' : 'asc' } : x)) })} />
              <button type="button" className="rounded p-0.5" aria-label={`Remove sort ${i + 1}`} onClick={() => { const next = (config.sort ?? []).filter((_, j) => j !== i); set({ sort: next.length ? next : undefined }) }}><X size={11} /></button>
            </div>
          ))}
          {(config.sort ?? []).length < DATA_TABLE_LIMITS.sorts && filterColumns.length > 0 && (
            <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text"
              onClick={() => set({ sort: [...(config.sort ?? []), { column: filterColumns.find((c) => !(config.sort ?? []).some((s) => s.column === c.value))?.value ?? filterColumns[0].value, direction: 'asc' }] })}><Plus size={11} /> Sort by</button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1">
          <div><Label>Rows per page</Label><input type="number" min={1} max={DATA_TABLE_LIMITS.maxPageSize} className={inputClass} value={config.page_size ?? DATA_TABLE_LIMITS.defaultPageSize} onChange={(e) => set({ page_size: e.target.value ? Number(e.target.value) : undefined }, 'dt-ps')} /></div>
          <div><Label>Locale (formats)</Label><input className={inputClass} placeholder="Viewer's" value={config.locale ?? ''} onChange={(e) => set({ locale: e.target.value || undefined }, 'dt-locale')} /></div>
        </div>
        <Toggle checked={config.searchable !== false} onChange={(v) => set({ searchable: v ? undefined : false })}>Search box</Toggle>
        <Toggle checked={config.full_width === true} onChange={(v) => set({ full_width: v || undefined })} testId="dt-full-width">Full width (the form uses a wide card)</Toggle>
        <Hint>Many columns: the form grows to at least the Wide width (Form theme → Form width). Wider tables still scroll sideways with the first column fixed.</Hint>
        {config.source === 'table' && (
          <>
            <Toggle checked={config.open_access === true} onChange={(v) => set({ open_access: v || undefined })} testId="dt-open-access">People without data access can see these rows</Toggle>
            <Hint>Off: viewing needs the data.view permission and each person&apos;s own data access applies. On: anyone who can fill in the form sees the rows this field selects (the columns and base filter still limit them).</Hint>
          </>
        )}
        <Toggle checked={config.anonymous_read === true} onChange={(v) => set({ anonymous_read: v || undefined })} testId="dt-anonymous-read">Allow anonymous read</Toggle>
        <Hint>
          For a public form link (Forms → Details → Anonymous responses). Off: anonymous visitors see nothing here.
          {config.anonymous_read === true && <span className="text-danger"> On: ANYONE with the link can read these rows — the declared columns within the base filter, a page at a time (at most 25 rows).</span>}
        </Hint>
      </Section>

      <Section title="Live preview">
        <button type="button" onClick={runPreview} disabled={preview.status === 'loading' || !config.columns.length} className="flex items-center gap-1 text-2xs font-medium disabled:opacity-50 text-primary-text" data-testid="dt-run-preview">
          {preview.status === 'loading' ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <Play size={11} aria-hidden />} Run the query
        </button>
        <div aria-live="polite" data-testid="dt-preview-result">
          {preview.status === 'error' && <p role="alert" className="text-2xs text-danger">{preview.error}</p>}
          {preview.status === 'done' && (
            <>
              <p className="text-2xs text-fg-muted">{preview.total !== null && preview.total !== undefined ? `${preview.total} row${preview.total === 1 ? '' : 's'} match` : `${preview.rows?.length ?? 0} rows on the first page`}{preview.local?.length ? ` · applied by the server: ${preview.local.join(', ')}` : ''}</p>
              <div className="mt-1 max-h-48 overflow-auto rounded border border-border">
                <table className="w-full text-2xs">
                  <thead><tr>{config.columns.filter((c) => !c.hidden).map((c) => <th key={c.key} scope="col" className="px-1.5 py-1 text-left">{c.label}</th>)}</tr></thead>
                  <tbody>
                    {(preview.rows ?? []).map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        {config.columns.filter((c) => !c.hidden).map((c) => <td key={c.key} className="whitespace-nowrap px-1.5 py-1"><FormattedCellView cell={formatCell(c, r.values[c.key], { locale: config.locale })} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <Hint>Runs the real query on the server with your access, using the live preview&apos;s form values for {'{{form.…}}'}.</Hint>
      </Section>
    </div>
    </DesignerVariableScope>
  )
}

/** Add an API column by its path when the response model doesn't list it. */
function ManualColumn({ onAdd }: { onAdd: (key: string) => void }) {
  const [path, setPath] = useState('')
  const add = () => { if (path.trim()) { onAdd(path.trim()); setPath('') } }
  return (
    <div className="flex gap-1">
      <input aria-label="Field path" className="min-w-0 flex-1 rounded border px-2 py-1 font-mono text-2xs border-border"
        placeholder="Field path, e.g. address.city" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
      <button type="button" onClick={add} disabled={!path.trim()} className="rounded border px-2 py-1 text-2xs border-border">Add</button>
    </div>
  )
}
