'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Wand2, X } from 'lucide-react'
import type { DesignerField } from '@/lib/forms/designer-state'
import {
  LIST_COLUMN_TYPES, LIST_COLUMN_TYPE_LABELS, LIST_DISPLAYS, LIST_DISPLAY_LABELS, LIST_ENTRY_MODES, LIST_ENTRY_MODE_LABELS, LIST_LIMITS,
  LIST_PENDING_MODES, LIST_PENDING_MODE_LABELS, LIST_TOTAL_FNS, LIST_TOTAL_FN_LABELS, isNumericColumn, listConfigProblem, listCountKey, listTotalKey,
  type ListColumn, type ListColumnType, type ListFieldConfig, type ListTotal,
} from '@/lib/forms/list-field'
import type { LookupConfig } from '@/lib/forms/lookup'
import { cn } from '@/lib/utils'
import { designerInputClass as inputClass } from './designer-controls'

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}

function num(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'c_$1').slice(0, 64)
}

function clean<T extends object>(obj: T): T {
  const out = { ...obj } as Record<string, unknown>
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key]
  return out as T
}

/**
 * The List field's settings (lib/forms/list-field.ts): the columns (add,
 * reorder, remove; type, required, options, bounds, default, formula), how
 * rows are entered, row limits, totals and how rows show on phones.
 */
/** The "New → fill → Commit" kit (lib/forms/row-rules.ts rowCommitKit), for a List or an editable Data table. */
export function RowCommitKitPanel({ table, disabled, onAdd }: { table?: boolean; disabled?: boolean; onAdd: (options: { apply: 'change' | 'button'; save: 'stage' | 'save_now' }) => void }) {
  const [apply, setApply] = useState<'change' | 'button'>('change')
  const [save, setSave] = useState<'stage' | 'save_now'>('stage')
  return (
    <div className="rounded border border-dashed border-border p-2" data-row-commit-kit>
      <label className="mb-1 block text-2xs">Inputs fill the current row
        <select className={inputClass} value={apply} onChange={(e) => setApply(e.target.value as typeof apply)} data-row-kit-apply>
          <option value="change">As they change</option>
          <option value="button">With an Apply button</option>
        </select>
      </label>
      {table && (
        <label className="mb-1 block text-2xs">Save row
          <select className={inputClass} value={save} onChange={(e) => setSave(e.target.value as typeof save)} data-row-kit-save>
            <option value="stage">Stages the row (written with the form)</option>
            <option value="save_now">Saves it to the table now</option>
          </select>
        </label>
      )}
      <button type="button" disabled={disabled} onClick={() => onAdd({ apply, save })} className="flex items-center gap-1.5 text-2xs font-semibold text-primary-text disabled:opacity-40" data-row-add-commit-kit>
        <Wand2 size={12} aria-hidden /> Add a “New row → fill → Save row” pattern
      </button>
      <p className="mt-1 text-2xs text-fg-muted">Creates inputs for the columns people fill (read-only ones are left to their defaults), a New row button, {apply === 'button' ? 'an Apply button, ' : ''}a Save row button that commits the row, and their rules.</p>
    </div>
  )
}

export function ListProperties({ field, onPatch, onAddEntryKit, ruleCount = 0, renderLookup, onAddCommitKit }: {
  /** "New row → fill → Save row" (lib/forms/designer-state.ts addRowCommitKit). */
  onAddCommitKit?: (options: { apply: 'change' | 'button'; save: 'stage' | 'save_now' }) => void
  /** A lookup column's source editor (the Autocomplete field's own panel). */
  renderLookup?: (column: ListColumn, onLookup: (lookup: LookupConfig) => void) => React.ReactNode
  field: DesignerField
  onPatch: (config: ListFieldConfig, tag?: string) => void
  /** "Add inputs and an Add button with a rule" (lib/forms/designer-state.ts addListEntryKit). */
  onAddEntryKit?: (edit: 'button' | 'row_click' | false, selection?: 'single' | 'multiple') => void
  /** "Add row to list" rules aimed at this list already. */
  ruleCount?: number
}) {
  const config: ListFieldConfig = field.list ?? { columns: [] }
  const id = (name: string) => `lp-${field._id}-${name}`
  const [open, setOpen] = useState<number | null>(null)
  const [kitEdit, setKitEdit] = useState<'button' | 'row_click' | 'none'>('button')
  const [kitSelect, setKitSelect] = useState<'none' | 'single' | 'multiple'>('none')
  const set = (patch: Partial<ListFieldConfig>, tag?: string) => onPatch(clean({ ...config, ...patch }), tag)
  const columns = config.columns
  const setColumns = (next: ListColumn[], tag?: string) => {
    const keys = new Set(next.map((c) => c.key))
    set({ columns: next, totals: config.totals?.filter((t) => keys.has(t.column)) }, tag)
  }
  const setColumn = (index: number, patch: Partial<ListColumn>, tag?: string) => setColumns(columns.map((c, i) => (i === index ? clean({ ...c, ...patch }) : c)), tag)
  const addColumn = () => {
    if (columns.length >= LIST_LIMITS.columns) return
    let n = columns.length + 1
    while (columns.some((c) => c.key === `column_${n}`)) n++
    setColumns([...columns, { key: `column_${n}`, label: `Column ${n}`, type: 'text' }])
    setOpen(columns.length)
  }
  const move = (index: number, by: number) => {
    const next = [...columns]
    const [moved] = next.splice(index, 1)
    next.splice(index + by, 0, moved)
    setColumns(next)
    if (open === index) setOpen(index + by)
  }
  const totals = config.totals ?? []
  const setTotals = (next: ListTotal[]) => set({ totals: next.length ? next : undefined })
  const totalable = columns.filter((c) => isNumericColumn(c))
  const problem = listConfigProblem(config)
  const mode = config.entry_mode === 'inline' ? 'inline' : 'view'

  return (
    <fieldset className="min-w-0 space-y-3 border-t pt-3 border-border" data-list-properties>
      <legend className="pr-2 text-2xs font-semibold text-fg-muted">Rows</legend>

      <div>
        <Label>How people add rows</Label>
        <div className="flex gap-1" role="radiogroup" aria-label="How people add rows">
          {LIST_ENTRY_MODES.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => set({ entry_mode: m === 'inline' ? 'inline' : undefined })}
              className={cn('h-7 flex-1 rounded border px-1 text-2xs font-medium', mode === m ? 'border-primary bg-primary-wash text-primary-text' : 'border-border text-fg')}>
              {LIST_ENTRY_MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-2xs text-fg-muted">{mode === 'view' ? 'The list shows the rows (people can remove them). A form rule “Add row to list” adds rows from inputs on the form — usually on an “Add” button.' : 'An editable table: Add row appends a blank row edited in place.'}</p>
      </div>

      {mode === 'view' && onAddEntryKit && (
        <div className="rounded border border-dashed border-border p-2" data-list-kit>
          <label className="mb-1 block text-2xs">Row selection
            <select className={inputClass} value={kitSelect} onChange={(e) => setKitSelect(e.target.value as typeof kitSelect)} data-list-kit-selection>
              <option value="none">None</option>
              <option value="single">One row (Edit / Delete selected, Clear list)</option>
              <option value="multiple">Several rows, with checkboxes (Edit / Delete selected, Clear list)</option>
            </select>
          </label>
          {kitSelect === 'none' && <label className="mb-1 block text-2xs">Editing rows already in the list
            <select className={inputClass} value={kitEdit} onChange={(e) => setKitEdit(e.target.value as typeof kitEdit)} data-list-kit-edit>
              <option value="button">An Edit button on each row</option>
              <option value="row_click">Click a row to edit it</option>
              <option value="none">No editing</option>
            </select>
          </label>}
          <button type="button" onClick={() => onAddEntryKit(kitEdit === 'none' ? false : kitEdit, kitSelect === 'none' ? undefined : kitSelect)} disabled={Boolean(problem)} className="flex items-center gap-1.5 text-2xs font-semibold text-primary-text disabled:opacity-40" data-list-add-kit>
            <Wand2 size={12} aria-hidden /> Add inputs and an “Add” button with a rule
          </button>
          <p className="mt-1 text-2xs text-fg-muted">
            {ruleCount ? `${ruleCount} rule${ruleCount === 1 ? '' : 's'} already add${ruleCount === 1 ? 's' : ''} rows to this list (Rules tab). ` : ''}
            Creates one input per column above the list, an “Add” button and the rule that turns the inputs into a row. Change any of it afterwards.
          </p>
        </div>
      )}

      {onAddCommitKit && <RowCommitKitPanel disabled={Boolean(problem)} onAdd={onAddCommitKit} />}

      <div className="space-y-1" data-list-pending-settings>
        <Label htmlFor={id('pending')}>Pending rows at submit (made by a rule&apos;s New row / Set row values, not committed)</Label>
        <select id={id('pending')} className={inputClass} value={config.on_submit_pending ?? 'block'} onChange={(e) => set({ on_submit_pending: e.target.value === 'block' ? undefined : e.target.value as ListFieldConfig['on_submit_pending'] })} data-list-on-submit-pending>
          {LIST_PENDING_MODES.map((m) => <option key={m} value={m}>{LIST_PENDING_MODE_LABELS[m]}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-2xs">
          <input className="accent-primary" type="checkbox" checked={config.row_commit_controls === true} onChange={(e) => set({ row_commit_controls: e.target.checked || undefined })} data-list-commit-controls />
          ✓ Commit / ✕ Discard on pending rows
        </label>
        <Label htmlFor={id('keycol')}>Row key column (rows the form opens with keep their read-only values)</Label>
        <select id={id('keycol')} className={inputClass} value={config.key_column ?? ''} onChange={(e) => set({ key_column: e.target.value || undefined })} data-list-key-column>
          <option value="">None</option>
          {columns.filter((c) => c.type !== 'calculated').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <p className="text-2xs text-fg-muted">Rules read {`{{form.${field.key}_current_row.<column>}}`}, {`{{form.${field.key}_current_index}}`} and {`{{form.${field.key}_pending_count}}`}.</p>
      </div>

      <div className="grid grid-cols-2 gap-1">
        <div>
          <Label htmlFor={id('min')}>At least (rows)</Label>
          <input id={id('min')} type="number" min={0} max={LIST_LIMITS.rows} className={inputClass} placeholder={field.required ? '1' : '0'}
            value={config.min_rows ?? ''} onChange={(e) => set({ min_rows: num(e.target.value) }, `lmin-${field._id}`)} />
        </div>
        <div>
          <Label htmlFor={id('max')}>At most (rows)</Label>
          <input id={id('max')} type="number" min={1} max={LIST_LIMITS.rows} className={inputClass} placeholder={String(LIST_LIMITS.rows)}
            value={config.max_rows ?? ''} onChange={(e) => set({ max_rows: num(e.target.value) }, `lmax-${field._id}`)} />
        </div>
      </div>

      <div>
        <Label htmlFor={id('display')}>Show rows as</Label>
        <select id={id('display')} className={inputClass} value={config.display ?? 'auto'} onChange={(e) => set({ display: e.target.value === 'auto' ? undefined : e.target.value as ListFieldConfig['display'] })}>
          {LIST_DISPLAYS.map((d) => <option key={d} value={d}>{LIST_DISPLAY_LABELS[d]}</option>)}
        </select>
      </div>

      <div className="space-y-1" data-list-columns>
        <Label>Columns</Label>
        {columns.map((column, i) => {
          const expanded = open === i
          const cid = (name: string) => id(`c${i}-${name}`)
          return (
            <div key={i} className="rounded border border-border" data-list-column={column.key}>
              <div className="flex items-center gap-1 p-1">
                <button type="button" className="rounded p-0.5" aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} column ${column.label}`} onClick={() => setOpen(expanded ? null : i)}>
                  {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <input aria-label={`Column ${i + 1} label`} className={cn(inputClass, 'flex-1')} value={column.label}
                  onChange={(e) => {
                    const label = e.target.value
                    const auto = column.key === slug(column.label) || /^column_\d+$/.test(column.key)
                    const key = auto ? slug(label) : column.key
                    setColumn(i, { label, ...(auto && key && !columns.some((c, j) => j !== i && c.key === key) ? { key } : {}) }, `lcl-${field._id}-${i}`)
                  }} />
                <select aria-label={`Column ${i + 1} type`} className={cn(inputClass, 'w-24 flex-none')} value={column.type}
                  onChange={(e) => {
                    const type = e.target.value as ListColumnType
                    setColumn(i, {
                      type,
                      options: type === 'choice' ? (column.options?.length ? column.options : ['Option 1', 'Option 2']) : undefined,
                      option_labels: type === 'choice' ? column.option_labels : undefined,
                      formula: type === 'calculated' ? (column.formula ?? '') : undefined,
                      lookup: type === 'lookup' ? (column.lookup ?? { source: 'table' }) : undefined,
                      required: type === 'calculated' || type === 'boolean' ? undefined : column.required,
                    })
                  }}>
                  {LIST_COLUMN_TYPES.map((t) => <option key={t} value={t}>{LIST_COLUMN_TYPE_LABELS[t]}</option>)}
                </select>
                <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={i === 0} aria-label={`Move column ${column.label} up`} onClick={() => move(i, -1)}><ArrowUp size={11} /></button>
                <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={i === columns.length - 1} aria-label={`Move column ${column.label} down`} onClick={() => move(i, 1)}><ArrowDown size={11} /></button>
                <button type="button" className="rounded p-0.5" aria-label={`Remove column ${column.label}`} onClick={() => { setColumns(columns.filter((_, j) => j !== i)); setOpen(null) }}><X size={11} /></button>
              </div>
              {expanded && (
                <div className="space-y-2 border-t border-border p-2">
                  <div>
                    <Label htmlFor={cid('key')}>Key</Label>
                    <input id={cid('key')} className={`${inputClass} font-mono`} value={column.key}
                      onChange={(e) => setColumn(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64) }, `lck-${field._id}-${i}`)} />
                    <p className="mt-0.5 text-2xs text-fg-muted">In a loop: <code className="text-primary-text">{`{{item.${column.key}}}`}</code></p>
                  </div>
                  <label className="flex items-center gap-1.5 text-2xs">
                    <input className="accent-primary" type="checkbox" checked={column.hidden === true} onChange={(e) => setColumn(i, { hidden: e.target.checked || undefined })} />
                    Hidden (a link key a rule sets — e.g. the id of another List&apos;s row)
                  </label>
                  {column.type !== 'calculated' && column.type !== 'boolean' && (
                    <label className="flex items-center gap-1.5 text-2xs">
                      <input className="accent-primary" type="checkbox" checked={column.required === true} onChange={(e) => setColumn(i, { required: e.target.checked || undefined })} />
                      Required in every row
                    </label>
                  )}
                  {column.type !== 'calculated' && (
                    <div>
                      <label className="flex items-center gap-1.5 text-2xs">
                        <input className="accent-primary" type="checkbox" checked={column.read_only === true} onChange={(e) => setColumn(i, { read_only: e.target.checked || undefined })} data-list-column-readonly />
                        Read-only when editing
                      </label>
                      {column.read_only && <p className="mt-0.5 text-2xs text-fg-muted">A row already in the list keeps this value: its cell isn&apos;t editable, an Edit row input for it is locked, and rules (Set row values, Update a row) leave it alone. A new row takes it from the default (or a rule) before its first commit.</p>}
                    </div>
                  )}
                  {column.type === 'calculated' ? (
                    <div>
                      <Label htmlFor={cid('formula')}>Formula</Label>
                      <input id={cid('formula')} className={`${inputClass} font-mono`} placeholder="quantity * unit_price" value={column.formula ?? ''}
                        onChange={(e) => setColumn(i, { formula: e.target.value || undefined }, `lcf-${field._id}-${i}`)} />
                      <p className="mt-0.5 text-2xs text-fg-muted">Number column keys, numbers, + − × ÷ and brackets. Worked out on the server too.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-1">
                      {column.type !== 'boolean' && (
                        <div>
                          <Label htmlFor={cid('ph')}>Placeholder</Label>
                          <input id={cid('ph')} className={inputClass} value={column.placeholder ?? ''} onChange={(e) => setColumn(i, { placeholder: e.target.value || undefined }, `lcp-${field._id}-${i}`)} />
                        </div>
                      )}
                      <div>
                        <Label htmlFor={cid('def')}>Default</Label>
                        {column.type === 'boolean'
                          ? <select id={cid('def')} className={inputClass} value={column.default ?? ''} onChange={(e) => setColumn(i, { default: e.target.value || undefined })}><option value="">Unticked</option><option value="true">Ticked</option></select>
                          : <input id={cid('def')} className={inputClass} value={column.default ?? ''} onChange={(e) => setColumn(i, { default: e.target.value || undefined }, `lcd-${field._id}-${i}`)} />}
                      </div>
                    </div>
                  )}
                  {(isNumericColumn(column) || column.type === 'text' || column.type === 'textarea' || column.type === 'email') && (
                    <div className="grid grid-cols-2 gap-1">
                      <div>
                        <Label htmlFor={cid('min')}>{isNumericColumn(column) ? 'Minimum' : 'Min length'}</Label>
                        <input id={cid('min')} type="number" className={inputClass} value={column.min ?? ''} onChange={(e) => setColumn(i, { min: num(e.target.value) }, `lcmin-${field._id}-${i}`)} />
                      </div>
                      <div>
                        <Label htmlFor={cid('max')}>{isNumericColumn(column) ? 'Maximum' : 'Max length'}</Label>
                        <input id={cid('max')} type="number" className={inputClass} value={column.max ?? ''} onChange={(e) => setColumn(i, { max: num(e.target.value) }, `lcmax-${field._id}-${i}`)} />
                      </div>
                    </div>
                  )}
                  {(column.type === 'currency' || column.type === 'calculated') && (
                    <div>
                      <Label htmlFor={cid('cur')}>Currency {column.type === 'calculated' && <span className="font-normal">(optional)</span>}</Label>
                      <input id={cid('cur')} className={`${inputClass} font-mono uppercase`} maxLength={3} placeholder={column.type === 'currency' ? 'USD' : ''} value={column.currency ?? ''}
                        onChange={(e) => setColumn(i, { currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') || undefined }, `lcc-${field._id}-${i}`)} />
                    </div>
                  )}
                  {column.type === 'lookup' && renderLookup && (
                    <div className="rounded border border-border p-1.5" data-list-lookup-column={column.key}>
                      <p className="mb-1 text-2xs text-fg-muted">The cell stores the chosen value and its label ({`{{item.${column.key}}}`}, {`{{item.${column.key}_label}}`}). Filters and inputs may read the same row ({'{{row.<column>}}'}) or the form ({'{{task_data.<field>}}'}).</p>
                      {renderLookup(column, (lookup) => setColumn(i, { lookup }, `lclk-${field._id}-${i}`))}
                    </div>
                  )}
                  {column.type === 'choice' && (
                    <div>
                      <Label htmlFor={cid('opts')}>Options (one per line)</Label>
                      <textarea id={cid('opts')} rows={3} className="w-full rounded-md border border-input-border bg-input px-2 py-1 text-xs" value={(column.options ?? []).join('\n')}
                        onChange={(e) => setColumn(i, { options: e.target.value.split('\n').map((o) => o.trimStart()).filter((o, j, all) => o !== '' || j === all.length - 1) }, `lco-${field._id}-${i}`)} />
                    </div>
                  )}
                  <div>
                    <Label htmlFor={cid('help')}>Help text</Label>
                    <input id={cid('help')} className={inputClass} value={column.help_text ?? ''} onChange={(e) => setColumn(i, { help_text: e.target.value || undefined }, `lch-${field._id}-${i}`)} />
                  </div>
                </div>
              )}
            </div>
          )
        })}
        <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text disabled:opacity-40" disabled={columns.length >= LIST_LIMITS.columns} onClick={addColumn} data-list-add-column>
          <Plus size={11} /> Add column
        </button>
      </div>

      {mode === 'view' && (
        <div className="space-y-1">
          <label className="block text-2xs">Row selection
            <select className={inputClass} value={config.selectable ?? ''} onChange={(e) => set({ selectable: (e.target.value || undefined) as ListFieldConfig['selectable'] })} data-list-selectable>
              <option value="">None</option>
              <option value="single">One row (click or tap)</option>
              <option value="multiple">Several rows (checkboxes, select all)</option>
            </select>
          </label>
          {config.selectable && <p className="text-2xs text-fg-muted">A click selects (a row click doesn&apos;t fire). Rules read {`{{form.${field.key}_selected}}`}, {`{{form.${field.key}_selected_row.<column>}}`} and {`{{form.${field.key}_selected_count}}`}; list actions can target the selected rows.</p>}
          <label className="flex items-center gap-1.5 text-2xs">
            <input className="accent-primary" type="checkbox" checked={config.row_click === true} onChange={(e) => set({ row_click: e.target.checked || undefined })} data-list-row-click-toggle />
            A click on a row fires “List: row clicked” (e.g. load it into the inputs to edit)
          </label>
          <label className="flex items-center gap-1.5 text-2xs">
            <input className="accent-primary" type="checkbox" checked={config.inline_edit === true} onChange={(e) => set({ inline_edit: e.target.checked || undefined })} data-list-inline-edit-toggle />
            Edit cells in place (rows still come from rules)
          </label>
        </div>
      )}
      {mode === 'view' && (
        <div className="space-y-1" data-list-row-buttons-editor>
          <Label>Buttons on each row</Label>
          {(config.row_buttons ?? []).map((b, i) => (
            <div key={i} className="flex items-center gap-1">
              <input aria-label={`Row button ${i + 1} label`} className={cn(inputClass, 'flex-1')} value={b.label}
                onChange={(e) => set({ row_buttons: (config.row_buttons ?? []).map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }, `lrb-${field._id}-${i}`)} />
              <input aria-label={`Row button ${i + 1} id`} className={cn(inputClass, 'w-24 flex-none font-mono')} value={b.id}
                onChange={(e) => set({ row_buttons: (config.row_buttons ?? []).map((x, j) => (j === i ? { ...x, id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') } : x)) }, `lrbi-${field._id}-${i}`)} />
              <select aria-label={`Row button ${i + 1} style`} className={cn(inputClass, 'w-20 flex-none')} value={b.style ?? 'default'}
                onChange={(e) => set({ row_buttons: (config.row_buttons ?? []).map((x, j) => (j === i ? { ...x, style: e.target.value === 'danger' ? 'danger' : undefined } : x)) })}>
                <option value="default">Default</option><option value="danger">Danger</option>
              </select>
              <button type="button" className="rounded p-0.5" aria-label={`Remove row button ${i + 1}`} onClick={() => { const next = (config.row_buttons ?? []).filter((_, j) => j !== i); set({ row_buttons: next.length ? next : undefined }) }}><X size={11} /></button>
            </div>
          ))}
          {(config.row_buttons ?? []).length < 4 && (
            <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" onClick={() => { const n = (config.row_buttons ?? []).length + 1; set({ row_buttons: [...(config.row_buttons ?? []), { id: `action_${n}`, label: `Action ${n}` }] }) }}>
              <Plus size={11} /> Add row button
            </button>
          )}
          <p className="text-2xs text-fg-muted">A press fires the rule event <em>List: row button clicked</em> (event.button = the id) with the row as {'{{row.<column>}}'} and its position as {'{{event.row_number}}'}.</p>
        </div>
      )}

      <div className="space-y-1" data-list-totals-editor>
        <Label>Totals under the list</Label>
        {totals.map((total, i) => (
          <div key={i} className="flex items-center gap-1">
            <select aria-label={`Total ${i + 1} function`} className={cn(inputClass, 'w-24 flex-none')} value={total.fn}
              onChange={(e) => setTotals(totals.map((t, j) => (j === i ? { ...t, fn: e.target.value as ListTotal['fn'] } : t)))}>
              {LIST_TOTAL_FNS.map((fn) => <option key={fn} value={fn}>{LIST_TOTAL_FN_LABELS[fn]}</option>)}
            </select>
            <select aria-label={`Total ${i + 1} column`} className={cn(inputClass, 'flex-1')} value={total.column}
              onChange={(e) => setTotals(totals.map((t, j) => (j === i ? { ...t, column: e.target.value } : t)))}>
              {(total.fn === 'count' ? columns : totalable).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <button type="button" className="rounded p-0.5" aria-label={`Remove total ${i + 1}`} onClick={() => setTotals(totals.filter((_, j) => j !== i))}><X size={11} /></button>
          </div>
        ))}
        {totalable.length > 0 && (
          <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" onClick={() => setTotals([...totals, { column: totalable[totalable.length - 1].key, fn: 'sum' }])}>
            <Plus size={11} /> Add total
          </button>
        )}
      </div>

      <p className={cn('text-2xs', problem ? 'text-danger' : 'text-fg-muted')} data-list-problem={problem ? '' : undefined}>
        {problem ?? (
          <>Downstream: a list of rows — loop over <code className="text-primary-text">{`{{form.${field.key}}}`}</code> and use <code className="text-primary-text">{'{{item.<column>}}'}</code>; <code className="text-primary-text">{`{{form.${listCountKey(field.key)}}}`}</code>{totals.map((t) => <span key={`${t.fn}${t.column}`}>, <code className="text-primary-text">{`{{form.${listTotalKey(field.key, t)}}}`}</code></span>)}.</>
        )}
      </p>
    </fieldset>
  )
}
