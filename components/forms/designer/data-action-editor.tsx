'use client'

/* eslint-disable @typescript-eslint/no-explicit-any -- tables and test results are free-form JSON */

import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, FlaskConical, Plus, X } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import { serverRead } from '@/lib/server-read'
import type { DesignerState } from '@/lib/forms/designer-state'
import type { FieldButtonAction } from '@/lib/forms/field-buttons'
import { DATA_TABLE_OPERATOR_LABELS, isConditionGroup, type DataTableCondition, type DataTableConditionGroup, type DataTableOperator, type DataTableSort } from '@/lib/forms/data-table'
import { TOP_ONE_HINT, topOneNotice, type ActionOutput } from '@/lib/forms/data-actions'
import { layoutFormVariables } from '@/lib/forms/form-params'
import { isResultPath, normalizeResultPath } from '@/lib/forms/reference-results'
import { DISPLAY_FIELD_TYPES, TASK_FIELD_TYPE_LABELS, type TaskFieldType } from '@/lib/task-field-schema'
import { designerInputClass as inputClass } from './designer-controls'
import { cn } from '@/lib/utils'
import { asListField } from '@/lib/forms/repeating-section'

/**
 * The designer for a rule's data and API steps (lib/forms/data-actions.ts):
 * the table and what it reads / writes (row id, filter, sort, limit, column
 * values), the response's rows filter for an API call, the outputs (fields,
 * Labels, variables, Lists with column paths, a choice's options), the TOP 1
 * notice when a list result goes into one value, and Test — a real read
 * with sample values (nothing is written) whose result paths can be clicked
 * into an output.
 */

type Placeholder = { name: string; group: string; label?: string }

function Heading({ children }: { children: React.ReactNode }) {
  return <p className="text-2xs font-semibold text-fg-muted">{children}</p>
}

const OPERATORS: DataTableOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts_with', 'ends_with', 'in', 'is_set', 'is_not_set']

/** AND / OR conditions with values from the form, the row, variables, the user or dates (one nested level). */
export function ActionFilterEditor({ value, onChange, columns, placeholders, label = 'Filter' }: {
  value: DataTableConditionGroup | undefined
  onChange: (next: DataTableConditionGroup | undefined) => void
  columns: Array<{ key: string; label: string }>
  placeholders: Placeholder[]
  label?: string
}) {
  const group = value ?? { match: 'all' as const, conditions: [] }
  const set = (next: DataTableConditionGroup) => onChange(next.conditions.length ? next : undefined)
  const conditionRow = (c: DataTableCondition, update: (c: DataTableCondition | null) => void, i: number) => (
    <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_minmax(0,1.3fr)_auto] items-center gap-1" data-filter-condition={c.column}>
      {columns.length
        ? <AutocompleteSelect value={c.column} options={columns.map((col) => ({ value: col.key, label: col.label }))} onChange={(v) => update({ ...c, column: v || c.column })} />
        : <input className={`${inputClass} font-mono`} aria-label="Column or path" value={c.column} onChange={(e) => update({ ...c, column: e.target.value })} />}
      <select className={inputClass} aria-label="Operator" value={c.operator} onChange={(e) => update({ ...c, operator: e.target.value as DataTableOperator })}>
        {OPERATORS.map((op) => <option key={op} value={op}>{DATA_TABLE_OPERATOR_LABELS[op]}</option>)}
      </select>
      {c.operator === 'is_set' || c.operator === 'is_not_set'
        ? <span />
        : <VariableInput value={c.value ?? ''} extraVariables={placeholders} placeholder="{{form.x}}, {{row.x}}, {{user.id}}, {{today}}…" ariaLabel="Value" onChange={(v) => update({ ...c, value: v })} />}
      <button type="button" className="rounded p-0.5" aria-label="Remove condition" onClick={() => update(null)}><X size={10} /></button>
    </div>
  )
  return (
    <section className="min-w-0 space-y-1" aria-label={label} data-action-filter>
      <div className="flex items-center gap-1">
        <Heading>{label}</Heading>
        {group.conditions.length > 1 && (
          <select className={cn(inputClass, 'h-6 w-auto text-2xs')} aria-label="Match" value={group.match} onChange={(e) => set({ ...group, match: e.target.value === 'any' ? 'any' : 'all' })}>
            <option value="all">all of (AND)</option><option value="any">any of (OR)</option>
          </select>
        )}
      </div>
      {group.conditions.map((c, i) => (isConditionGroup(c) ? (
        <div key={i} className="space-y-1 rounded border border-dashed border-border p-1">
          <select className={cn(inputClass, 'h-6 w-auto text-2xs')} aria-label="Group match" value={c.match} onChange={(e) => set({ ...group, conditions: group.conditions.map((x, j) => (j === i ? { ...c, match: e.target.value === 'any' ? 'any' : 'all' } : x)) })}>
            <option value="all">all of (AND)</option><option value="any">any of (OR)</option>
          </select>
          {c.conditions.map((inner, k) => (isConditionGroup(inner) ? null : conditionRow(inner, (n) => set({ ...group, conditions: group.conditions.map((x, j) => (j === i ? { ...c, conditions: n ? c.conditions.map((y, m) => (m === k ? n : y)) : c.conditions.filter((_, m) => m !== k) } : x)) }), k)))}
          <button type="button" className="text-2xs text-primary-text" onClick={() => set({ ...group, conditions: group.conditions.map((x, j) => (j === i ? { ...c, conditions: [...c.conditions, { column: columns[0]?.key ?? 'row_id', operator: 'eq', value: '' }] } : x)) })}>+ condition in this group</button>
        </div>
      ) : conditionRow(c, (n) => set({ ...group, conditions: n ? group.conditions.map((x, j) => (j === i ? n : x)) : group.conditions.filter((_, j) => j !== i) }), i)))}
      <div className="flex gap-3">
        <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" data-add-condition onClick={() => set({ ...group, conditions: [...group.conditions, { column: columns[0]?.key ?? 'row_id', operator: 'eq', value: '' }] })}><Plus size={10} /> Condition</button>
        <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" onClick={() => set({ ...group, conditions: [...group.conditions, { match: 'any', conditions: [] }] })}><Plus size={10} /> Group</button>
      </div>
    </section>
  )
}

export function ActionSortEditor({ sort, limit, offset, onChange, columns, showOffset }: {
  sort: DataTableSort[] | undefined
  limit?: number
  offset?: number
  onChange: (patch: { sort?: DataTableSort[]; limit?: number; offset?: number }) => void
  columns: Array<{ key: string; label: string }>
  showOffset?: boolean
}) {
  const list = sort ?? []
  return (
    <section className="min-w-0 space-y-1" aria-label="Sort and limit" data-action-sort>
      <Heading>Sort and limit</Heading>
      {list.map((s, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-1">
          {columns.length
            ? <AutocompleteSelect value={s.column} options={columns.map((c) => ({ value: c.key, label: c.label }))} onChange={(v) => onChange({ sort: list.map((x, j) => (j === i ? { ...x, column: v || x.column } : x)) })} />
            : <input className={`${inputClass} font-mono`} aria-label="Sort by" value={s.column} onChange={(e) => onChange({ sort: list.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)) })} />}
          <select className={inputClass} aria-label="Direction" value={s.direction} onChange={(e) => onChange({ sort: list.map((x, j) => (j === i ? { ...x, direction: e.target.value === 'desc' ? 'desc' : 'asc' } : x)) })}>
            <option value="asc">ascending</option><option value="desc">descending (newest first)</option>
          </select>
          <button type="button" className="rounded p-0.5" aria-label="Remove sort" onClick={() => { const next = list.filter((_, j) => j !== i); onChange({ sort: next.length ? next : undefined }) }}><X size={10} /></button>
        </div>
      ))}
      {list.length < 3 && <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" onClick={() => onChange({ sort: [...list, { column: columns[0]?.key ?? 'created_at', direction: 'asc' }] })}><Plus size={10} /> Sort by</button>}
      <div className="grid grid-cols-2 gap-1">
        <label className="text-2xs">Limit<input type="number" min={1} className={inputClass} value={limit ?? ''} placeholder="50" onChange={(e) => onChange({ limit: e.target.value ? Number(e.target.value) : undefined })} /></label>
        {showOffset && <label className="text-2xs">Skip<input type="number" min={0} className={inputClass} value={offset ?? ''} placeholder="0" onChange={(e) => onChange({ offset: e.target.value ? Number(e.target.value) : undefined })} /></label>}
      </div>
    </section>
  )
}

interface Target { value: string; label: string; type: string }

function outputTargets(state: DesignerState): Target[] {
  return [
    ...state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type) && f.type !== 'data_table' && f.type !== 'attachments' && f.type !== 'custom')
      // A repeating section takes rows like a List (its items).
      .map((f) => ({ value: f.key, label: `${f.label || f.key}${f.read_only ? ' (read-only)' : ''}`, type: f.type === 'repeating_section' ? 'list' : f.type })),
    ...layoutFormVariables(state.layout).map((v) => ({ value: `var.${v.name}`, label: `{{var.${v.name}}}`, type: 'var' })),
  ]
}

/**
 * Outputs: result path → a field (input, Label, read-only), a List (whole
 * array, per-column paths, replace / append), a choice's options (value /
 * label paths) or a variable. A list result into one value shows the TOP 1
 * notice with a link to the filter.
 */
export function OutputsEditor({ action, state, onChange, resultIsList, onOpenFilter, pickedPath }: {
  action: FieldButtonAction
  state: DesignerState
  onChange: (next: FieldButtonAction) => void
  resultIsList: boolean
  onOpenFilter?: () => void
  pickedPath?: string | null
}) {
  const targets = outputTargets(state)
  const outputs = action.outputs ?? []
  const set = (next: ActionOutput[]) => onChange({ ...action, outputs: next.length ? next : undefined })
  const typeOf = (key: string) => targets.find((t) => t.value === key)?.type
  return (
    <section className="min-w-0 space-y-1.5" aria-label="Then write the result" data-action-outputs>
      <Heading>Then write the result</Heading>
      {outputs.map((o, i) => {
        const type = typeOf(o.to)
        const field = state.fields.map(asListField).find((f) => f.key === o.to)
        const notice = topOneNotice(action, o, type, resultIsList)
        const update = (patch: Partial<ActionOutput>) => set(outputs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
        return (
          <div key={i} className="space-y-1 rounded border border-border p-1.5" data-output-row={o.to}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-1 text-2xs">
              <input className={`${inputClass} font-mono`} aria-label="Result path" value={o.path} placeholder="(the whole result)" onChange={(e) => update({ path: e.target.value })} aria-invalid={Boolean(o.path) && !isResultPath(normalizeResultPath(o.path))} />
              <span aria-hidden>→</span>
              <AutocompleteSelect value={o.to} options={targets.map((t) => ({ value: t.value, label: t.label, hint: t.type === 'var' ? 'variable' : TASK_FIELD_TYPE_LABELS[t.type as TaskFieldType] ?? t.type }))} onChange={(v) => { if (v) update({ to: v, as: undefined, columns: undefined }) }} />
              <button type="button" className="rounded p-0.5" aria-label="Remove output" onClick={() => set(outputs.filter((_, j) => j !== i))}><X size={10} /></button>
            </div>
            {(type === 'choice' || type === 'multi_choice') && (
              <label className="flex items-center gap-1.5 text-2xs">
                <input type="checkbox" className="accent-primary" checked={o.as === 'options'} onChange={(e) => update({ as: e.target.checked ? 'options' : undefined })} />
                Load the list as this field&apos;s options
              </label>
            )}
            {o.as === 'options' && (
              <div className="grid grid-cols-2 gap-1">
                <input className={`${inputClass} font-mono`} aria-label="Option value path" placeholder="value path (e.g. id)" value={o.value_path ?? ''} onChange={(e) => update({ value_path: e.target.value || undefined })} />
                <input className={`${inputClass} font-mono`} aria-label="Option label path" placeholder="label path (e.g. name)" value={o.label_path ?? ''} onChange={(e) => update({ label_path: e.target.value || undefined })} />
              </div>
            )}
            {type === 'list' && field?.list && (
              <div className="space-y-1">
                <div className="flex gap-1" role="radiogroup" aria-label="Replace or append">
                  {(['replace', 'append'] as const).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={(o.mode ?? 'replace') === m} onClick={() => update({ mode: m === 'append' ? 'append' : undefined })}
                      className={cn('h-6 flex-1 rounded border text-2xs', (o.mode ?? 'replace') === m ? 'border-primary bg-primary-wash text-primary-text' : 'border-border')}>{m === 'replace' ? 'Replace the rows' : 'Add to the rows'}</button>
                  ))}
                </div>
                {field.list.columns.filter((c) => c.type !== 'calculated').map((c) => (
                  <div key={c.key} className="grid grid-cols-[6rem_auto_minmax(0,1fr)] items-center gap-1 text-2xs">
                    <span className="truncate">{c.label}</span><span aria-hidden>←</span>
                    <input className={`${inputClass} font-mono`} aria-label={`Path for ${c.label}`} placeholder={c.key} value={o.columns?.[c.key] ?? ''}
                      onChange={(e) => { const cols = { ...(o.columns ?? {}) }; if (e.target.value) cols[c.key] = e.target.value; else delete cols[c.key]; update({ columns: Object.keys(cols).length ? cols : undefined }) }} />
                  </div>
                ))}
                <p className="text-2xs text-fg-muted">Each item of the list becomes a row; a column reads the item&apos;s field of the same name unless you give a path.</p>
              </div>
            )}
            {notice && (
              <div className="rounded border border-warning/40 bg-warning/10 p-1.5 text-2xs" role="note" data-top-one-notice>
                <p className="flex items-center gap-1 font-medium"><AlertTriangle size={11} aria-hidden /> {notice}</p>
                <p className="text-fg-muted">{TOP_ONE_HINT}</p>
                {onOpenFilter && <button type="button" className="mt-0.5 text-2xs font-medium text-primary-text underline" onClick={onOpenFilter} data-open-filter>Add a filter or sort</button>}
              </div>
            )}
          </div>
        )
      })}
      <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" data-add-output
        onClick={() => set([...outputs, { path: pickedPath ?? '', to: targets[0]?.value ?? '' }])}><Plus size={10} /> Output{pickedPath ? ` from ${pickedPath}` : ''}</button>
      <p className="text-2xs text-fg-muted">Written on the server: only the fields, Lists and variables listed here; each value is converted to the field&apos;s type.</p>
    </section>
  )
}

/** Test: run the read with sample values (nothing is written); click a result path to map it. */
export function ActionTestPanel({ action, state, onPick }: { action: FieldButtonAction; state: DesignerState; onPick: (path: string) => void }) {
  const [sample, setSample] = useState('')
  const [status, setStatus] = useState<{ loading?: boolean; error?: string; data?: any } | null>(null)
  const run = async () => {
    setStatus({ loading: true })
    try {
      let values: Record<string, unknown> = {}
      if (sample.trim()) values = JSON.parse(sample)
      const res = await fetch('/api/internal/forms/rule-action-test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ action, values, fields: state.fields, layout: state.layout }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'The test failed')
      setStatus({ data: json })
    } catch (error) {
      setStatus({ error: error instanceof SyntaxError ? 'Sample values must be JSON, e.g. { "email": "ada@example.com" }' : error instanceof Error ? error.message : 'The test failed' })
    }
  }
  return (
    <section className="min-w-0 space-y-1 rounded border border-dashed border-border p-1.5" aria-label="Test" data-action-test>
      <div className="flex items-center gap-1">
        <Heading>Test with sample values</Heading>
        <button type="button" className="ml-auto flex items-center gap-1 rounded border border-border px-2 py-0.5 text-2xs font-medium disabled:opacity-50" disabled={status?.loading} onClick={() => void run()} data-run-test>
          <FlaskConical size={11} aria-hidden /> {status?.loading ? 'Testing…' : 'Test'}
        </button>
      </div>
      <textarea className="w-full rounded-md border border-input-border bg-input px-2 py-1 font-mono text-2xs" rows={2} aria-label="Sample values (JSON)" placeholder='{ "email": "ada@example.com", "row": { "sku": "A-1" } }' value={sample} onChange={(e) => setSample(e.target.value)} />
      {status?.error && <p className="text-2xs text-danger" role="alert">{status.error}</p>}
      {status?.data && (
        <div className="space-y-1">
          {status.data.notice && <p className="flex items-center gap-1 text-2xs font-medium" role="note" data-test-notice><AlertTriangle size={11} aria-hidden /> {status.data.notice}</p>}
          <pre className="max-h-40 overflow-auto rounded bg-subtle p-1.5 text-2xs" data-test-result>{JSON.stringify(status.data.result, null, 2)}</pre>
          {status.data.paths?.length > 0 && (
            <div className="flex flex-wrap gap-1" aria-label="Result paths">
              {status.data.paths.slice(0, 40).map((p: any) => (
                <button key={p.path} type="button" className="rounded-full border border-border px-2 py-0.5 font-mono text-2xs hover:border-primary" title={p.example !== undefined ? `e.g. ${String(p.example)}` : p.type} onClick={() => onPick(p.path)} data-result-path={p.path}>{p.path}</button>
              ))}
            </div>
          )}
          {Object.keys(status.data.preview?.values ?? {}).length > 0 && <p className="text-2xs text-fg-muted">Would write: {Object.entries(status.data.preview.values).map(([k, v]) => `${k} = ${JSON.stringify(v).slice(0, 60)}`).join(', ')}</p>}
        </div>
      )}
    </section>
  )
}

/** table_read / list / create / update / delete. */
export function TableActionEditor({ action, state, placeholders, onChange }: {
  action: FieldButtonAction
  state: DesignerState
  placeholders: Placeholder[]
  onChange: (next: FieldButtonAction, tag?: string) => void
}) {
  const { data: tables = [] } = useQuery({ queryKey: ['forms-table-columns'], staleTime: 60_000, queryFn: async () => (await serverRead('forms.tableColumns')).data ?? [] })
  const table = (tables as any[]).find((t) => t.id === action.table_id)
  const columns: Array<{ key: string; label: string }> = [{ key: 'row_id', label: 'Row id' }, ...((table?.columns ?? []) as Array<{ key: string; label: string }>).filter((c) => c.key !== 'id' && c.key !== 'date_created')]
  const filterRef = useRef<HTMLDivElement>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const reads = action.type === 'table_read' || action.type === 'table_list'
  const writesCells = action.type === 'table_create' || action.type === 'table_update'
  return (
    <div className="min-w-0 space-y-2" data-table-action={action.type}>
      <AutocompleteSelect value={action.table_id ?? ''} placeholder="Choose a data table…" options={(tables as any[]).map((t) => ({ value: t.id, label: t.name }))}
        onChange={(v) => onChange({ ...action, table_id: v || undefined, table_name: (tables as any[]).find((t) => t.id === v)?.name })} />
      {action.type !== 'table_create' && action.type !== 'table_list' && (
        <div>
          <Heading>Row id {action.type === 'table_delete' ? '' : '(or use a filter)'}</Heading>
          <VariableInput value={action.row_id ?? ''} extraVariables={placeholders} placeholder="{{row.row_id}}, {{event.row.row_id}}, {{form.request_id}}" ariaLabel="Row id"
            onChange={(v) => onChange({ ...action, row_id: v || undefined }, 'table-row-id')} />
        </div>
      )}
      {action.type !== 'table_list' && action.type !== 'table_create' && state.fields.some((f) => f.type === 'list' && f.list?.selectable) && (
        <label className="block text-2xs">Run it
          <select className={inputClass} value={action.each_selected ?? ''} data-each-selected
            onChange={(e) => onChange({ ...action, each_selected: e.target.value || undefined, ...(e.target.value && !action.row_id ? { row_id: '{{row.row_id}}' } : {}) })}>
            <option value="">Once</option>
            {state.fields.filter((f) => f.type === 'list' && f.list?.selectable).map((f) => <option key={f.key} value={f.key}>Once for each selected row of {f.label || f.key} ({'{{row.<column>}}'})</option>)}
          </select>
        </label>
      )}
      {(action.type === 'table_read' || action.type === 'table_list' || action.type === 'table_update') && (
        <div ref={filterRef}>
          <ActionFilterEditor value={action.filter} columns={columns} placeholders={placeholders} onChange={(filter) => onChange({ ...action, filter })} />
        </div>
      )}
      {reads && <ActionSortEditor sort={action.sort} limit={action.type === 'table_list' ? action.limit : undefined} offset={action.offset} showOffset={action.type === 'table_list'} columns={columns}
        onChange={(patch) => onChange({ ...action, ...patch })} />}
      {writesCells && (
        <section className="space-y-1" aria-label="Column values">
          <Heading>Column values</Heading>
          {columns.filter((c) => c.key !== 'row_id').map((c) => (
            <div key={c.key} className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-1 text-2xs">
              <span className="truncate">{c.label}</span>
              <VariableInput value={action.column_values?.[c.key] ?? ''} extraVariables={placeholders} placeholder="{{form.x}}, {{row.x}} or a value" ariaLabel={`Value for ${c.label}`}
                onChange={(v) => { const next = { ...(action.column_values ?? {}) }; if (v) next[c.key] = v; else delete next[c.key]; onChange({ ...action, column_values: next }, `table-col-${c.key}`) }} />
            </div>
          ))}
        </section>
      )}
      {action.type === 'table_delete' && (
        <VariableInput value={action.confirm_text ?? ''} extraVariables={placeholders} placeholder="Ask first, e.g. Delete {{row.item}}?" ariaLabel="Confirmation question"
          onChange={(v) => onChange({ ...action, confirm_text: v || undefined }, 'table-confirm')} />
      )}
      {(reads || action.type === 'table_create') && (
        <OutputsEditor action={action} state={state} onChange={onChange} resultIsList={action.type === 'table_list'} pickedPath={picked}
          onOpenFilter={() => filterRef.current?.querySelector<HTMLButtonElement>('[data-add-condition]')?.focus()} />
      )}
      {reads && <ActionTestPanel action={action} state={state} onPick={setPicked} />}
      <label className="flex items-start gap-1.5 text-2xs">
        <input type="checkbox" className="mt-0.5 accent-primary" checked={action.open_access === true} onChange={(e) => onChange({ ...action, open_access: e.target.checked || undefined })} />
        <span>Everyone who fills in the form may {reads ? 'read' : 'write'} through this step (without data permissions of their own). Off: their own access applies.</span>
      </label>
    </div>
  )
}

/** call_reference's extras: wait or fire and forget, timeout, the response rows' filter / sort / limit, outputs, Test. */
export function CallReferenceExtras({ action, state, placeholders, onChange }: {
  action: FieldButtonAction
  state: DesignerState
  placeholders: Placeholder[]
  onChange: (next: FieldButtonAction, tag?: string) => void
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [rowsOpen, setRowsOpen] = useState(Boolean(action.filter || action.sort || action.limit))
  const wait = action.wait !== false
  return (
    <div className="min-w-0 space-y-2" data-call-reference-extras>
      <div className="flex gap-1" role="radiogroup" aria-label="Wait for the response">
        {([[true, 'Wait for the response'], [false, 'Send without waiting']] as const).map(([v, label]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={wait === v} onClick={() => onChange({ ...action, wait: v ? undefined : false })}
            className={cn('h-7 flex-1 rounded border text-2xs font-medium', wait === v ? 'border-primary bg-primary-wash text-primary-text' : 'border-border')}>{label}</button>
        ))}
      </div>
      <p className="text-2xs text-fg-muted">{wait ? 'The button shows it is busy until the answer is back; the outputs and on-success steps then run.' : 'Queued on the server; the form shows “Sent” and goes on (nothing is written back).'}</p>
      <label className="block text-2xs">Timeout (seconds)
        <input type="number" min={1} max={30} className={inputClass} value={action.timeout_ms ? action.timeout_ms / 1000 : ''} placeholder="10"
          onChange={(e) => onChange({ ...action, timeout_ms: e.target.value ? Math.round(Number(e.target.value) * 1000) : undefined })} />
      </label>
      {wait && (
        <>
          <button type="button" className="text-2xs font-medium text-primary-text" aria-expanded={rowsOpen} onClick={() => setRowsOpen(!rowsOpen)}>{rowsOpen ? '−' : '+'} Filter, sort or limit the response&apos;s rows</button>
          {rowsOpen && (
            <div className="space-y-1.5 rounded border border-border p-1.5" data-reference-rows>
              <label className="block text-2xs">Rows at (path of the list in the response)
                <input className={`${inputClass} font-mono`} value={action.rows_path ?? ''} placeholder="(the response itself) — e.g. data.items" onChange={(e) => onChange({ ...action, rows_path: e.target.value || undefined })} />
              </label>
              <ActionFilterEditor value={action.filter} columns={[]} placeholders={placeholders} onChange={(filter) => onChange({ ...action, filter })} label="Keep rows where" />
              <ActionSortEditor sort={action.sort} limit={action.limit} columns={[]} onChange={(patch) => onChange({ ...action, ...patch })} />
            </div>
          )}
          <OutputsEditor action={action} state={state} onChange={onChange} resultIsList={Boolean(action.rows_path !== undefined || action.filter || action.sort || action.limit)} pickedPath={picked} onOpenFilter={() => setRowsOpen(true)} />
          <ActionTestPanel action={action} state={state} onPick={setPicked} />
        </>
      )}
    </div>
  )
}
