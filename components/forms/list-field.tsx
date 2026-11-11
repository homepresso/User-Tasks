'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Check, Loader2, Plus, Trash2, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  blankListRow, coerceListRow, coerceListRows, formatListCell, formatListTotal, inputColumns, isBlankListRow, listEntryMode,
  listColumnWritable, listLabelKey, listRowDraft, listRowErrors, remapAfterRemoval, listTotalLabel, listTotalValue, rawListRows, shownColumns, LIST_LIMITS,
  rowCellErrors, rowDraftState, type ListColumn, type ListFieldConfig, type ListRow,
} from '@/lib/forms/list-field'
import { commitRow, discardRow, targetValues } from '@/lib/forms/row-rules'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { useFormRules } from './form-rules-runtime'
import { LookupField } from './lookup-field'
import { LOOKUP_ROW_KEY, lookupRowDependencies } from '@/lib/forms/lookup'

/**
 * The List field (lib/forms/list-field.ts): rows people add on the form.
 *
 *  - the list view (default): the rows with Remove per row and the totals.
 *    Rows are added by a form rule ("Add row to list", usually on an "Add
 *    item" button) from the form's own inputs; additions and removals are
 *    announced, and focus stays in the list after a Remove.
 *  - `inline` entry: an editable table; Add row appends a blank row and
 *    focuses it; Enter in the last cell of the last row adds another.
 *
 * Rows show as a table, or as cards on phones (`display`, and `narrow` —
 * the designer's mobile preview / one-column forms). Totals sit under the
 * list. Changes are announced (polite live region).
 */

const EMPTY: ListFieldConfig = { columns: [] }

const PHONE_QUERY = '(max-width: 639px)'
/** Below Tailwind's `sm` (the inline editor draws one layout, not both). False on the server. */
function usePhoneWidth(): boolean {
  return useSyncExternalStore(
    (cb) => { const mql = window.matchMedia(PHONE_QUERY); mql.addEventListener('change', cb); return () => mql.removeEventListener('change', cb) },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  )
}

function cellAlign(column: ListColumn): string {
  return column.type === 'number' || column.type === 'currency' || column.type === 'calculated' ? 'text-right tabular-nums' : 'text-left'
}

function displayMode(config: ListFieldConfig, narrow?: boolean): 'table' | 'cards' | 'auto' {
  if (config.display === 'cards' || (narrow && config.display !== 'table')) return 'cards'
  return config.display === 'table' ? 'table' : 'auto'
}

function Totals({ config, rows, id }: { config: ListFieldConfig; rows: ListRow[]; id?: string }) {
  if (!config.totals?.length) return null
  return (
    <dl id={id} className="mt-2 flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm" data-list-totals>
      {config.totals.map((total) => (
        <div key={`${total.fn}-${total.column}`} className="flex items-baseline gap-2">
          <dt className="text-xs text-fg-muted">{listTotalLabel(config, total)}</dt>
          <dd className="font-semibold tabular-nums text-fg" data-list-total={`${total.fn}:${total.column}`}>{formatListTotal(config, total, listTotalValue(total, rows))}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The rows, read-only (and with Edit / Remove in form entry): a table, cards on phones. */
function RowsView({ config, rows, label, narrow, actions, editing = null, onRowClick, selection, current = null }: {
  /** The current row (row rules: New row / Set row values aim at it) — outlined. */
  current?: number | null
  /** list.selectable: the selected rows and how to change them (a click / Space / Enter selects; checkboxes in multiple mode). */
  selection?: { mode: 'single' | 'multiple'; selected: number[]; toggle: (index: number) => void; toggleAll: () => void }
  config: ListFieldConfig
  rows: ListRow[]
  label: string
  narrow?: boolean
  actions?: (index: number) => React.ReactNode
  /** The row loaded into the inputs for editing (highlighted, "Editing"). */
  editing?: number | null
  /** list.row_click: a click (or Enter) on a row. */
  onRowClick?: (index: number) => void
}) {
  const isSelected = (i: number) => Boolean(selection?.selected.includes(i))
  // Selection wins over row_click: with selection on, a click selects (editing stays a button).
  const rowProps = (i: number) => (selection ? {
    onClick: (e: React.MouseEvent) => { if (!(e.target as HTMLElement).closest('button, input')) selection.toggle(i) },
    onKeyDown: (e: React.KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); selection.toggle(i) } },
    tabIndex: 0, 'aria-selected': isSelected(i), 'data-list-selectable': selection.mode,
  } : onRowClick ? {
    onClick: (e: React.MouseEvent) => { if (!(e.target as HTMLElement).closest('button')) onRowClick(i) },
    onKeyDown: (e: React.KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onRowClick(i) } },
    tabIndex: 0, role: 'button' as const, 'aria-label': `Edit row ${i + 1}`, 'data-list-row-click': i,
  } : {})
  const editingBadge = <span className="ml-1 rounded-full bg-primary-wash px-1.5 py-0.5 text-2xs font-medium text-primary-text" data-list-editing-badge>Editing</span>
  const pendingBadge = (row: Record<string, unknown>) => <PendingBadge state={rowDraftState(row)} />
  const errorsOf = (row: Record<string, unknown>) => rowCellErrors(row)
  const mode = displayMode(config, narrow)
  const columns = shownColumns(config)
  const table = (
    <div className={cn('overflow-x-auto rounded-lg border border-border', mode === 'auto' && 'hidden sm:block')} data-list-table>
      <table className="w-full border-collapse text-sm text-fg">
        <caption className="sr-only">{label}</caption>
        <thead className="bg-primary-wash">
          <tr>
            {selection?.mode === 'multiple' && (
              <th scope="col" className="w-8 px-2 py-1.5">
                <input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Select all rows of ${label}`} checked={rows.length > 0 && selection.selected.length === rows.length}
                  onChange={selection.toggleAll} data-list-select-all />
              </th>
            )}
            <th scope="col" className="w-8 px-2 py-1.5 text-left text-2xs font-semibold text-fg-muted">#</th>
            {columns.map((c) => <th key={c.key} scope="col" className={cn('px-2 py-1.5 text-xs font-semibold whitespace-nowrap', cellAlign(c))}>{c.label}</th>)}
            {actions && <th scope="col" className="w-20 px-2 py-1.5"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={cn('border-t border-border', (editing === i || isSelected(i)) && 'bg-primary-wash/60', rowDraftState(row) && !isSelected(i) && 'bg-primary-wash/30', (onRowClick || selection) && 'cursor-pointer hover:bg-subtle')}
              style={current === i ? CURRENT_STYLE : undefined} data-list-row={i} data-selected={isSelected(i) || undefined} data-row-state={rowDraftState(row) ?? undefined} data-current={current === i || undefined} aria-current={editing === i || current === i || undefined} {...rowProps(i)}>
              {selection?.mode === 'multiple' && (
                <td className="px-2 py-1.5"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Select row ${i + 1}`} checked={isSelected(i)} onChange={() => selection.toggle(i)} data-list-select-row={i} /></td>
              )}
              <td className="px-2 py-1.5 text-2xs text-fg-muted tabular-nums">{i + 1}{editing === i && editingBadge}{pendingBadge(row)}</td>
              {columns.map((c) => (
                <td key={c.key} className={cn('px-2 py-1.5 align-top break-words', cellAlign(c))} aria-invalid={Boolean(errorsOf(row)[c.key]) || undefined}>
                  {formatListCell(c, row[c.key], row)}
                  {errorsOf(row)[c.key] && <span className="block text-left text-2xs text-(--status-blocked)" data-list-cell-error={c.key}>{errorsOf(row)[c.key]}</span>}
                </td>
              ))}
              {actions && <td className="px-1 py-1 text-right whitespace-nowrap">{actions(i)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  const cards = (
    <ul className={cn('flex flex-col gap-2', mode === 'auto' && 'sm:hidden')} aria-label={label} data-list-cards>
      {rows.map((row, i) => (
        <li key={i} className={cn('rounded-lg border bg-card p-3', editing === i || isSelected(i) || current === i ? 'border-primary' : 'border-border', (isSelected(i) || rowDraftState(row)) && 'bg-primary-wash/60', (onRowClick || selection) && 'cursor-pointer')}
          data-list-row={i} data-selected={isSelected(i) || undefined} data-row-state={rowDraftState(row) ?? undefined} data-current={current === i || undefined} aria-current={editing === i || current === i || undefined} {...rowProps(i)}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-2xs font-semibold text-fg-muted">
              {selection?.mode === 'multiple' && <input type="checkbox" className="h-5 w-5 accent-primary" aria-label={`Select row ${i + 1}`} checked={isSelected(i)} onChange={() => selection.toggle(i)} data-list-select-row={i} />}
              Row {i + 1}{editing === i && editingBadge}{pendingBadge(row)}{selection?.mode === 'single' && isSelected(i) && <span className="rounded-full bg-primary-wash px-1.5 py-0.5 text-2xs font-medium text-primary-text">Selected</span>}
            </span>
            {actions && <span className="flex gap-1">{actions(i)}</span>}
          </div>
          <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-0.5 text-sm">
            {columns.map((c) => (
              <div key={c.key} className="contents">
                <dt className="text-xs text-fg-muted">{c.label}</dt>
                <dd className={cn('break-words text-fg', cellAlign(c) === 'text-left' ? '' : 'tabular-nums')}>
                  {formatListCell(c, row[c.key], row)}
                  {errorsOf(row)[c.key] && <span className="block text-2xs text-(--status-blocked)" data-list-cell-error={c.key}>{errorsOf(row)[c.key]}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  )
  return <>{mode !== 'cards' && table}{mode !== 'table' && cards}</>
}

const CURRENT_STYLE: React.CSSProperties = { boxShadow: 'inset 3px 0 0 var(--theme-primary)' }

/** "New" / "Edited": a row a rule made or changed and nobody committed yet (lib/forms/row-rules.ts). */
export function PendingBadge({ state }: { state: 'new' | 'edited' | null }) {
  if (!state) return null
  return <span className="ml-1 rounded-full border border-primary px-1.5 py-0.5 text-2xs font-medium text-primary-text" data-row-badge={state}>{state === 'new' ? 'New' : 'Edited'}</span>
}

/** ✓ Commit / ✕ Discard on a pending row (row_commit_controls). */
export function RowCommitControls({ index, onCommit, onDiscard, label }: { index: number; onCommit: () => void; onDiscard: () => void; label?: string }) {
  return (
    <span className="inline-flex gap-0.5" data-row-commit-controls>
      <ActionButton label={`Commit ${label ?? 'row'} ${index + 1}`} onClick={onCommit}><Check size={14} aria-hidden /></ActionButton>
      <ActionButton label={`Discard ${label ?? 'row'} ${index + 1}`} onClick={onDiscard} danger><X size={14} aria-hidden /></ActionButton>
    </span>
  )
}

/** A row's own buttons (list.row_buttons): the pressed one shows a spinner and is busy; all wait while its rules run. */
export function RowButtons({ buttons, index, busy, disabled, onPress }: {
  buttons: ListFieldConfig['row_buttons']
  index: number
  /** `<button id>:<row index>` while its rules run. */
  busy: string | null
  disabled?: boolean
  onPress: (button: string, index: number) => void
}) {
  return (
    <>
      {(buttons ?? []).map((b) => {
        const mine = busy === `${b.id}:${index}`
        return (
          <button key={b.id} type="button" onClick={() => onPress(b.id, index)} disabled={Boolean(busy) || disabled} aria-busy={mine || undefined}
            aria-label={`${b.label} (row ${index + 1})`} data-list-row-button={b.id} data-busy={mine || undefined}
            className={cn('mr-1 inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium disabled:opacity-50', b.style === 'danger' ? 'border-(--status-blocked) text-(--status-blocked)' : 'border-border text-fg')}>
            {mine && <Loader2 size={12} className="animate-spin" aria-hidden />}{b.label}
          </button>
        )
      })}
    </>
  )
}

/** Read-only rows (submissions, completed tasks, review steps, the timeline's detail). */
export function ListValueView({ field, value, narrow }: { field: TaskFieldDef; value: unknown; narrow?: boolean }) {
  const config = field.list ?? EMPTY
  const rows = useMemo(() => coerceListRows(config, value), [config, value])
  if (!rows.length) return <p className="text-sm text-fg-muted" data-list-empty>—</p>
  return (
    <div data-list-view>
      <RowsView config={config} rows={rows} label={field.label} narrow={narrow} />
      <Totals config={config} rows={rows} />
    </div>
  )
}

/** One column's input (form entry and inline cells). */
function ColumnInput({ column, value, onChange, id, error, onKeyDown, inputRef, compact, labelledBy }: {
  column: ListColumn
  value: unknown
  onChange: (value: unknown) => void
  id: string
  error?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void
  inputRef?: (el: HTMLElement | null) => void
  compact?: boolean
  labelledBy?: string
}) {
  const describedBy = [column.help_text && !compact ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
  const common = {
    id,
    'aria-invalid': Boolean(error) || undefined,
    'aria-describedby': describedBy,
    'aria-required': column.required || undefined,
    'aria-labelledby': labelledBy,
    'data-list-input': column.key,
  }
  const text = value === null || value === undefined ? '' : String(value)
  switch (column.type) {
    case 'textarea':
      return <textarea {...common} ref={inputRef as React.Ref<HTMLTextAreaElement>} rows={compact ? 1 : 2} value={text} placeholder={column.placeholder} maxLength={column.max ?? LIST_LIMITS.text}
        onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown}
        className="flex w-full rounded-lg border border-input-border bg-input px-3 py-2 text-sm text-fg aria-invalid:border-danger" />
    case 'boolean':
      return (
        <span className="flex min-h-10 items-center">
          <input {...common} ref={inputRef as React.Ref<HTMLInputElement>} type="checkbox" className="h-4 w-4 accent-primary" checked={value === true || text === 'true'}
            onChange={(e) => onChange(e.target.checked)} onKeyDown={onKeyDown} />
        </span>
      )
    case 'choice':
      return (
        <select {...common} ref={inputRef as React.Ref<HTMLSelectElement>} value={text} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown}
          className="h-10 w-full rounded-lg border border-input-border bg-input px-3 text-sm text-fg aria-invalid:border-danger">
          <option value="">{column.placeholder || 'Select…'}</option>
          {(column.options ?? []).map((o) => <option key={o} value={o}>{column.option_labels?.[o] ?? o}</option>)}
        </select>
      )
    default: {
      const type = column.type === 'number' || column.type === 'currency' ? 'number' : column.type === 'date' ? 'date' : column.type === 'email' ? 'email' : 'text'
      const input = (
        <Input {...common} ref={inputRef as React.Ref<HTMLInputElement>} size="lg" type={type} value={type === 'date' ? text.slice(0, 10) : text} placeholder={column.placeholder}
          inputMode={column.type === 'currency' ? 'decimal' : undefined} step={column.type === 'currency' ? '0.01' : type === 'number' ? 'any' : undefined}
          min={type === 'number' ? column.min : undefined} max={type === 'number' ? column.max : undefined}
          onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} />
      )
      if (column.type !== 'currency') return input
      return (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-fg-muted">{column.currency ?? 'USD'}</span>
          <div className="[&_input]:pl-12">{input}</div>
        </div>
      )
    }
  }
}

function ActionButton({ label, onClick, children, danger, id }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean; id?: string }) {
  return (
    <button id={id} type="button" aria-label={label} title={label} onClick={onClick}
      className={cn('inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-subtle', danger ? 'hover:text-danger' : 'hover:text-fg')}>
      {children}
    </button>
  )
}

const PRIMARY_STYLE: React.CSSProperties = { backgroundColor: 'var(--theme-primary)', borderColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }

export function ListField({ field, value, onChange, id, describedBy, invalid, disabled, narrow, editing = null, formValues, selected = [], onSelect, current = null, focusColumn }: {
  /** The current row (row rules — lib/forms/row-rules.ts) and the column a New row focuses. */
  current?: number | null
  focusColumn?: string
  field: TaskFieldDef
  value: unknown
  onChange: (value: unknown) => void
  id: string
  describedBy?: string
  invalid?: boolean
  disabled?: boolean
  narrow?: boolean
  /** The row an "Edit" loaded into the inputs (lib/forms/list-field.ts listEditingRow). */
  editing?: number | null
  /** The form's values (lookup cells' {{form.x}} filters). */
  formValues?: Record<string, unknown>
  /** list.selectable: the selected rows (0-based) and how to change them (UI state, never the field's value). */
  selected?: number[]
  onSelect?: (next: number[]) => void
}) {
  const config = field.list ?? EMPTY
  if (disabled) return <div aria-describedby={describedBy}><ListValueView field={field} value={value} narrow={narrow} /></div>
  // Editable table, or the list view with its cells editable in place (inline_edit: rows still come from rules).
  if (listEntryMode(config) === 'inline' || config.inline_edit) {
    return <InlineList field={field} config={config} value={value} onChange={onChange} id={id} describedBy={describedBy} invalid={invalid} narrow={narrow} allowAdd={listEntryMode(config) === 'inline'} formValues={formValues} current={current} focusColumn={focusColumn} />
  }
  return <ViewList field={field} config={config} value={value} onChange={onChange} id={id} describedBy={describedBy} narrow={narrow} editing={editing} selected={selected} onSelect={onSelect} current={current} />
}

/**
 * Pending rows' ✓ / ✕ (row_commit_controls) and the current row kept in view:
 * Commit runs the row's checks (failing cells show their message) and fires
 * "row committed" / "row commit failed"; Discard drops a new row or puts an
 * edited one back.
 */
function useRowCommit(field: TaskFieldDef, value: unknown, onChange: (value: unknown) => void) {
  const rules = useFormRules()
  const commit = (index: number) => {
    const values = { [field.key]: value }
    const target = { kind: 'list' as const, index }
    const outcome = commitRow(field, values, target)
    onChange(outcome.value)
    const row = targetValues(field, values, target)
    if (outcome.ok) rules?.dispatch({ type: 'row_committed', target: field.key, context: { field: field.key, row: outcome.row, row_number: index + 1, saved: false } })
    else rules?.dispatch({ type: 'row_commit_failed', target: field.key, context: { field: field.key, row, row_number: index + 1, errors: outcome.errors, error: Object.values(outcome.errors)[0] ?? null } })
  }
  const discard = (index: number) => onChange(discardRow(field, { [field.key]: value }, { kind: 'list', index }, 'discard').value)
  return { commit, discard }
}

/** The current row scrolls into view when a rule makes it current (New row). */
function useCurrentInView(fieldKey: string, current: number | null) {
  useEffect(() => {
    if (current === null) return
    const el = typeof document !== 'undefined' ? document.querySelector(`[data-list-field="${CSS.escape(fieldKey)}"] [data-list-row="${current}"]`) : null
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') (el as HTMLElement).scrollIntoView({ block: 'nearest' })
  }, [fieldKey, current])
}

/**
 * Enter in an inline cell: the next cell of the row, else the first of the
 * next row, else (the last cell of the last row) a new row — when rows can
 * be added. Pure (the keyboard flow, tested on its own).
 */
export function inlineEnterTarget(row: number, cell: number, rows: number, cells: number, canAdd: boolean): { focus: [number, number] } | { add: true } | null {
  if (cell < cells - 1) return { focus: [row, cell + 1] }
  if (row < rows - 1) return { focus: [row + 1, 0] }
  return canAdd ? { add: true } : null
}

/**
 * A cell changed in an inline row: lookup cells of the same row that read it
 * ({{row.<column>}} in their filters / inputs) are cleared — their choice
 * may no longer exist under the new parent (a cascade inside the row).
 */
export function rowWithCell(config: ListFieldConfig, row: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const next: Record<string, unknown> = { ...row, [key]: value }
  const queue = [key]
  while (queue.length) {
    const changed = queue.shift()!
    for (const c of config.columns) {
      if (c.type !== 'lookup' || !lookupRowDependencies(c.lookup).includes(changed) || next[c.key] === null) continue
      next[c.key] = null
      next[listLabelKey(c.key)] = null
      queue.push(c.key)
    }
  }
  return next
}

function useAnnouncer() {
  const [message, setMessage] = useState('')
  const say = useMemo(() => (text: string) => setMessage((prev) => (prev === text ? `${text} ` : text)), [])
  return { message, say }
}

function rowCountText(n: number): string {
  return `${n} ${n === 1 ? 'row' : 'rows'}`
}

/* ── The list view: rows added by rules, Remove per row ──────────────── */

function ViewList({ field, config, value, onChange, id, describedBy, narrow, editing = null, selected = [], onSelect, current = null }: {
  current?: number | null
  selected?: number[]
  onSelect?: (next: number[]) => void
  field: TaskFieldDef
  config: ListFieldConfig
  value: unknown
  onChange: (value: unknown) => void
  id: string
  describedBy?: string
  narrow?: boolean
  editing?: number | null
}) {
  // The rows as they are (pending markers kept — lib/forms/row-rules.ts); totals from what would be submitted.
  const rows = useMemo(() => rawListRows(value).filter((r) => rowDraftState(r) !== null || !isBlankListRow(config, r)) as ListRow[], [config, value])
  const settled = useMemo(() => coerceListRows(config, value), [config, value])
  const announcer = useAnnouncer()
  const rules = useFormRules()
  const rowCommit = useRowCommit(field, value, onChange)
  useCurrentInView(field.key, current)
  const [busy, setBusy] = useState<string | null>(null)
  // A row button: fires "List: row button clicked" with the row ({{row.*}}, {{event.row_number}}); busy while its rules run.
  const press = async (button: string, index: number) => {
    if (!rules || busy) return
    setBusy(`${button}:${index}`)
    try {
      await rules.run({ type: 'list_row_button', target: field.key, context: { field: field.key, button, row: rows[index], index, row_number: index + 1 } })
    } finally {
      setBusy(null)
    }
  }
  // list.row_click: "List: row clicked" with the row (the kit's Edit-on-click loads it into the inputs).
  const rowClick = async (index: number) => {
    if (!rules || busy) return
    setBusy(`__row:${index}`)
    try {
      await rules.run({ type: 'list_row_click', target: field.key, context: { field: field.key, row: rows[index], index, row_number: index + 1 } })
    } finally {
      setBusy(null)
    }
  }
  // Selection (list.selectable): a click / tap / Space / Enter selects; checkboxes in multiple mode. Rules hear it.
  const mode = config.selectable
  const select = (next: number[], changed?: { index: number; on: boolean }) => {
    if (!onSelect) return
    onSelect(next)
    announcer.say(next.length ? `${next.length} ${next.length === 1 ? 'row' : 'rows'} selected` : 'No rows selected')
    if (!rules) return
    if (changed) void rules.run({ type: 'list_row_select', target: field.key, context: { field: field.key, row: rows[changed.index], index: changed.index, row_number: changed.index + 1, selected: changed.on } })
    void rules.run({ type: 'list_selection_change', target: field.key, context: { field: field.key, selected: next.map((i) => i + 1), count: next.length } })
  }
  const selection = mode && onSelect ? {
    mode,
    selected: selected.filter((i) => i < rows.length),
    toggle: (index: number) => {
      const on = !selected.includes(index)
      select(mode === 'single' ? (on ? [index] : []) : on ? [...selected, index] : selected.filter((i) => i !== index), { index, on })
    },
    toggleAll: () => select(selected.length === rows.length ? [] : rows.map((_, i) => i)),
  } : undefined
  const remove = (index: number) => {
    const next = rows.filter((_, i) => i !== index)
    onChange(next)
    if (selected.length && onSelect) onSelect(remapAfterRemoval(selected, new Set([index])))
    announcer.say(`Row ${index + 1} removed. ${rowCountText(next.length)}.`)
    // Focus stays in the list: the row that moved up, else the one before.
    requestAnimationFrame(() => document.getElementById(`${id}-remove-${Math.min(index, next.length - 1)}`)?.focus())
  }
  // A rule added a row: say so (screen readers; the person pressed a button elsewhere on the form).
  const previous = useRef(rows.length)
  const { say } = announcer
  useEffect(() => {
    if (rows.length > previous.current) say(`Row ${rows.length} added to ${field.label}. ${rowCountText(rows.length)}.`)
    previous.current = rows.length
  }, [rows.length, field.label, say])
  return (
    <div id={id} tabIndex={-1} className="flex flex-col gap-2 outline-none" data-list-field={field.key} data-list-mode="view" aria-describedby={describedBy}>
      {rows.length ? (
        <RowsView config={config} rows={rows} label={field.label} narrow={narrow}
          editing={editing} selection={selection} current={current} onRowClick={config.row_click && rules && !selection ? (i) => void rowClick(i) : undefined}
          actions={(i) => (
            <>
              {config.row_commit_controls && rowDraftState(rows[i]) && <RowCommitControls index={i} onCommit={() => rowCommit.commit(i)} onDiscard={() => rowCommit.discard(i)} />}
              <RowButtons buttons={config.row_buttons} index={i} busy={busy} disabled={!rules} onPress={(b, at) => void press(b, at)} />
              <ActionButton id={`${id}-remove-${i}`} label={`Remove row ${i + 1}`} onClick={() => remove(i)} danger><Trash2 size={14} aria-hidden /></ActionButton>
            </>
          )} />
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-fg-muted" data-list-empty>No rows yet.</p>
      )}
      <Totals config={config} rows={settled} />
      <p className="text-2xs text-fg-muted" data-list-count>
        {rowCountText(rows.length)}{config.min_rows ? ` · at least ${config.min_rows}` : ''}{config.max_rows ? ` · at most ${config.max_rows}` : ''}
      </p>
      <p className="sr-only" role="status" aria-live="polite">{announcer.message}</p>
    </div>
  )
}

/* ── Inline entry: an editable table ─────────────────────────────────── */

function InlineList({ field, config, value, onChange, id, describedBy, invalid, narrow, allowAdd = true, formValues, current = null, focusColumn }: {
  current?: number | null
  focusColumn?: string
  field: TaskFieldDef
  config: ListFieldConfig
  value: unknown
  onChange: (value: unknown) => void
  id: string
  describedBy?: string
  invalid?: boolean
  narrow?: boolean
  allowAdd?: boolean
  formValues?: Record<string, unknown>
}) {
  const rows = rawListRows(value)
  const inputs = inputColumns(config)
  const refs = useRef<Record<string, HTMLElement | null>>({})
  const announcer = useAnnouncer()
  const full = config.max_rows !== undefined && rows.length >= config.max_rows
  const phone = usePhoneWidth()
  const shown = displayMode(config, narrow)
  const mode = shown === 'auto' ? (phone ? 'cards' : 'table') : shown
  const cellId = (r: number, key: string) => `${id}-r${r}-${key}`
  const focusCell = (r: number, key?: string) => requestAnimationFrame(() => refs.current[`${r}:${key ?? inputs[0]?.key ?? ''}`]?.focus())
  const typed = rows.map((r) => coerceListRow(config, r))
  // Errors show once the form flagged the field (a submit / Next), not while typing.
  // …plus a failed "Commit row"'s messages, right away.
  const rowErrors = rows.map((r) => ({ ...(invalid && !isBlankListRow(config, r) ? listRowErrors(config, r) : {}), ...rowCellErrors(r) }))
  const rules = useFormRules()
  const rowCommit = useRowCommit(field, value, onChange)
  useCurrentInView(field.key, current)
  // Read-only columns ("Read-only when editing"): a row already in the list shows them, not an input (a New row's, before its commit, may be filled).
  const editableIn = (row: Record<string, unknown>) => inputs.filter((c) => listColumnWritable(config, c.key, row))
  const writable = (row: Record<string, unknown>, c: ListColumn) => listColumnWritable(config, c.key, row)
  // A New row asking for a column's focus (new_row's focus_column).
  useEffect(() => {
    if (current === null || !focusColumn) return
    requestAnimationFrame(() => refs.current[`${current}:${focusColumn}`]?.focus())
  }, [current, focusColumn])

  const add = () => {
    if (full) return
    const next = [...rows, blankListRow(config)]
    onChange(next)
    announcer.say(`Row ${next.length} added.`)
    focusCell(next.length - 1)
  }
  const remove = (index: number) => {
    const next = rows.filter((_, i) => i !== index)
    onChange(next)
    announcer.say(`Row ${index + 1} removed. ${rowCountText(next.length)}.`)
    if (next.length) focusCell(Math.min(index, next.length - 1))
  }
  // Several changes in one event (an autocomplete's value, then its label) build on each other, not on the render's rows.
  const latest = useRef(rows)
  latest.current = rows
  const commit = (next: Record<string, unknown>[]) => { latest.current = next; onChange(next) }
  const setCell = (r: number, key: string, v: unknown) => {
    const before = latest.current[r]
    const next = latest.current.map((row, i) => (i === r ? rowWithCell(config, row, key, v) : row))
    commit(next)
    // "Cell changed" (editable table rules): the column, the new and previous value, the row.
    rules?.dispatch({ type: 'cell_change', target: field.key, context: { field: field.key, row: next[r], row_number: r + 1, index: r, column: key, value: v, previous: before?.[key] ?? null } })
  }
  const setCells = (r: number, patch: Record<string, unknown>) => commit(latest.current.map((row, i) => (i === r ? { ...row, ...patch } : row)))
  const onKeyDown = (r: number, c: number) => (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.nativeEvent.isComposing) return
    if ((e.target as HTMLElement).tagName === 'TEXTAREA') return
    // An open autocomplete keeps Enter for choosing a suggestion.
    if ((e.target as HTMLElement).getAttribute('aria-expanded') === 'true') return
    e.preventDefault()
    // Read-only cells are skipped: the row's editable cells only.
    const cells = editableIn(rows[r])
    const next = inlineEnterTarget(r, c, rows.length, cells.length, allowAdd)
    if (!next) return
    if ('add' in next) add()
    else if (next.focus[0] === r) focusCell(r, cells[next.focus[1]].key)
    else focusCell(next.focus[0], editableIn(rows[next.focus[0]])[0]?.key)
  }
  const readOnlyCell = (c: ListColumn, row: Record<string, unknown>, cellKey: string, labelledBy?: string) => (
    <span id={cellKey} role="textbox" aria-readonly="true" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : c.label} className={cn('flex min-h-10 items-center rounded-lg bg-subtle px-2 text-sm text-fg-muted', cellAlign(c) === 'text-left' ? '' : 'justify-end tabular-nums')} data-list-readonly={c.key}>
      {formatListCell(c, row[c.key], row)}
    </span>
  )
  // A lookup cell: the column's own source (`<list>.<column>` on the server), the row for {{row.x}}, the label kept beside the value.
  const lookupCell = (c: ListColumn, row: Record<string, unknown>, r: number, cellKey: string) => (
    <LookupField field={{ key: `${field.key}.${c.key}`, label: c.label, type: 'lookup', lookup: c.lookup }} value={row[c.key] ?? null} item={null} label={row[listLabelKey(c.key)]}
      values={{ ...(formValues ?? {}), [LOOKUP_ROW_KEY]: row }} id={cellKey} placeholder={c.placeholder}
      onChange={(v) => setCell(r, c.key, v)} onItem={() => {}} onFill={() => {}}
      onLabel={(label) => setCells(r, { [listLabelKey(c.key)]: Array.isArray(label) ? label[0] ?? null : label })} />
  )
  const draft = (row: Record<string, unknown>) => listRowDraft(config, row)

  const tableView = (
    <div className="overflow-x-auto rounded-lg border border-border" data-list-table>
      <table className="w-full border-collapse text-sm text-fg">
        <caption className="sr-only">{field.label}</caption>
        <thead className="bg-primary-wash">
          <tr>
            <th scope="col" className="w-8 px-2 py-1.5 text-left text-2xs font-semibold text-fg-muted">#</th>
            {shownColumns(config).map((c) => (
              <th key={c.key} scope="col" id={`${id}-h-${c.key}`} className={cn('px-2 py-1.5 text-xs font-semibold whitespace-nowrap', cellAlign(c))}>
                {c.label}{c.required && <span className="ml-0.5 text-(--status-blocked)" aria-hidden>*</span>}
              </th>
            ))}
            <th scope="col" className="w-10 px-2 py-1.5"><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={cn('border-t border-border align-top', rowDraftState(row) && 'bg-primary-wash/30')} style={current === r ? CURRENT_STYLE : undefined}
              data-list-row={r} data-row-state={rowDraftState(row) ?? undefined} data-current={current === r || undefined} aria-current={current === r || undefined}>
              <td className="px-2 py-2.5 text-2xs text-fg-muted tabular-nums">{r + 1}<PendingBadge state={rowDraftState(row)} /></td>
              {shownColumns(config).map((c) => (
                <td key={c.key} className={cn('min-w-[8rem] px-1 py-1', cellAlign(c))}>
                  {c.type === 'calculated'
                    ? <span className="flex h-10 items-center justify-end px-2 tabular-nums" data-list-calculated={c.key}>{formatListCell(c, typed[r][c.key])}</span>
                    : !writable(row, c) ? readOnlyCell(c, row, cellId(r, c.key), `${id}-h-${c.key}`)
                    : c.type === 'lookup' ? lookupCell(c, row, r, cellId(r, c.key))
                    : <ColumnInput column={c} value={draft(row)[c.key]} id={cellId(r, c.key)} compact error={rowErrors[r]?.[c.key]} labelledBy={`${id}-h-${c.key}`}
                      inputRef={(el) => { refs.current[`${r}:${c.key}`] = el }} onKeyDown={onKeyDown(r, editableIn(row).indexOf(c))} onChange={(v) => setCell(r, c.key, v)} />}
                  {rowErrors[r]?.[c.key] && <p id={`${cellId(r, c.key)}-error`} className="mt-0.5 text-left text-2xs text-(--status-blocked)">{rowErrors[r][c.key]}</p>}
                </td>
              ))}
              <td className="px-1 py-1 text-right whitespace-nowrap">
                {config.row_commit_controls && rowDraftState(row) && <RowCommitControls index={r} onCommit={() => rowCommit.commit(r)} onDiscard={() => rowCommit.discard(r)} />}
                <ActionButton label={`Remove row ${r + 1}`} onClick={() => remove(r)} danger><Trash2 size={14} aria-hidden /></ActionButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  const cardsView = (
    <ul className="flex flex-col gap-2" aria-label={field.label} data-list-cards>
      {rows.map((row, r) => (
        <li key={r} className={cn('rounded-lg border bg-card p-3', current === r ? 'border-primary' : 'border-border', rowDraftState(row) && 'bg-primary-wash/40')}
          data-list-row={r} data-row-state={rowDraftState(row) ?? undefined} data-current={current === r || undefined} aria-current={current === r || undefined}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-2xs font-semibold text-fg-muted">Row {r + 1}<PendingBadge state={rowDraftState(row)} /></span>
            <span className="flex gap-1">
              {config.row_commit_controls && rowDraftState(row) && <RowCommitControls index={r} onCommit={() => rowCommit.commit(r)} onDiscard={() => rowCommit.discard(r)} />}
              <ActionButton label={`Remove row ${r + 1}`} onClick={() => remove(r)} danger><Trash2 size={14} aria-hidden /></ActionButton>
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {shownColumns(config).map((c) => (
              <div key={c.key}>
                <label htmlFor={`${cellId(r, c.key)}-m`} className="mb-1 block text-xs font-medium text-fg-muted">{c.label}{c.required && <span className="ml-0.5 text-(--status-blocked)" aria-hidden>*</span>}</label>
                {c.type === 'calculated'
                  ? <output id={`${cellId(r, c.key)}-m`} className="text-sm font-medium tabular-nums">{formatListCell(c, typed[r][c.key])}</output>
                  : !writable(row, c) ? readOnlyCell(c, row, `${cellId(r, c.key)}-m`)
                  : c.type === 'lookup' ? lookupCell(c, row, r, `${cellId(r, c.key)}-m`)
                  : <ColumnInput column={c} value={draft(row)[c.key]} id={`${cellId(r, c.key)}-m`} error={rowErrors[r]?.[c.key]}
                    inputRef={(el) => { refs.current[`${r}:${c.key}`] = el }} onKeyDown={onKeyDown(r, editableIn(row).indexOf(c))} onChange={(v) => setCell(r, c.key, v)} />}
                {rowErrors[r]?.[c.key] && <p id={`${cellId(r, c.key)}-m-error`} className="mt-0.5 text-2xs text-(--status-blocked)">{rowErrors[r][c.key]}</p>}
              </div>
            ))}
          </div>
        </li>
      ))}
    </ul>
  )
  return (
    <div className="flex flex-col gap-2" data-list-field={field.key} data-list-mode={allowAdd ? 'inline' : 'inline-edit'} aria-describedby={describedBy}>
      {rows.length ? (mode === 'cards' ? cardsView : tableView) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-fg-muted" data-list-empty>No rows yet.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {allowAdd && (
          <button type="button" onClick={add} disabled={full} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium disabled:opacity-50" style={PRIMARY_STYLE} data-list-add>
            <Plus size={14} aria-hidden /> Add row
          </button>
        )}
        <p className="text-2xs text-fg-muted" data-list-count>
          {rowCountText(rows.filter((r) => !isBlankListRow(config, r)).length)}{config.min_rows ? ` · at least ${config.min_rows}` : ''}{config.max_rows ? ` · at most ${config.max_rows}` : ''}
        </p>
      </div>
      <Totals config={config} rows={coerceListRows(config, rows)} />
      <p className="sr-only" role="status" aria-live="polite">{announcer.message}</p>
    </div>
  )
}
