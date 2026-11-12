'use client'

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2, Plus, SquarePen, Trash2, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { DialogBody } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import {
  blankListRow, childListColumns, childListPaths, childListAt, coerceListRow, coerceListRows, formatListCell, formatListTotal, inputColumns, isBlankListRow, listEntryMode,
  hasListValidations, listCellStates, listColumnWritable, listLabelKey, listRowDraft, listRowErrors, nestedRowsAt, LIST_ROW_ERROR_KEY, remapAfterRemoval, listTotalLabel, listTotalValue, rawListRows, shownColumns, LIST_LIMITS,
  rowCellErrors, rowDraftState, stripRowMarkers, type ListColumn, type ListFieldConfig, type ListRow,
} from '@/lib/forms/list-field'
import { commitRow, currentListIndex, discardRow, targetValues } from '@/lib/forms/row-rules'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { useFormRules } from './form-rules-runtime'
import { useRuleUser } from './use-rule-user'
import { LookupField } from './lookup-field'
import { LOOKUP_ROW_KEY, lookupRowDependencies } from '@/lib/forms/lookup'
import {
  cancelRowForm, formatRowValue, openRowForm, rowEditingModes, rowFormDirty, rowFormTitle, saveRowForm, showsViewIcon, type RowFormRequest, type RowFormSession,
} from '@/lib/forms/list-row-form'
import { ListRowDialog, RowFormIcon, RowValue } from './list-row-dialog'
import { RowStyleScope, ToneIcon, rowStyleAttrs, useRowStyles } from './conditional-style'
import { labelStyleProps, mergeStyleProps, valueStyleProps } from '@/lib/forms/text-style'

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
 *
 * Nested Lists (a column of type `list`): each row expands (a chevron, or
 * the column's "3 lines" button) to show its nested rows under it — an
 * editable table of its own (Add row, cells, Remove, its totals) while the
 * form is editable, read-only otherwise; on phones (cards) the nested rows
 * open in a bottom sheet. The List's totals add a grand total over every
 * parent row. Events from nested rows name the List (event.child,
 * event.parent, event.parent_row_number, event.parent_path).
 */

/**
 * Where a nested List sits: the field's List (`top`), the nested column path
 * (`lines`, `lines.serials`), its parent rows (1-based, one per level) and
 * the immediate parent row.
 */
type NestScope = { top: string; path: string[]; parents: number[]; parent: Record<string, unknown> }

/** The event fields a nested row's events carry (rules target the List: event.child says which nested List). */
function nestEvent(nest: NestScope | undefined): Record<string, unknown> {
  return nest ? { field: nest.top, child: nest.path.join('.'), parent: nest.parent, parent_row_number: nest.parents[nest.parents.length - 1], parent_path: nest.parents } : {}
}

/** The scope of row `index`'s nested List `column` (from the List's own scope, or the field's List). */
function childScope(nest: NestScope | undefined, fieldKey: string, index: number, column: string, row: Record<string, unknown>): NestScope {
  return { top: nest?.top ?? fieldKey, path: [...(nest?.path ?? []), column], parents: [...(nest?.parents ?? []), index + 1], parent: stripRowMarkers(row) }
}

const EMPTY: ListFieldConfig = { columns: [] }

/** Whether a List's validations read the signed-in person (`user.*`). */
function readsUser(config: ListFieldConfig): boolean {
  return hasListValidations(config) && JSON.stringify(config).includes('user.')
}

/** A row-level validation's message (list.row_validations without a column), under the row's cells. */
function RowError({ text, id }: { text?: string; id?: string }) {
  if (!text) return null
  return <p id={id} role="alert" className="mt-1 text-2xs text-(--status-blocked)" data-list-row-error>{text}</p>
}

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

function Totals({ config, rows, id, grand }: { config: ListFieldConfig; rows: ListRow[]; id?: string; grand?: boolean }) {
  // The field's List: nested Lists' totals over every parent row too ("Total amount · all lines").
  const nested = grand ? childListPaths(config).flatMap((path) => {
    const at = childListAt(config, path)!
    const all = nestedRowsAt(rows, path)
    const name = at.columns[at.columns.length - 1].label.toLowerCase()
    return (at.config.totals ?? []).map((total) => ({ key: `${path.join('.')}:${total.fn}:${total.column}`, label: `${listTotalLabel(at.config, total)} · all ${name}`, value: formatListTotal(at.config, total, listTotalValue(total, all)) }))
  }) : []
  if (!config.totals?.length && !nested.length) return null
  return (
    <dl id={id} className="mt-2 flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm" data-list-totals>
      {(config.totals ?? []).map((total) => (
        <div key={`${total.fn}-${total.column}`} className="flex items-baseline gap-2">
          <dt className="text-xs text-fg-muted">{listTotalLabel(config, total)}</dt>
          <dd className="font-semibold tabular-nums text-fg" data-list-total={`${total.fn}:${total.column}`}>{formatListTotal(config, total, listTotalValue(total, rows))}</dd>
        </div>
      ))}
      {nested.map((t) => (
        <div key={t.key} className="flex items-baseline gap-2">
          <dt className="text-xs text-fg-muted">{t.label}</dt>
          <dd className="font-semibold tabular-nums text-fg" data-list-grand-total={t.key}>{t.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A row's expand / collapse button for its nested Lists (keyboard: a plain button; aria-expanded / -controls). */
function ExpandButton({ open, onToggle, controls, label }: { open: boolean; onToggle: () => void; controls: string; label: string }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onToggle() }} aria-expanded={open} aria-controls={controls} aria-label={label} title={label}
      className="mr-1 inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-subtle hover:text-fg" data-list-expand>
      {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
    </button>
  )
}

/** Which rows show their nested Lists (row indexes; a toggle). */
function useExpanded() {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set())
  return { isOpen: (i: number) => open.has(i), toggle: (i: number) => setOpen((prev) => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next }) }
}

/** "Lines (3)" — a phone card's button opening a row's nested List in a bottom sheet. */
function NestedSheetButton({ column, count, rowNumber, children }: { column: ListColumn; count: number; rowNumber: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true) }} className="mt-2 inline-flex h-9 w-full items-center justify-between rounded-lg border border-border px-3 text-sm font-medium text-fg hover:bg-subtle"
        aria-haspopup="dialog" data-list-nested-open={column.key}>
        <span>{column.label} <span className="text-fg-muted tabular-nums">({count})</span></span>
        <ChevronRight size={14} aria-hidden />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" title={`${column.label} · row ${rowNumber}`}>
          {/* Clicks inside stay here (the sheet is portalled, but React events still reach the card / row behind it). */}
          <DialogBody className="overflow-y-auto" data-list-nested-sheet={column.key} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{children}</DialogBody>
        </SheetContent>
      </Sheet>
    </>
  )
}

/**
 * A row's nested List `column`: an editable table (the form is editable, the
 * column writable) or its rows read-only; its own totals under it.
 */
function NestedPanel({ column, value, nest, id, onChange, narrow, formValues, invalid, autoOpen }: {
  /** A rule's open_row_form aimed at a row of this nested List (inside the parent row's pop-out). */
  autoOpen?: RowFormOpen
  invalid?: boolean
  column: ListColumn
  value: unknown
  nest: NestScope
  id: string
  /** Absent: read-only. */
  onChange?: (rows: unknown) => void
  narrow?: boolean
  formValues?: Record<string, unknown>
}) {
  const config = column.list ?? EMPTY
  // The nested List's own key while the form is open (lib/forms/list-field.ts nestedListKey): its current row lives under it.
  const key = [nest.top, ...nest.path.flatMap((step, i) => [String(nest.parents[i] - 1), step])].join('.')
  const label = `${column.label} (row ${nest.parents.join('.')})`
  if (!onChange) {
    const rows = coerceListRows(config, value)
    if (!rows.length) return <p className="px-1 py-2 text-sm text-fg-muted" data-list-nested-empty={column.key}>No {column.label.toLowerCase()}.</p>
    return (
      <div data-list-nested={column.key}>
        <RowsWithView config={config} rows={rows} label={label} listLabel={column.label} narrow={narrow} nest={nest} id={id} autoOpen={autoOpen} />
        <Totals config={config} rows={rows} />
      </div>
    )
  }
  const field = { key, label, type: 'list', list: config } as TaskFieldDef
  return (
    <div data-list-nested={column.key}>
      <InlineList field={field} config={config} value={value} onChange={onChange} id={id} narrow={narrow} allowAdd formValues={formValues} nest={nest} invalid={invalid}
        current={currentListIndex(formValues, key)} listLabel={column.label} autoOpen={autoOpen} />
    </div>
  )
}

/**
 * A rule's request to open a row (open_row_form), as it travels down the
 * nested Lists: the row path from this List down, the nested columns below
 * it, whether the rule just added the row; `token` makes each request new.
 */
type RowFormOpen = { path: number[]; steps: string[]; isNew?: boolean; token: number }

let openToken = 0
function toOpen(request: Pick<RowFormRequest, 'path' | 'steps' | 'isNew'>): RowFormOpen {
  openToken += 1
  return { path: request.path, steps: request.steps, ...(request.isNew ? { isNew: true } : {}), token: openToken }
}

/** The part of a request for the nested List `steps[0]` of the row it opens. */
function childOpen(open: RowFormOpen): { column: string; open: RowFormOpen } | null {
  if (!open.steps.length || open.path.length < 2) return null
  return { column: open.steps[0], open: { ...open, path: open.path.slice(1), steps: open.steps.slice(1) } }
}

/**
 * Read-only rows with "View row" on each (unless row_form.hide_view_icon):
 * the row opens as a read-only form — values formatted, nested Lists as
 * compact rows whose own rows open the same way; Previous / Next.
 */
function RowsWithView({ config, rows, label, listLabel, narrow, nest, id, fieldKey = '', registerKey, autoOpen }: {
  config: ListFieldConfig
  rows: ListRow[]
  /** The table's caption. */
  label: string
  /** The List's name in the dialog title. */
  listLabel: string
  narrow?: boolean
  nest?: NestScope
  id: string
  fieldKey?: string
  /** The field's List inside a form: takes open_row_form requests under this key. */
  registerKey?: string
  autoOpen?: RowFormOpen
}) {
  const [at, setAt] = useState<number | null>(null)
  const [child, setChild] = useState<{ column: string; open: RowFormOpen } | null>(null)
  const rules = useFormRules()
  const show = showsViewIcon(config)
  const handle = (open: RowFormOpen) => {
    const index = open.path[0]
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) return
    setAt(index)
    setChild(childOpen(open))
  }
  const handleRef = useRef(handle)
  handleRef.current = handle
  useEffect(() => {
    if (!registerKey || !rules) return
    return rules.registerRowForm(registerKey, (request) => handleRef.current(toOpen(request)))
  }, [registerKey, rules])
  useEffect(() => { if (autoOpen) handleRef.current(autoOpen) }, [autoOpen])
  const iconId = (i: number) => `${id}-view-${i}`
  const renderNested = readOnlyNested(config, rows, nest, id, narrow, fieldKey)
  return (
    <>
      <RowsView config={config} rows={rows} label={label} narrow={narrow} renderNested={renderNested} parent={nest?.parent}
        actions={show ? (i) => <RowFormIcon id={iconId(i)} index={i} mode="view" onOpen={() => { setChild(null); setAt(i) }} /> : undefined} />
      {at !== null && rows[at] && (
        <ListRowDialog mode="view" config={config} rows={rows} index={at} title={rowFormTitle(config, rows[at], at, listLabel)} idBase={`${id}-rv`} parent={nest?.parent}
          returnFocusId={iconId(at)} fallbackFocusId={id} onNavigate={(to) => { setChild(null); setAt(to) }} onClose={() => { setAt(null); setChild(null) }}
          renderNested={(c) => (
            <NestedPanel column={c} value={rows[at]?.[c.key]} nest={childScope(nest, fieldKey, at, c.key, rows[at] ?? {})} id={`${id}-rv${at}-${c.key}`}
              autoOpen={child?.column === c.key ? child.open : undefined} />
          )} />
      )}
    </>
  )
}

/** Read-only nested Lists of `rows` (submissions, completed tasks, a read-only form). */
function readOnlyNested(config: ListFieldConfig, rows: Record<string, unknown>[], nest: NestScope | undefined, id: string, narrow?: boolean, fieldKey = ''): ((index: number, column: ListColumn) => React.ReactNode) | undefined {
  if (!childListColumns(config).length) return undefined
  return (index, column) => <NestedPanel column={column} value={rows[index]?.[column.key]} nest={childScope(nest, fieldKey, index, column.key, rows[index] ?? {})} id={`${id}-r${index}-${column.key}`} narrow={narrow} />
}

/** The rows, read-only (and with Edit / Remove in form entry): a table, cards on phones. */
function RowsView({ config, rows, label, narrow, actions, editing = null, onRowClick, selection, current = null, renderNested, extraErrors, parent }: {
  /** A nested List's parent row (its row styles read parent.<column>). */
  parent?: Record<string, unknown> | null
  /** More errors per row (the List's validations; LIST_ROW_ERROR_KEY = the row's own). */
  extraErrors?: (index: number) => Record<string, string>
  /** The current row (row rules: New row / Set row values aim at it) — outlined. */
  current?: number | null
  /** Nested List columns: a row's nested List (shown under the row when expanded; in a sheet on phones). */
  renderNested?: (index: number, column: ListColumn) => React.ReactNode
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
  const editingBadge = <span className="ml-1 rounded-full bg-primary-wash px-1.5 py-0.5 text-2xs font-medium text-primary-text" data-list-editing-badge data-cs-keep>Editing</span>
  const pendingBadge = (row: Record<string, unknown>) => <PendingBadge state={rowDraftState(row)} />
  const errorsOf = (row: Record<string, unknown>) => ({ ...(extraErrors ? extraErrors(rows.indexOf(row as ListRow)) : {}), ...rowCellErrors(row) })
  // Conditional styling (list.row_styles): the row's and its cells' styles, judged per row.
  const styleOf = useRowStyles(config, rows, parent)
  const mode = displayMode(config, narrow)
  const columns = shownColumns(config)
  const nested = renderNested ? columns.filter((c) => c.type === 'list' && c.list) : []
  const expanded = useExpanded()
  const span = (selection?.mode === 'multiple' ? 1 : 0) + 1 + columns.length + (actions ? 1 : 0)
  const panelId = (i: number) => `${label.replace(/[^A-Za-z0-9_-]+/g, '-')}-${i}-nested`
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
            {columns.map((c) => <th key={c.key} scope="col" className={cn('px-2 py-1.5 text-xs font-semibold whitespace-nowrap', cellAlign(c))} {...labelStyleProps(c)}>{c.label}</th>)}
            {actions && <th scope="col" className="w-20 px-2 py-1.5"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <Fragment key={i}>
            <tr className={cn('border-t border-border', (editing === i || isSelected(i)) && 'bg-primary-wash/60', rowDraftState(row) && !isSelected(i) && 'bg-primary-wash/30', (onRowClick || selection) && 'cursor-pointer hover:bg-subtle')}
              {...mergeStyleProps(rowStyleAttrs(styleOf(i).row), current === i ? { style: CURRENT_STYLE as Record<string, string> } : null)} data-list-row={i} data-selected={isSelected(i) || undefined} data-row-state={rowDraftState(row) ?? undefined} data-current={current === i || undefined} aria-current={editing === i || current === i || undefined} {...rowProps(i)}>
              {selection?.mode === 'multiple' && (
                <td className="px-2 py-1.5"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Select row ${i + 1}`} checked={isSelected(i)} onChange={() => selection.toggle(i)} data-list-select-row={i} /></td>
              )}
              <td className="px-2 py-1.5 text-2xs text-fg-muted tabular-nums whitespace-nowrap">{nested.length > 0 && <ExpandButton open={expanded.isOpen(i)} onToggle={() => expanded.toggle(i)} controls={panelId(i)} label={`${expanded.isOpen(i) ? 'Hide' : 'Show'} ${nested.map((c) => c.label).join(', ')} of row ${i + 1}`} />}<RowToneIcon style={styleOf(i).row} />{i + 1}{editing === i && editingBadge}{pendingBadge(row)}</td>
              {columns.map((c) => styleOf(i).hidden[c.key] ? <td key={c.key} className="px-2 py-1.5" data-list-hidden-cell={c.key} /> : (
                <td key={c.key} className={cn('px-2 py-1.5 align-top break-words', cellAlign(c))} aria-invalid={Boolean(errorsOf(row)[c.key]) || undefined} {...mergeStyleProps(valueStyleProps(c), rowStyleAttrs(styleOf(i).cells[c.key]))}>
                  <RowToneIcon style={styleOf(i).cells[c.key]} />{formatListCell(c, row[c.key], row)}
                  {errorsOf(row)[c.key] && <span className="block text-left text-2xs text-(--status-blocked)" data-list-cell-error={c.key}>{errorsOf(row)[c.key]}</span>}
                </td>
              ))}
              {actions && <td className="px-1 py-1 text-right whitespace-nowrap">{actions(i)}</td>}
            </tr>
            {errorsOf(row)[LIST_ROW_ERROR_KEY] && (
              <tr data-list-row-error-row={i}><td colSpan={span} className="px-2 pb-2"><RowError text={`Row ${i + 1}: ${errorsOf(row)[LIST_ROW_ERROR_KEY]}`} /></td></tr>
            )}
            {nested.length > 0 && expanded.isOpen(i) && (
              <tr className="bg-subtle/40" data-list-nested-row={i}>
                <td colSpan={span} id={panelId(i)} className="px-3 pb-3 pt-1">
                  {nested.map((c) => (
                    <section key={c.key} aria-label={`${c.label} of row ${i + 1}`} className="mt-1 border-l-2 border-primary/40 pl-3">
                      <h4 className="mb-1 text-xs font-semibold text-fg-muted">{c.label}</h4>
                      {renderNested!(i, c)}
                    </section>
                  ))}
                </td>
              </tr>
            )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
  const cards = (
    <ul className={cn('flex flex-col gap-2', mode === 'auto' && 'sm:hidden')} aria-label={label} data-list-cards>
      {rows.map((row, i) => (
        <li key={i} className={cn('rounded-lg border bg-card p-3', editing === i || isSelected(i) || current === i ? 'border-primary' : 'border-border', (isSelected(i) || rowDraftState(row)) && 'bg-primary-wash/60', (onRowClick || selection) && 'cursor-pointer')}
          {...rowStyleAttrs(styleOf(i).row)} data-list-row={i} data-selected={isSelected(i) || undefined} data-row-state={rowDraftState(row) ?? undefined} data-current={current === i || undefined} aria-current={editing === i || current === i || undefined} {...rowProps(i)}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-2xs font-semibold text-fg-muted">
              {selection?.mode === 'multiple' && <input type="checkbox" className="h-5 w-5 accent-primary" aria-label={`Select row ${i + 1}`} checked={isSelected(i)} onChange={() => selection.toggle(i)} data-list-select-row={i} />}
              <RowToneIcon style={styleOf(i).row} />Row {i + 1}{editing === i && editingBadge}{pendingBadge(row)}{selection?.mode === 'single' && isSelected(i) && <span className="rounded-full bg-primary-wash px-1.5 py-0.5 text-2xs font-medium text-primary-text">Selected</span>}
            </span>
            {actions && <span className="flex gap-1">{actions(i)}</span>}
          </div>
          <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-0.5 text-sm">
            {columns.filter((c) => !styleOf(i).hidden[c.key]).map((c) => (
              <div key={c.key} className="contents">
                <dt className="text-xs text-fg-muted" {...labelStyleProps(c)}>{c.label}</dt>
                <dd className={cn('break-words text-fg', cellAlign(c) === 'text-left' ? '' : 'tabular-nums')} {...mergeStyleProps(valueStyleProps(c), rowStyleAttrs(styleOf(i).cells[c.key]))}>
                  <RowToneIcon style={styleOf(i).cells[c.key]} />{formatListCell(c, row[c.key], row)}
                  {errorsOf(row)[c.key] && <span className="block text-2xs text-(--status-blocked)" data-list-cell-error={c.key}>{errorsOf(row)[c.key]}</span>}
                </dd>
              </div>
            ))}
          </dl>
          <RowError text={errorsOf(row)[LIST_ROW_ERROR_KEY]} />
          {nested.map((c) => (
            <NestedSheetButton key={c.key} column={c} count={rawListRows(row[c.key]).length} rowNumber={i + 1}>{renderNested!(i, c)}</NestedSheetButton>
          ))}
        </li>
      ))}
    </ul>
  )
  return <>{mode !== 'cards' && table}{mode !== 'table' && cards}</>
}

const CURRENT_STYLE: React.CSSProperties = { boxShadow: 'inset 3px 0 0 var(--theme-primary)' }

/** An editable cell with its style's tone icon beside the control. */
function CellWithIcon({ style, children }: { style: { tone?: Parameters<typeof ToneIcon>[0]['tone']; icon?: boolean } | null | undefined; children: React.ReactNode }) {
  if (!style?.icon) return <>{children}</>
  return <div className="flex items-center gap-1"><ToneIcon tone={style.tone ?? 'neutral'} size={12} /><div className="min-w-0 flex-1">{children}</div></div>
}

/** A row / cell style's tone icon (its `icon` switch), before the row number or the value. */
function RowToneIcon({ style }: { style: { tone?: Parameters<typeof ToneIcon>[0]['tone']; icon?: boolean } | null | undefined }) {
  return style?.icon ? <ToneIcon tone={style.tone ?? 'neutral'} size={12} className="mr-1 align-[-2px]" /> : null
}

/** "New" / "Edited": a row a rule made or changed and nobody committed yet (lib/forms/row-rules.ts). */
export function PendingBadge({ state }: { state: 'new' | 'edited' | null }) {
  if (!state) return null
  return <span className="ml-1 rounded-full border border-primary px-1.5 py-0.5 text-2xs font-medium text-primary-text" data-row-badge={state} data-cs-keep>{state === 'new' ? 'New' : 'Edited'}</span>
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
export function ListValueView({ field, value, narrow, rowForms, formValues }: {
  field: TaskFieldDef
  value: unknown
  narrow?: boolean
  rowForms?: boolean
  /** The form's values (row styles reading form.<field>). */
  formValues?: Record<string, unknown>
}) {
  const config = field.list ?? EMPTY
  const rows = useMemo(() => coerceListRows(config, value), [config, value])
  if (!rows.length) return <p className="text-sm text-fg-muted" data-list-empty>—</p>
  return (
    <RowStyleScope config={config} form={formValues}>
      <div data-list-view>
        <RowsWithView config={config} rows={rows} label={field.label} listLabel={field.label} narrow={narrow} id={`lv-${field.key}`} fieldKey={field.key} registerKey={rowForms ? field.key : undefined} />
        <Totals config={config} rows={rows} grand />
      </div>
    </RowStyleScope>
  )
}

/** One column's input (form entry, inline cells and the row pop-out; exported for tests). */
export function ColumnInput({ column, value, onChange, id, error, onKeyDown, inputRef, compact, labelledBy }: {
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
      // The form's own dropdown (components/ui/autocomplete-select.tsx), so a row's pop-out and inline cells match the main form.
      return (
        <AutocompleteSelect id={id} value={text} onChange={(v) => onChange(v)} size="md" invalid={Boolean(error)} describedBy={describedBy}
          labelledBy={labelledBy ?? `${id}-label`} placeholder={column.placeholder || 'Select…'} clearable={!column.required}
          options={(column.options ?? []).map((o) => ({ value: o, label: column.option_labels?.[o] ?? o }))}
          buttonRef={inputRef} onKeyDown={onKeyDown} dataAttrs={{ 'data-list-input': column.key, 'data-list-choice': column.key }} />
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
  if (disabled) return <div aria-describedby={describedBy}><ListValueView field={field} value={value} narrow={narrow} rowForms formValues={formValues} /></div>
  // Editable table, or the list view with its cells editable in place (inline_edit: rows still come from rules).
  if (listEntryMode(config) === 'inline' || config.inline_edit) {
    return <RowStyleScope config={config} form={formValues}><InlineList field={field} config={config} value={value} onChange={onChange} id={id} describedBy={describedBy} invalid={invalid} narrow={narrow} allowAdd={listEntryMode(config) === 'inline'} formValues={formValues} current={current} focusColumn={focusColumn} /></RowStyleScope>
  }
  return <RowStyleScope config={config} form={formValues}><ViewList field={field} config={config} value={value} onChange={onChange} id={id} describedBy={describedBy} narrow={narrow} editing={editing} selected={selected} onSelect={onSelect} current={current} formValues={formValues} invalid={invalid} /></RowStyleScope>
}

/**
 * Pending rows' ✓ / ✕ (row_commit_controls) and the current row kept in view:
 * Commit runs the row's checks (failing cells show their message) and fires
 * "row committed" / "row commit failed"; Discard drops a new row or puts an
 * edited one back.
 */
function useRowCommit(field: TaskFieldDef, value: unknown, onChange: (value: unknown) => void, nest?: NestScope) {
  const rules = useFormRules()
  const target = nest?.top ?? field.key
  const commit = (index: number) => {
    const values = { [field.key]: value }
    const at = { kind: 'list' as const, index }
    const outcome = commitRow(field, values, at)
    onChange(outcome.value)
    const row = targetValues(field, values, at)
    if (outcome.ok) rules?.dispatch({ type: 'row_committed', target, context: { field: field.key, row: outcome.row, row_number: index + 1, saved: false, ...nestEvent(nest) } })
    else rules?.dispatch({ type: 'row_commit_failed', target, context: { field: field.key, row, row_number: index + 1, errors: outcome.errors, error: Object.values(outcome.errors)[0] ?? null, ...nestEvent(nest) } })
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

/* ── The row pop-out (edit) ──────────────────────────────────────────── */

/**
 * A List's row pop-out for editing (lib/forms/list-row-form.ts): opens a row
 * (or a new one), edits the List's own rows as inline cells do (cell_change
 * fires; lookups cascade), Save checks and commits the row (row_committed),
 * Cancel puts it back. The field's List takes open_row_form requests; a
 * nested List gets them through `autoOpen`.
 */
function useRowEditor({ field, config, value, onChange, id, nest, formValues, narrow, invalid, listLabel, autoOpen }: {
  field: TaskFieldDef
  config: ListFieldConfig
  value: unknown
  onChange: (value: unknown) => void
  id: string
  nest?: NestScope
  formValues?: Record<string, unknown>
  narrow?: boolean
  invalid?: boolean
  listLabel: string
  autoOpen?: RowFormOpen
}) {
  const rules = useFormRules()
  const user = useRuleUser(readsUser(config))
  const [session, setSession] = useState<RowFormSession | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [child, setChild] = useState<{ column: string; open: RowFormOpen } | null>(null)
  // Several changes in one event (a lookup's value, then its label) build on each other.
  const latest = useRef(value)
  latest.current = value
  const commit = (next: Record<string, unknown>[]) => { latest.current = next; onChange(next) }
  const target = nest?.top ?? field.key
  const ctx = { form: formValues ?? {}, user: user as Record<string, unknown> | null, parent: nest?.parent ?? null }

  const open = (at: number | 'new', options: { isNew?: boolean; child?: { column: string; open: RowFormOpen } | null } = {}) => {
    const opened = openRowForm(config, latest.current, at, { isNew: options.isNew })
    if ('error' in opened) return false
    if (at === 'new') commit(opened.rows)
    setSession(opened.session)
    setErrors({})
    setChild(options.child ?? null)
    return true
  }
  const handle = (request: RowFormOpen) => open(request.path[0], { isNew: request.isNew && request.path.length === 1, child: childOpen(request) })
  const handleRef = useRef(handle)
  handleRef.current = handle
  useEffect(() => {
    if (nest || !rules) return
    return rules.registerRowForm(field.key, (request) => handleRef.current(toOpen(request)))
  }, [nest, rules, field.key])
  useEffect(() => { if (autoOpen) handleRef.current(autoOpen) }, [autoOpen])

  const rows = rawListRows(value)
  const index = session?.index ?? -1
  const row = rows[index]
  // The row went (a rule removed it): the dialog closes.
  useEffect(() => { if (session && !row) setSession(null) }, [session, row])

  const setCell = (key: string, v: unknown) => {
    if (!session) return
    const before = rawListRows(latest.current)[session.index]
    const next = rawListRows(latest.current).map((r, i) => (i === session.index ? rowWithCell(config, r, key, v) : r))
    commit(next)
    if (errors[key]) setErrors((prev) => { const out = { ...prev }; delete out[key]; return out })
    rules?.dispatch({ type: 'cell_change', target, context: { field: field.key, row: next[session.index], row_number: session.index + 1, index: session.index, column: key, value: v, previous: before?.[key] ?? null, ...nestEvent(nest) } })
  }
  const setCells = (patch: Record<string, unknown>) => {
    if (!session) return
    commit(rawListRows(latest.current).map((r, i) => (i === session.index ? { ...r, ...patch } : r)))
  }
  const save = (): boolean => {
    if (!session) return false
    const outcome = saveRowForm(config, latest.current, session, ctx)
    if (!outcome.ok) {
      setErrors(outcome.errors)
      requestAnimationFrame(() => (document.querySelector(`[data-row-form="edit"] [aria-invalid="true"], [data-row-form="edit"] [role="alert"]`) as HTMLElement | null)?.focus?.())
      return false
    }
    commit(outcome.rows)
    rules?.dispatch({ type: 'row_committed', target, context: { field: field.key, row: outcome.row, row_number: session.index + 1, saved: false, ...nestEvent(nest) } })
    return true
  }
  const close = () => { setSession(null); setChild(null); setErrors({}) }
  const cancel = () => { if (session) commit(cancelRowForm(latest.current, session)); close() }
  const navigate = (to: number) => {
    if (!session) return
    if (rowFormDirty(config, latest.current, session) && !save()) return
    const list = rawListRows(latest.current)
    if (!list[to]) return
    setSession({ index: to, snapshot: list[to], isNew: false })
    setErrors({})
    setChild(null)
  }
  const iconId = (i: number) => `${id}-open-${i}`
  const addId = `${id}-add-form`

  const renderInput = (c: ListColumn, inputId: string, error: string | undefined) => {
    if (!row) return null
    if (c.type === 'calculated') {
      return <output id={inputId} className="flex h-10 items-center rounded-lg bg-subtle px-3 text-sm font-medium tabular-nums" data-list-calculated={c.key}>{formatListCell(c, coerceListRow(config, row)[c.key])}</output>
    }
    if (!listColumnWritable(config, c.key, row) || listCellStates(config, row, ctx).locked[c.key]) {
      return (
        <div id={inputId} role="textbox" aria-readonly="true" aria-labelledby={`${inputId}-label`} className="flex min-h-10 items-center rounded-lg bg-subtle px-3 text-sm text-fg-muted" data-list-readonly={c.key}>
          <RowValue view={formatRowValue(c, row[c.key], row)} />
        </div>
      )
    }
    if (c.type === 'lookup') {
      const base = nest ? [nest.top, ...nest.path].join('.') : field.key
      return (
        <LookupField field={{ key: `${base}.${c.key}`, label: c.label, type: 'lookup', lookup: c.lookup }} value={row[c.key] ?? null} item={null} label={row[listLabelKey(c.key)]}
          values={{ ...(formValues ?? {}), [LOOKUP_ROW_KEY]: row }} id={inputId} placeholder={c.placeholder}
          onChange={(v) => setCell(c.key, v)} onItem={() => {}} onFill={() => {}}
          onLabel={(label) => setCells({ [listLabelKey(c.key)]: Array.isArray(label) ? label[0] ?? null : label })} />
      )
    }
    return <ColumnInput column={c} value={listRowDraft(config, row)[c.key]} id={inputId} error={error} onChange={(v) => setCell(c.key, v)} />
  }

  const dialog = session && row ? (
    <ListRowDialog mode="edit" config={config} rows={rows} index={session.index} isNew={session.isNew} idBase={`${id}-rf`} parent={nest?.parent}
      title={rowFormTitle(config, row, session.index, listLabel, session.isNew)}
      errors={{ ...rowCellErrors(row), ...errors }} dirty={rowFormDirty(config, value, session)}
      returnFocusId={session.isNew ? addId : iconId(session.index)} fallbackFocusId={id}
      renderInput={renderInput}
      renderNested={(c) => (
        <NestedPanel column={c} value={row[c.key]} nest={childScope(nest, field.key, session.index, c.key, row)} id={`${id}-rf${session.index}-${c.key}`} formValues={formValues} invalid={invalid || Boolean(errors[c.key])}
          onChange={listColumnWritable(config, c.key, row) ? (next) => commit(rawListRows(latest.current).map((r, i) => (i === session.index ? { ...r, [c.key]: next } : r))) : undefined}
          autoOpen={child?.column === c.key ? child.open : undefined} />
      )}
      onNavigate={navigate} onSave={() => { if (save()) close(); return true }} onClose={cancel} />
  ) : null
  return { open, dialog, iconId, addId }
}

/* ── The list view: rows added by rules, Remove per row ──────────────── */

function ViewList({ field, config, value, onChange, id, describedBy, narrow, editing = null, selected = [], onSelect, current = null, formValues, invalid }: {
  invalid?: boolean
  formValues?: Record<string, unknown>
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
  // The List's validations, shown on the rows once the form flagged the field (a submit / Next).
  const user = useRuleUser(readsUser(config))
  const validationErrors = (i: number) => (invalid && hasListValidations(config) && rows[i] && rowDraftState(rows[i]) === null ? listRowErrors(config, rows[i], { form: formValues ?? {}, user: user as Record<string, unknown> | null }) : {})
  useCurrentInView(field.key, current)
  // The row pop-out (list.row_editing: 'both' / 'popout'): an "Open row" icon edits the row in a form.
  const modes = rowEditingModes(config, usePhoneWidth())
  const editor = useRowEditor({ field, config, value: rows, onChange, id, formValues, narrow, invalid, listLabel: field.label })
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
        <RowsView config={config} rows={rows} label={field.label} narrow={narrow} extraErrors={validationErrors}
          renderNested={childListColumns(config).length ? (i, c) => (
            <NestedPanel column={c} value={rows[i]?.[c.key]} nest={childScope(undefined, field.key, i, c.key, rows[i] ?? {})} id={`${id}-r${i}-${c.key}`} narrow={narrow} formValues={formValues}
              onChange={listColumnWritable(config, c.key, rows[i]) ? (next) => onChange(rows.map((r, at) => (at === i ? { ...r, [c.key]: next } : r))) : undefined} />
          ) : undefined}
          editing={editing} selection={selection} current={current} onRowClick={config.row_click && rules && !selection ? (i) => void rowClick(i) : undefined}
          actions={(i) => (
            <>
              {modes.popout && <RowFormIcon id={editor.iconId(i)} index={i} mode="edit" onOpen={() => editor.open(i)} />}
              {config.row_commit_controls && rowDraftState(rows[i]) && <RowCommitControls index={i} onCommit={() => rowCommit.commit(i)} onDiscard={() => rowCommit.discard(i)} />}
              <RowButtons buttons={config.row_buttons} index={i} busy={busy} disabled={!rules} onPress={(b, at) => void press(b, at)} />
              <ActionButton id={`${id}-remove-${i}`} label={`Remove row ${i + 1}`} onClick={() => remove(i)} danger><Trash2 size={14} aria-hidden /></ActionButton>
            </>
          )} />
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-fg-muted" data-list-empty>No rows yet.</p>
      )}
      <Totals config={config} rows={settled} grand />
      <p className="text-2xs text-fg-muted" data-list-count>
        {rowCountText(rows.length)}{config.min_rows ? ` · at least ${config.min_rows}` : ''}{config.max_rows ? ` · at most ${config.max_rows}` : ''}
      </p>
      <p className="sr-only" role="status" aria-live="polite">{announcer.message}</p>
      {editor.dialog}
    </div>
  )
}

/* ── Inline entry: an editable table ─────────────────────────────────── */

function InlineList({ field, config, value, onChange, id, describedBy, invalid, narrow, allowAdd = true, formValues, current = null, focusColumn, nest, listLabel, autoOpen }: {
  /** The List's name in the row pop-out's title (a nested List: its column's label). */
  listLabel?: string
  /** A rule's open_row_form for a row of this nested List. */
  autoOpen?: RowFormOpen
  /** A nested List (under a row of the List above): where it sits — its events name the field's List. */
  nest?: NestScope
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
  // The List's own validations (column / row checks) read the form, the parent row (nested) and the user.
  const user = useRuleUser(readsUser(config))
  const checkCtx = { form: formValues ?? {}, user: user as Record<string, unknown> | null, parent: nest?.parent ?? null }
  const rowErrors = rows.map((r) => ({ ...(invalid && !isBlankListRow(config, r) ? listRowErrors(config, r, checkCtx) : {}), ...rowCellErrors(r) }))
  // Conditional styling (list.row_styles), judged per row as it is typed.
  const styleOf = useRowStyles(config, rows, nest?.parent)
  const rules = useFormRules()
  const rowCommit = useRowCommit(field, value, onChange, nest)
  useCurrentInView(field.key, current)
  const expanded = useExpanded()
  const lookupBase = nest ? [nest.top, ...nest.path].join('.') : field.key
  // The row pop-out: 'both' (default) = cells in place + "Open row" / "Add in form"; 'popout' (and phones) = rows read-only, edited in the form.
  const modes = rowEditingModes(config, phone)
  const editor = useRowEditor({ field, config, value, onChange, id, nest, formValues, narrow, invalid, listLabel: listLabel ?? field.label, autoOpen })
  const openIcon = (r: number) => (modes.popout ? <RowFormIcon id={editor.iconId(r)} index={r} mode="edit" onOpen={() => editor.open(r)} /> : null)
  const addInForm = () => {
    if (full) return
    if (editor.open('new')) announcer.say(`Row ${rows.length + 1} added.`)
  }
  // Read-only columns ("Read-only when editing"): a row already in the list shows them, not an input (a New row's, before its commit, may be filled).
  // Nested List columns are a button (their rows open under the row), not in the Enter flow.
  // Cell rules (list.cell_rules): a row's hidden cells are empty, its read-only cells show the value (the server keeps it too).
  const cellStates = rows.map((r) => listCellStates(config, r, checkCtx))
  const lockedCell = (row: Record<string, unknown>, c: ListColumn) => Boolean(cellStates[rows.indexOf(row)]?.locked[c.key])
  const hiddenCell = (r: number, c: ListColumn) => Boolean(cellStates[r]?.hidden[c.key])
  const writable = (row: Record<string, unknown>, c: ListColumn) => listColumnWritable(config, c.key, row) && !lockedCell(row, c)
  const editableIn = (row: Record<string, unknown>) => inputs.filter((c) => c.type !== 'list' && writable(row, c) && !hiddenCell(rows.indexOf(row), c))
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
    // "Cell changed" (editable table rules): the column, the new and previous value, the row (a nested row: its List, event.child / parent).
    rules?.dispatch({ type: 'cell_change', target: nest?.top ?? field.key, context: { field: field.key, row: next[r], row_number: r + 1, index: r, column: key, value: v, previous: before?.[key] ?? null, ...nestEvent(nest) } })
  }
  // A row's nested List changed (its own editable table): the rows go back into the row.
  const setNested = (r: number, key: string, rowsValue: unknown) => commit(latest.current.map((row, i) => (i === r ? { ...row, [key]: rowsValue } : row)))
  const nestedPanel = (c: ListColumn, row: Record<string, unknown>, r: number, panelId: string) => (
    <NestedPanel column={c} value={row[c.key]} nest={childScope(nest, field.key, r, c.key, row)} id={panelId} narrow={narrow} formValues={formValues} invalid={invalid}
      onChange={writable(row, c) ? (next) => setNested(r, c.key, next) : undefined} />
  )
  const nestedColumns = shownColumns(config).filter((c) => c.type === 'list' && c.list)
  const nestedCount = (row: Record<string, unknown>, c: ListColumn) => rawListRows(row[c.key]).filter((x) => rowDraftState(x) !== null || !isBlankListRow(c.list!, x)).length
  // A nested List cell: its row count; pressing it shows / hides the rows under the row.
  const nestedCell = (c: ListColumn, row: Record<string, unknown>, r: number) => (
    <button type="button" onClick={() => expanded.toggle(r)} aria-expanded={expanded.isOpen(r)} aria-controls={`${id}-r${r}-nested`} id={cellId(r, c.key)} aria-labelledby={`${id}-h-${c.key} ${cellId(r, c.key)}`}
      className="inline-flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border px-2 text-sm text-fg hover:bg-subtle" data-list-nested-toggle={c.key}>
      <span className="tabular-nums">{formatListCell(c, rawListRows(row[c.key]).filter((x) => rowDraftState(x) !== null || !isBlankListRow(c.list!, x)))}</span>
      {expanded.isOpen(r) ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
    </button>
  )
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
    <LookupField field={{ key: `${lookupBase}.${c.key}`, label: c.label, type: 'lookup', lookup: c.lookup }} value={row[c.key] ?? null} item={null} label={row[listLabelKey(c.key)]}
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
              <th key={c.key} scope="col" id={`${id}-h-${c.key}`} className={cn('px-2 py-1.5 text-xs font-semibold whitespace-nowrap', cellAlign(c))} {...labelStyleProps(c)}>
                {c.label}{c.required && <span className="ml-0.5 text-(--status-blocked)" aria-hidden>*</span>}
              </th>
            ))}
            <th scope="col" className="w-10 px-2 py-1.5"><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <Fragment key={r}>
            <tr className={cn('border-t border-border align-top', rowDraftState(row) && 'bg-primary-wash/30')}
              {...mergeStyleProps(rowStyleAttrs(styleOf(r).row), current === r ? { style: CURRENT_STYLE as Record<string, string> } : null)} data-list-row={r} data-row-state={rowDraftState(row) ?? undefined} data-current={current === r || undefined} aria-current={current === r || undefined}>
              <td className="px-2 py-2.5 text-2xs text-fg-muted tabular-nums whitespace-nowrap">
                {/* "Open row" leads the row: a wide table scrolls, the icon stays in reach. */}
                {modes.popout ? <span className="-my-2 -ml-1 mr-0.5 inline-flex align-middle">{openIcon(r)}</span> : null}<RowToneIcon style={styleOf(r).row} />{r + 1}<PendingBadge state={rowDraftState(row)} />
              </td>
              {shownColumns(config).map((c) => hiddenCell(r, c) ? <td key={c.key} className="min-w-[8rem] px-1 py-1" data-list-hidden-cell={c.key} /> : (
                <td key={c.key} className={cn('min-w-[8rem] px-1 py-1', cellAlign(c))} {...mergeStyleProps(valueStyleProps(c), rowStyleAttrs(styleOf(r).cells[c.key]))}>
                  <CellWithIcon style={styleOf(r).cells[c.key]}>
                  {c.type === 'calculated'
                    ? <span className="flex h-10 items-center justify-end px-2 tabular-nums" data-list-calculated={c.key}>{formatListCell(c, typed[r][c.key])}</span>
                    : c.type === 'list' ? nestedCell(c, row, r)
                    : !writable(row, c) ? readOnlyCell(c, row, cellId(r, c.key), `${id}-h-${c.key}`)
                    : c.type === 'lookup' ? lookupCell(c, row, r, cellId(r, c.key))
                    : <ColumnInput column={c} value={draft(row)[c.key]} id={cellId(r, c.key)} compact error={rowErrors[r]?.[c.key]} labelledBy={`${id}-h-${c.key}`}
                      inputRef={(el) => { refs.current[`${r}:${c.key}`] = el }} onKeyDown={onKeyDown(r, editableIn(row).indexOf(c))} onChange={(v) => setCell(r, c.key, v)} />}
                  </CellWithIcon>
                  {rowErrors[r]?.[c.key] && <p id={`${cellId(r, c.key)}-error`} className="mt-0.5 text-left text-2xs text-(--status-blocked)">{rowErrors[r][c.key]}</p>}
                </td>
              ))}
              <td className="px-1 py-1 text-right whitespace-nowrap">
                {config.row_commit_controls && rowDraftState(row) && <RowCommitControls index={r} onCommit={() => rowCommit.commit(r)} onDiscard={() => rowCommit.discard(r)} />}
                <ActionButton label={`Remove row ${r + 1}`} onClick={() => remove(r)} danger><Trash2 size={14} aria-hidden /></ActionButton>
              </td>
            </tr>
            {rowErrors[r]?.[LIST_ROW_ERROR_KEY] && (
              <tr data-list-row-error-row={r}>
                <td colSpan={shownColumns(config).length + 2} className="px-2 pb-2"><RowError text={`Row ${r + 1}: ${rowErrors[r][LIST_ROW_ERROR_KEY]}`} /></td>
              </tr>
            )}
            {nestedColumns.length > 0 && expanded.isOpen(r) && (
              <tr className="bg-subtle/40" data-list-nested-row={r}>
                <td colSpan={shownColumns(config).length + 2} id={`${id}-r${r}-nested`} className="px-3 pb-3 pt-1">
                  {nestedColumns.map((c) => (
                    <section key={c.key} aria-label={`${c.label} of row ${r + 1}`} className="mt-1 border-l-2 border-primary/40 pl-3">
                      <h4 className="mb-1 text-xs font-semibold text-fg-muted">{c.label}</h4>
                      {nestedPanel(c, row, r, `${id}-r${r}-${c.key}`)}
                    </section>
                  ))}
                </td>
              </tr>
            )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
  const cardsView = (
    <ul className="flex flex-col gap-2" aria-label={field.label} data-list-cards>
      {rows.map((row, r) => (
        <li key={r} className={cn('rounded-lg border bg-card p-3', current === r ? 'border-primary' : 'border-border', rowDraftState(row) && 'bg-primary-wash/40')}
          {...rowStyleAttrs(styleOf(r).row)} data-list-row={r} data-row-state={rowDraftState(row) ?? undefined} data-current={current === r || undefined} aria-current={current === r || undefined}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-2xs font-semibold text-fg-muted"><RowToneIcon style={styleOf(r).row} />Row {r + 1}<PendingBadge state={rowDraftState(row)} /></span>
            <span className="flex gap-1">
              {openIcon(r)}
              {config.row_commit_controls && rowDraftState(row) && <RowCommitControls index={r} onCommit={() => rowCommit.commit(r)} onDiscard={() => rowCommit.discard(r)} />}
              <ActionButton label={`Remove row ${r + 1}`} onClick={() => remove(r)} danger><Trash2 size={14} aria-hidden /></ActionButton>
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {shownColumns(config).filter((c) => c.type !== 'list' && !hiddenCell(r, c)).map((c) => (
              <div key={c.key} {...mergeStyleProps(valueStyleProps(c), rowStyleAttrs(styleOf(r).cells[c.key]))} {...(styleOf(r).cells[c.key] ? { 'data-cs-box': '' } : {})}>
                <label htmlFor={`${cellId(r, c.key)}-m`} className="mb-1 block text-xs font-medium text-fg-muted" {...labelStyleProps(c)}><RowToneIcon style={styleOf(r).cells[c.key]} />{c.label}{c.required && !lockedCell(row, c) && <span className="ml-0.5 text-(--status-blocked)" aria-hidden>*</span>}</label>
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
          <RowError text={rowErrors[r]?.[LIST_ROW_ERROR_KEY]} />
          {/* Nested Lists on a phone: a bottom sheet with the row's nested rows. */}
          {nestedColumns.map((c) => (
            <div key={c.key}>
              <NestedSheetButton column={c} count={nestedCount(row, c)} rowNumber={r + 1}>{nestedPanel(c, row, r, `${id}-r${r}-${c.key}-m`)}</NestedSheetButton>
              {rowErrors[r]?.[c.key] && <p className="mt-0.5 text-2xs text-(--status-blocked)">{rowErrors[r][c.key]}</p>}
            </div>
          ))}
        </li>
      ))}
    </ul>
  )
  // Pop-out only: the rows read-only (a table, cards on phones) with "Open row", the row's ✓ / ✕ and Remove.
  const popoutView = (
    <RowsView config={config} rows={rows as ListRow[]} label={field.label} narrow={narrow || phone} current={current} parent={nest?.parent}
      extraErrors={(i) => rowErrors[i] ?? {}}
      renderNested={nestedColumns.length ? (i, c) => nestedPanel(c, rows[i], i, `${id}-r${i}-${c.key}`) : undefined}
      actions={(r) => (
        <>
          {openIcon(r)}
          {config.row_commit_controls && rowDraftState(rows[r]) && <RowCommitControls index={r} onCommit={() => rowCommit.commit(r)} onDiscard={() => rowCommit.discard(r)} />}
          <ActionButton label={`Remove row ${r + 1}`} onClick={() => remove(r)} danger><Trash2 size={14} aria-hidden /></ActionButton>
        </>
      )} />
  )
  return (
    <div id={nest ? undefined : id} tabIndex={nest ? undefined : -1} className="flex flex-col gap-2 outline-none" data-list-field={field.key} data-list-mode={allowAdd ? 'inline' : 'inline-edit'} data-row-editing={modes.inline ? (modes.popout ? 'both' : 'inline') : 'popout'} aria-describedby={describedBy}>
      {rows.length ? (!modes.inline ? popoutView : mode === 'cards' ? cardsView : tableView) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-fg-muted" data-list-empty>No rows yet.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {allowAdd && (
          <button id={modes.inline ? undefined : editor.addId} type="button" onClick={modes.inline ? add : addInForm} disabled={full} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium disabled:opacity-50" style={PRIMARY_STYLE} data-list-add>
            <Plus size={14} aria-hidden /> Add row
          </button>
        )}
        {allowAdd && modes.inline && modes.popout && (
          <button id={editor.addId} type="button" onClick={addInForm} disabled={full} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-fg hover:bg-subtle disabled:opacity-50" data-list-add-form>
            <SquarePen size={14} aria-hidden /> Add in form
          </button>
        )}
        <p className="text-2xs text-fg-muted" data-list-count>
          {rowCountText(rows.filter((r) => !isBlankListRow(config, r)).length)}{config.min_rows ? ` · at least ${config.min_rows}` : ''}{config.max_rows ? ` · at most ${config.max_rows}` : ''}
        </p>
      </div>
      <Totals config={config} rows={coerceListRows(config, rows)} grand={!nest} />
      <p className="sr-only" role="status" aria-live="polite">{announcer.message}</p>
      {editor.dialog}
    </div>
  )
}
