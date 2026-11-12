'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Wand2, X } from 'lucide-react'
import type { DesignerField } from '@/lib/forms/designer-state'
import {
  LIST_COLUMN_TYPES, LIST_COLUMN_TYPE_LABELS, LIST_MAX_DEPTH, LIST_DISPLAYS, LIST_DISPLAY_LABELS, LIST_ENTRY_MODES, LIST_ENTRY_MODE_LABELS, LIST_LIMITS,
  LIST_PENDING_MODES, LIST_PENDING_MODE_LABELS, LIST_ROW_EDITINGS, LIST_ROW_EDITING_LABELS, LIST_TOTAL_FNS, LIST_TOTAL_FN_LABELS, isNumericColumn, listConfigProblem, listCountKey, listTotalKey,
  type ListColumn, type ListColumnType, type ListFieldConfig, type ListRowFormConfig, type ListRowFormItem, type ListRowValidation, type ListTotal, type ListValidation,
} from '@/lib/forms/list-field'
import { GroupEditor } from './data-table-properties'
import { CellRulesEditor, ControlTextStyleEditor, RowStylesEditor } from './style-editor'
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

export function ListProperties({ field, onPatch, onAddEntryKit, ruleCount = 0, renderLookup, onAddCommitKit, formFields = [] }: {
  /** The form's value fields (List validations may test `form.<field>`). */
  formFields?: FormFieldRef[]
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
  const [kitEdit, setKitEdit] = useState<'button' | 'row_click' | 'none'>('button')
  const [kitSelect, setKitSelect] = useState<'none' | 'single' | 'multiple'>('none')
  const set = (patch: Partial<ListFieldConfig>, tag?: string) => onPatch(clean({ ...config, ...patch }), tag)
  const columns = config.columns
  const totals = config.totals ?? []
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

      <ListColumnsEditor config={config} onPatch={(next, tag) => onPatch(clean(next), tag)} idBase={id('cols')} tagBase={field._id} depth={1} renderLookup={renderLookup} formFields={formFields} />

      <RowFormEditor config={config} idBase={id('rowform')} tagBase={field._id} onPatch={(next, tag) => onPatch(clean(next), tag)} />

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

      <p className={cn('text-2xs', problem ? 'text-danger' : 'text-fg-muted')} data-list-problem={problem ? '' : undefined}>
        {problem ?? (
          <>Downstream: a list of rows — loop over <code className="text-primary-text">{`{{form.${field.key}}}`}</code> and use <code className="text-primary-text">{'{{item.<column>}}'}</code>; <code className="text-primary-text">{`{{form.${listCountKey(field.key)}}}`}</code>{totals.map((t) => <span key={`${t.fn}${t.column}`}>, <code className="text-primary-text">{`{{form.${listTotalKey(field.key, t)}}}`}</code></span>)}.</>
        )}
      </p>
    </fieldset>
  )
}

/**
 * The row pop-out (lib/forms/list-row-form.ts): how rows are edited (in the
 * table, in a pop-out form, both), the form's title, the order of its
 * fields with section headings, and whether read-only Lists show "View row".
 */
function RowFormEditor({ config, idBase, tagBase, onPatch }: { config: ListFieldConfig; idBase: string; tagBase: string; onPatch: (config: ListFieldConfig, tag?: string) => void }) {
  const form: ListRowFormConfig = config.row_form ?? {}
  const shown = config.columns.filter((c) => !c.hidden)
  const setForm = (patch: Partial<ListRowFormConfig>, tag?: string) => {
    const next = clean({ ...form, ...patch })
    onPatch({ ...config, row_form: Object.keys(next).length ? next : undefined }, tag)
  }
  // The order as it shows: the layout's entries, then the columns it leaves out.
  const listed = (form.layout ?? []).filter((item) => !('column' in item) || shown.some((c) => c.key === item.column))
  const items: ListRowFormItem[] = [...listed, ...shown.filter((c) => !listed.some((i) => 'column' in i && i.column === c.key)).map((c) => ({ column: c.key }))]
  const setLayout = (next: ListRowFormItem[], tag?: string) => setForm({ layout: next.some((i) => 'section' in i) || next.some((i, at) => 'column' in i && i.column !== shown[at]?.key) ? next : undefined }, tag)
  const move = (at: number, by: number) => { const next = [...items]; const [it] = next.splice(at, 1); next.splice(Math.max(0, Math.min(next.length, at + by)), 0, it); setLayout(next) }
  return (
    <div className="space-y-1.5 border-t pt-3 border-border" data-list-row-form-editor>
      <p className="text-2xs font-semibold text-fg-muted">Row pop-out</p>
      <label className="block text-2xs">Editing rows
        <select id={`${idBase}-editing`} className={inputClass} value={config.row_editing ?? 'both'} onChange={(e) => onPatch({ ...config, row_editing: e.target.value === 'both' ? undefined : e.target.value as ListFieldConfig['row_editing'] })} data-list-row-editing>
          {LIST_ROW_EDITINGS.map((m) => <option key={m} value={m}>{LIST_ROW_EDITING_LABELS[m]}</option>)}
        </select>
      </label>
      <p className="text-2xs text-fg-muted">The pop-out shows a row as a form (one column on phones, two on wider screens); phones use it whenever it is allowed. Read-only lists (submissions, completed tasks) always offer “View row”.</p>
      <label className="block text-2xs">Title
        <input id={`${idBase}-title`} className={inputClass} value={form.title ?? ''} placeholder="Expense: {{row.description}}" onChange={(e) => setForm({ title: e.target.value || undefined }, `lrft-${tagBase}`)} data-list-row-form-title />
      </label>
      <div className="space-y-0.5" data-list-row-form-layout>
        <p className="text-2xs font-medium text-fg-muted">Field order</p>
        {items.map((item, at) => (
          <div key={'column' in item ? `c-${item.column}` : `s-${at}`} className="flex items-center gap-1">
            {'column' in item
              ? <span className="min-w-0 flex-1 truncate text-2xs">{shown.find((c) => c.key === item.column)?.label ?? item.column}</span>
              : <input aria-label={`Section heading ${at + 1}`} className={cn(inputClass, 'flex-1 font-semibold')} value={item.section} onChange={(e) => setLayout(items.map((x, j) => (j === at ? { section: e.target.value } : x)), `lrfs-${tagBase}-${at}`)} />}
            <button type="button" className="rounded p-0.5 disabled:opacity-30" aria-label="Move up" disabled={at === 0} onClick={() => move(at, -1)}><ArrowUp size={11} /></button>
            <button type="button" className="rounded p-0.5 disabled:opacity-30" aria-label="Move down" disabled={at === items.length - 1} onClick={() => move(at, 1)}><ArrowDown size={11} /></button>
            {'section' in item && <button type="button" className="rounded p-0.5" aria-label={`Remove section heading ${at + 1}`} onClick={() => setLayout(items.filter((_, j) => j !== at))}><X size={11} /></button>}
          </div>
        ))}
        <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" onClick={() => setLayout([{ section: 'Details' }, ...items])} data-list-row-form-add-section>
          <Plus size={11} /> Add section heading
        </button>
      </div>
      <label className="flex items-center gap-1.5 text-2xs">
        <input className="accent-primary" type="checkbox" checked={form.hide_view_icon === true} onChange={(e) => setForm({ hide_view_icon: e.target.checked || undefined })} data-list-row-form-hide-view />
        Hide “View row” on read-only lists
      </label>
    </div>
  )
}

/**
 * A List level's columns and totals (the field's List, or a nested List —
 * `depth` 2 / 3 — inside a column of type list).
 */
function ListColumnsEditor({ config, onPatch, idBase, tagBase, depth, renderLookup, formFields = [], parentColumns }: {
  formFields?: FormFieldRef[]
  /** A nested List: the parent level's columns (`parent.<column>` in validations). */
  parentColumns?: ListColumn[]
  config: ListFieldConfig
  onPatch: (config: ListFieldConfig, tag?: string) => void
  idBase: string
  tagBase: string
  depth: number
  renderLookup?: (column: ListColumn, onLookup: (lookup: LookupConfig) => void) => React.ReactNode
}) {
  const [open, setOpen] = useState<number | null>(null)
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
  const subjects = validationSubjects(columns, parentColumns, formFields)
  return (
    <>
      <div className="space-y-1" data-list-columns>
        <Label>Columns</Label>
        {columns.map((column, i) => {
          const expanded = open === i
          const cid = (name: string) => `${idBase}-c${i}-${name}`
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
                    setColumn(i, { label, ...(auto && key && !columns.some((c, j) => j !== i && c.key === key) ? { key } : {}) }, `lcl-${tagBase}-${i}`)
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
                      list: type === 'list' ? (column.list ?? { columns: [{ key: 'item', label: 'Item', type: 'text' }] }) : undefined,
                      default: type === 'list' ? undefined : column.default,
                      placeholder: type === 'list' ? undefined : column.placeholder,
                      required: type === 'calculated' || type === 'boolean' ? undefined : column.required,
                    })
                  }}>
                  {LIST_COLUMN_TYPES.filter((t) => t !== 'list' || depth < LIST_MAX_DEPTH || column.type === 'list').map((t) => <option key={t} value={t}>{LIST_COLUMN_TYPE_LABELS[t]}</option>)}
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
                      onChange={(e) => setColumn(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64) }, `lck-${tagBase}-${i}`)} />
                    <p className="mt-0.5 text-2xs text-fg-muted">In a loop: <code className="text-primary-text">{`{{item.${column.key}}}`}</code>{column.type === 'list' && <> — a list of rows: loop over it inside the outer loop</>}</p>
                  </div>
                  <label className="flex items-center gap-1.5 text-2xs">
                    <input className="accent-primary" type="checkbox" checked={column.hidden === true} onChange={(e) => setColumn(i, { hidden: e.target.checked || undefined })} />
                    Hidden (a link key a rule sets — e.g. the id of another List&apos;s row)
                  </label>
                  {column.type !== 'calculated' && column.type !== 'boolean' && (
                    <label className="flex items-center gap-1.5 text-2xs">
                      <input className="accent-primary" type="checkbox" checked={column.required === true} onChange={(e) => setColumn(i, { required: e.target.checked || undefined })} />
                      {column.type === 'list' ? 'At least one row under every row' : 'Required in every row'}
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
                  {column.type === 'list' ? (
                    <NestedListSettings column={column} depth={depth} idBase={`${idBase}-c${i}`} tagBase={`${tagBase}-${i}`} renderLookup={renderLookup} formFields={formFields} parentColumns={columns}
                      onList={(list, tag) => setColumn(i, { list }, tag)} />
                  ) : column.type === 'calculated' ? (
                    <div>
                      <Label htmlFor={cid('formula')}>Formula</Label>
                      <input id={cid('formula')} className={`${inputClass} font-mono`} placeholder="quantity * unit_price" value={column.formula ?? ''}
                        onChange={(e) => setColumn(i, { formula: e.target.value || undefined }, `lcf-${tagBase}-${i}`)} />
                      <p className="mt-0.5 text-2xs text-fg-muted">Number column keys, numbers, + − × ÷ and brackets. Worked out on the server too.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-1">
                      {column.type !== 'boolean' && (
                        <div>
                          <Label htmlFor={cid('ph')}>Placeholder</Label>
                          <input id={cid('ph')} className={inputClass} value={column.placeholder ?? ''} onChange={(e) => setColumn(i, { placeholder: e.target.value || undefined }, `lcp-${tagBase}-${i}`)} />
                        </div>
                      )}
                      <div>
                        <Label htmlFor={cid('def')}>Default</Label>
                        {column.type === 'boolean'
                          ? <select id={cid('def')} className={inputClass} value={column.default ?? ''} onChange={(e) => setColumn(i, { default: e.target.value || undefined })}><option value="">Unticked</option><option value="true">Ticked</option></select>
                          : <input id={cid('def')} className={inputClass} value={column.default ?? ''} onChange={(e) => setColumn(i, { default: e.target.value || undefined }, `lcd-${tagBase}-${i}`)} />}
                      </div>
                    </div>
                  )}
                  {(isNumericColumn(column) || column.type === 'text' || column.type === 'textarea' || column.type === 'email') && (
                    <div className="grid grid-cols-2 gap-1">
                      <div>
                        <Label htmlFor={cid('min')}>{isNumericColumn(column) ? 'Minimum' : 'Min length'}</Label>
                        <input id={cid('min')} type="number" className={inputClass} value={column.min ?? ''} onChange={(e) => setColumn(i, { min: num(e.target.value) }, `lcmin-${tagBase}-${i}`)} />
                      </div>
                      <div>
                        <Label htmlFor={cid('max')}>{isNumericColumn(column) ? 'Maximum' : 'Max length'}</Label>
                        <input id={cid('max')} type="number" className={inputClass} value={column.max ?? ''} onChange={(e) => setColumn(i, { max: num(e.target.value) }, `lcmax-${tagBase}-${i}`)} />
                      </div>
                    </div>
                  )}
                  {(column.type === 'currency' || column.type === 'calculated') && (
                    <div>
                      <Label htmlFor={cid('cur')}>Currency {column.type === 'calculated' && <span className="font-normal">(optional)</span>}</Label>
                      <input id={cid('cur')} className={`${inputClass} font-mono uppercase`} maxLength={3} placeholder={column.type === 'currency' ? 'USD' : ''} value={column.currency ?? ''}
                        onChange={(e) => setColumn(i, { currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') || undefined }, `lcc-${tagBase}-${i}`)} />
                    </div>
                  )}
                  {column.type === 'lookup' && renderLookup && (
                    <div className="rounded border border-border p-1.5" data-list-lookup-column={column.key}>
                      <p className="mb-1 text-2xs text-fg-muted">The cell stores the chosen value and its label ({`{{item.${column.key}}}`}, {`{{item.${column.key}_label}}`}). Filters and inputs may read the same row ({'{{row.<column>}}'}) or the form ({'{{task_data.<field>}}'}).</p>
                      {renderLookup(column, (lookup) => setColumn(i, { lookup }, `lclk-${tagBase}-${i}`))}
                    </div>
                  )}
                  {column.type === 'choice' && (
                    <div>
                      <Label htmlFor={cid('opts')}>Options (one per line)</Label>
                      <textarea id={cid('opts')} rows={3} className="w-full rounded-md border border-input-border bg-input px-2 py-1 text-xs" value={(column.options ?? []).join('\n')}
                        onChange={(e) => setColumn(i, { options: e.target.value.split('\n').map((o) => o.trimStart()).filter((o, j, all) => o !== '' || j === all.length - 1) }, `lco-${tagBase}-${i}`)} />
                    </div>
                  )}
                  <div>
                    <Label htmlFor={cid('help')}>Help text</Label>
                    <input id={cid('help')} className={inputClass} value={column.help_text ?? ''} onChange={(e) => setColumn(i, { help_text: e.target.value || undefined }, `lch-${tagBase}-${i}`)} />
                  </div>
                  {column.type !== 'list' && (
                    <ValidationsEditor items={column.validations ?? []} subjects={subjects} label="Validation (the message shows on this cell)" idBase={cid('v')} tagBase={`lcv-${tagBase}-${i}`}
                      onChange={(next, tag) => setColumn(i, { validations: next }, tag)} />
                  )}
                  <ControlTextStyleEditor value={column.text_style} idBase={cid('ts')} labelName="Header" valueName="Cells"
                    onChange={(next, tag) => setColumn(i, { text_style: next }, tag ? `lcts-${tagBase}-${i}-${tag}` : undefined)} />
                </div>
              )}
            </div>
          )
        })}
        <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text disabled:opacity-40" disabled={columns.length >= LIST_LIMITS.columns} onClick={addColumn} data-list-add-column>
          <Plus size={11} /> Add column
        </button>
      </div>


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

      <ValidationsEditor items={config.row_validations ?? []} subjects={subjects} columns={columns} rowLevel label="Row checks (an error on the row when the condition holds)" idBase={`${idBase}-rv`} tagBase={`lrv-${tagBase}`}
        onChange={(next, tag) => set({ row_validations: next }, tag)} />

      <RowStylesEditor items={config.row_styles ?? []} subjects={subjects} columns={columns} idBase={`${idBase}-rs`} tagBase={`lrs-${tagBase}`}
        onChange={(next, tag) => set({ row_styles: next }, tag)} />

      <CellRulesEditor items={config.cell_rules ?? []} subjects={subjects} columns={columns} tagBase={`lcr-${tagBase}`}
        onChange={(next, tag) => set({ cell_rules: next }, tag)} />

    </>
  )
}

/** A nested List column's own settings: row limits, its columns (any type; nested once more up to the cap) and totals. */
function NestedListSettings({ column, depth, idBase, tagBase, renderLookup, onList, formFields, parentColumns }: {
  formFields?: FormFieldRef[]
  parentColumns?: ListColumn[]
  column: ListColumn
  depth: number
  idBase: string
  tagBase: string
  renderLookup?: (column: ListColumn, onLookup: (lookup: LookupConfig) => void) => React.ReactNode
  onList: (list: ListFieldConfig, tag?: string) => void
}) {
  const list: ListFieldConfig = column.list ?? { columns: [] }
  const set = (patch: Partial<ListFieldConfig>, tag?: string) => onList(clean({ ...list, ...patch }), tag)
  return (
    <div className="space-y-2 rounded border border-primary/40 bg-primary-wash/20 p-1.5" data-list-nested-editor={column.key}>
      <p className="text-2xs text-fg-muted">Each row has its own rows of {column.label.toLowerCase()} (level {depth + 1} of {LIST_MAX_DEPTH}). In a loop over the list: {`{{item.${column.key}}}`} (loop over it), {`{{item.${listCountKey(column.key)}}}`}{(list.totals ?? []).map((t) => `, {{item.${listTotalKey(column.key, t)}}}`).join('')}.</p>
      <div className="grid grid-cols-2 gap-1">
        <div>
          <Label htmlFor={`${idBase}-nmin`}>At least (rows)</Label>
          <input id={`${idBase}-nmin`} type="number" min={0} max={LIST_LIMITS.rows} className={inputClass} placeholder={column.required ? '1' : '0'} value={list.min_rows ?? ''} onChange={(e) => set({ min_rows: num(e.target.value) }, `nmin-${tagBase}`)} />
        </div>
        <div>
          <Label htmlFor={`${idBase}-nmax`}>At most (rows)</Label>
          <input id={`${idBase}-nmax`} type="number" min={1} max={LIST_LIMITS.rows} className={inputClass} placeholder={String(LIST_LIMITS.rows)} value={list.max_rows ?? ''} onChange={(e) => set({ max_rows: num(e.target.value) }, `nmax-${tagBase}`)} />
        </div>
      </div>
      <ListColumnsEditor config={list} onPatch={onList} idBase={`${idBase}-n`} tagBase={`${tagBase}-n`} depth={depth + 1} renderLookup={renderLookup} formFields={formFields} parentColumns={parentColumns} />
    </div>
  )
}

/** What a List validation's condition may test: this row's columns, the parent row's (nested), the form's fields, the user. */
type FormFieldRef = { key: string; label: string }

function validationSubjects(columns: ListColumn[], parentColumns: ListColumn[] | undefined, formFields: FormFieldRef[]): Array<{ value: string; label: string }> {
  return [
    ...columns.map((c) => ({ value: `row.${c.key}`, label: `This row: ${c.label}` })),
    ...(parentColumns ?? []).filter((c) => c.type !== 'list').map((c) => ({ value: `parent.${c.key}`, label: `Parent row: ${c.label}` })),
    ...formFields.map((f) => ({ value: `form.${f.key}`, label: `Form: ${f.label || f.key}` })),
    { value: 'user.roles', label: 'Current user: roles' },
    { value: 'user.teams', label: 'Current user: teams' },
    { value: 'user.email', label: 'Current user: email' },
  ]
}

/**
 * A List's validations (lib/forms/list-field.ts): "show <message> when
 * <condition>" — on a column's cell, or on the row (row_validations, with an
 * optional column to put the message on). Checked in the browser and again
 * on the server at submit.
 */
function ValidationsEditor<T extends ListValidation | ListRowValidation>({ items, onChange, subjects, columns, label, idBase, tagBase, rowLevel }: {
  items: T[]
  onChange: (next: T[] | undefined, tag?: string) => void
  subjects: Array<{ value: string; label: string }>
  /** Row-level validations: the columns the message may sit on. */
  columns?: ListColumn[]
  label: string
  idBase: string
  tagBase: string
  rowLevel?: boolean
}) {
  const placeholders = subjects.map((s) => ({ name: s.value, group: s.value.split('.')[0] === 'row' ? 'This row' : s.value.startsWith('parent.') ? 'Parent row' : s.value.startsWith('user.') ? 'Current user' : 'This form', label: s.label }))
  const set = (next: T[], tag?: string) => onChange(next.length ? next : undefined, tag)
  return (
    <div className="space-y-1" data-list-validations={rowLevel ? 'row' : 'column'}>
      <Label>{label}</Label>
      {items.map((v, i) => (
        <div key={i} className="space-y-1 rounded border border-border p-1.5" data-list-validation={i}>
          <div className="flex items-center gap-1">
            <span className="text-2xs font-medium text-fg-muted">Show an error when</span>
            <button type="button" className="ml-auto rounded p-0.5" aria-label={`Remove ${rowLevel ? 'row check' : 'validation'} ${i + 1}`} onClick={() => set(items.filter((_, j) => j !== i))}><X size={11} /></button>
          </div>
          <GroupEditor group={v.if} depth={0} columns={subjects} placeholders={placeholders}
            onChange={(next, tag) => (next ? set(items.map((x, j) => (j === i ? { ...x, if: next } : x)), tag ? `${tagBase}-vif-${i}-${tag}` : undefined) : set(items.filter((_, j) => j !== i)))} />
          <label className="block text-2xs" htmlFor={`${idBase}-vmsg-${i}`}>Message</label>
          <input id={`${idBase}-vmsg-${i}`} className={inputClass} value={v.message} maxLength={LIST_LIMITS.message} placeholder="e.g. Quantity is over the stock on hand ({{row.qty}})"
            onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, message: e.target.value } : x)), `${tagBase}-vmsg-${i}`)} data-list-validation-message />
          {rowLevel && columns && (
            <label className="block text-2xs">Show it on
              <select className={inputClass} value={(v as ListRowValidation).column ?? ''} onChange={(e) => set(items.map((x, j) => (j === i ? clean({ ...x, column: e.target.value || undefined }) : x)))} data-list-validation-column>
                <option value="">The row</option>
                {columns.filter((c) => c.type !== 'list').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
          )}
        </div>
      ))}
      {items.length < LIST_LIMITS.validations && (
        <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" disabled={!subjects.length}
          onClick={() => set([...items, { if: { match: 'all', conditions: [{ column: subjects[0]?.value ?? '', operator: 'is_not_set' }] }, message: 'Check this value' } as T])} data-list-add-validation={rowLevel ? 'row' : 'column'}>
          <Plus size={11} /> {rowLevel ? 'Add row check' : 'Add validation'}
        </button>
      )}
    </div>
  )
}
