'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronLeft, ChevronRight, Filter, Loader2, Lock, PencilLine, Plus, RefreshCw, RotateCcw, Search, Trash2, X } from 'lucide-react'
import {
  DATA_TABLE_OPERATOR_LABELS, addableColumns, changeCount, coerceCell, columnFormat, dataTableDependencies, dataTableKeyColumn,
  dataTablePageSize, editableColumns, emptyChangeSet, formatCell, isChangeSet, userOperatorsFor,
  type DataTableChangeSet, type DataTableColumn, type DataTableFieldConfig, type DataTableOperator, type DataTableRow, type DataTableSort,
} from '@/lib/forms/data-table'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { cn } from '@/lib/utils'
import { controlClass } from '@/components/ui/input'
import { formApiHeaders, formApiUrl, useFormLookupSource, type FormLookupSource } from './lookup-field'
import { GridSurfaceProvider, GridLabelsProvider, usePageLabels, type GridOptionsRequest, type GridSurface } from '@/components/grid/grid-context'
import { GridCellEditor, editorFloats } from '@/components/grid/cell-editor'
import { GridCellDisplay } from '@/components/grid/cell-display'
import { dependentColumns, gridColumnFromForm, hasCustomControl, type GridColumnDef } from '@/lib/grid/column-model'
import { LOOKUP_ROW_KEY } from '@/lib/forms/lookup'
import { FormattedCellView } from './data-table-cell'
import { useFormRules } from './form-rules-runtime'
import type { FormRuleEventType } from '@/lib/forms/form-rules'
import { CONTROLS_KEY } from '@/lib/forms/form-params'
import { ROW_ID_KEY, rowCellErrors, rowDraftState } from '@/lib/forms/row-markers'
import { commitRow, currentRowRef, discardRow, newRowId, type RowTarget } from '@/lib/forms/row-rules'
import { CONTROL_LIMITS } from '@/lib/forms/rule-variables'
import { applyTableEdits, type TableEdit } from '@/lib/forms/data-table-edits'
import { canUndo, changedRowCount, errorCount, hasChanges, inRange, isCellChanged, registerRows as registerEditAllRows, type CellChange } from '@/lib/grid/edit-all'
import { isMultiValue } from '@/lib/grid/column-model'
import { useEditAll } from '@/components/grid/use-edit-all'
import { EDIT_ALL_CHANGED_WASH, EDIT_ALL_FIELD, EDIT_ALL_READONLY, EditAllBar } from '@/components/grid/edit-all-bar'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

/**
 * The Data table field (lib/forms/data-table.ts) on a form: rows from the
 * server (search, column filters, sort and paging run there — the browser
 * only sends its own query and the form values the base filter reads),
 * drawn as a real <table> (a grid with roving focus when rows can be
 * selected or edited), with aria-sort headers, labelled filters, a polite
 * live region for result counts, loading / empty / error states, and
 * horizontal scrolling inside its own frame on phones.
 *
 *   display  read-only rows
 *   select   checkbox (several) / radio (one) per row — the value is the selected rows
 *   edit     cells edit in place (Enter / F2 / typing, Enter saves, Esc cancels),
 *            add / delete rows — the value is the change set
 *
 * Cells show the column's display format; the value keeps the raw typed values.
 */

interface QueryState {
  search: string
  filters: Record<string, { operator: DataTableOperator; value: string }>
  sort: DataTableSort[] | null
  page: number
}

interface Result {
  rows: DataTableRow[]
  total: number | null
  page: number
  page_size: number
  has_more?: boolean
  applied_locally?: string[]
}

async function fetchRows(source: FormLookupSource, field: TaskFieldDef, query: Record<string, unknown>, values: Record<string, unknown>, signal: AbortSignal): Promise<Result> {
  const body = source.kind === 'task'
    ? { task_id: source.taskId, field_key: field.key, query, values }
    : source.kind === 'form'
      ? { form_id: source.formId, field_key: field.key, query, values }
      : { field, query, values }
  const res = await fetch(formApiUrl(source, 'data-table'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
    signal,
  })
  const json = await res.json().catch(() => null) as (Result & { error?: string }) | null
  if (!res.ok) throw new Error(res.status === 429 ? 'Too many requests — wait a moment' : json?.error ?? 'The table is not available right now')
  return { rows: Array.isArray(json?.rows) ? json!.rows : [], total: json?.total ?? null, page: json?.page ?? 1, page_size: json?.page_size ?? 10, has_more: json?.has_more, applied_locally: json?.applied_locally }
}

const cellPad = 'px-2.5 py-1.5'

/*
 * Wide tables: the table scrolls sideways inside its own container (which
 * never widens the form card: `w-0 min-w-full` takes the card's width
 * whatever the grid track around it asks), and the first column stays put
 * while it scrolls. A sticky cell is painted opaque — the card colour under
 * any wash (header tint, selected row, changed cell) — so the columns that
 * slide under it never show through, in light and dark alike.
 */
const SCROLL_BOX = 'w-0 min-w-full overflow-x-auto rounded-lg border'
const STICKY = 'sticky z-[1]'
function stickyStyle(left: string, wash?: string): React.CSSProperties {
  return {
    left,
    backgroundColor: 'var(--theme-card-bg)',
    ...(wash ? { backgroundImage: `linear-gradient(${wash}, ${wash})` } : {}),
    boxShadow: 'inset -1px 0 0 var(--theme-surface-border)',
  }
}
const HEAD_WASH = 'var(--theme-primary-light)'
/** The select column's fixed width (the first data column sticks right after it). */
const SELECT_COL = '2.25rem'
const selectColStyle = (wash?: string): React.CSSProperties => ({ ...stickyStyle('0', wash), width: SELECT_COL, minWidth: SELECT_COL, maxWidth: SELECT_COL })
const CHANGED_WASH = 'color-mix(in srgb, var(--theme-primary) 9%, transparent)'
const inputBase = cn(controlClass, 'h-8 min-w-[6rem] px-2 text-xs')

function alignClass(align: 'left' | 'center' | 'right') {
  return align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
}

function rawEditorValue(col: DataTableColumn, v: unknown): string {
  if (v === null || v === undefined) return ''
  if (col.type === 'datetime') {
    const d = new Date(String(v))
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  if (col.type === 'date') return String(v).slice(0, 10)
  return String(v)
}

/** A new row with nothing typed in it (its row id aside). */
function isBlankAdded(row: Record<string, unknown>): boolean {
  return Object.entries(row).every(([k, v]) => k === ROW_ID_KEY || k.startsWith('__') || v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length))
}

/** Columns drawn and edited by the shared grid engine (a picked control or a data binding). */
function usesEngine(col: DataTableColumn): boolean {
  return hasCustomControl(col) || Boolean(col.binding)
}

/** A bound column's options for this form (forms.lookup, key `<field>.<column>`; the designer preview sends the binding itself). */
function formOptionsFetcher(source: FormLookupSource, field: TaskFieldDef, getValues: () => Record<string, unknown>) {
  return async (req: GridOptionsRequest, signal: AbortSignal) => {
    const key = `${field.key}.${req.column}`
    const column = field.data_table?.columns.find((c) => c.key === req.column)
    const values = { ...getValues(), [LOOKUP_ROW_KEY]: req.row }
    const extra = req.resolve ? { resolve: req.resolve } : {}
    const body = source.kind === 'task'
      ? { task_id: source.taskId, field_key: key, query: req.query, values, ...extra }
      : source.kind === 'form'
        ? { form_id: source.formId, field_key: key, query: req.query, values, ...extra }
        : { field: { key, label: column?.label ?? req.column, type: 'lookup', lookup: column?.binding }, query: req.query, values, ...extra }
    const res = await fetch(formApiUrl(source, 'lookup'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...formApiHeaders(source) }, credentials: 'same-origin', body: JSON.stringify(body), signal })
    const json = await res.json().catch(() => null) as { items?: unknown[]; truncated?: boolean; too_short?: boolean; error?: string } | null
    if (!res.ok) throw new Error(res.status === 429 ? 'Too many lookups — wait a moment' : json?.error ?? 'The options are not available right now')
    return { items: (Array.isArray(json?.items) ? json!.items : []) as never, truncated: json?.truncated, too_short: json?.too_short }
  }
}

/** Resolves the labels of a page's bound values once, for every cell below. */
function PageLabels({ columns, rows, children }: { columns: GridColumnDef[]; rows: Array<Record<string, unknown>>; children: React.ReactNode }) {
  const labels = usePageLabels(columns, rows)
  return <GridLabelsProvider value={labels}>{children}</GridLabelsProvider>
}

/** The in-place editor of one cell (type-matched input). */
function CellEditor({ col, value, label, onCommit, onCancel }: { col: DataTableColumn; value: unknown; label: string; onCommit: (raw: unknown, next?: boolean) => void; onCancel: () => void }) {
  const [text, setText] = useState(() => rawEditorValue(col, value))
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null)
  useEffect(() => { ref.current?.focus(); if (ref.current && 'select' in ref.current && col.type !== 'choice') (ref.current as HTMLInputElement).select?.() }, [col.type])
  const commit = (next?: boolean) => onCommit(col.type === 'datetime' && text ? new Date(text).toISOString() : text, next)
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Enter: keep the value and move to the row's next editable cell (read-only cells are skipped).
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(true) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
    else e.stopPropagation()
  }
  if (col.type === 'boolean') {
    return <input className="accent-primary" ref={ref} type="checkbox" aria-label={label} checked={text === 'true'} onChange={(e) => onCommit(e.target.checked)} onKeyDown={onKeyDown} onBlur={onCancel} />
  }
  if (col.type === 'choice') {
    return (
      <select ref={ref} aria-label={label} className={inputBase} value={text} onChange={(e) => { setText(e.target.value); onCommit(e.target.value) }} onKeyDown={onKeyDown} onBlur={() => commit()}>
        <option value="">—</option>
        {(col.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  const format = columnFormat(col)
  const decimals = format.kind === 'integer' ? 0 : format.decimals
  const type = col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : col.type === 'datetime' ? 'datetime-local' : 'text'
  return (
    <input ref={ref} type={type} aria-label={label} className={inputBase} value={text}
      step={col.type === 'number' ? (decimals !== undefined ? (decimals === 0 ? '1' : String(1 / 10 ** decimals)) : 'any') : undefined}
      min={col.min} max={col.max} maxLength={col.max_length}
      onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} onBlur={() => commit()} />
  )
}

export function DataTableField({ field, value, values, onChange, onControl, reportRows, people, id, describedBy, invalid, disabled }: {
  field: TaskFieldDef
  value: unknown
  values: Record<string, unknown>
  onChange: (value: unknown) => void
  /** Reports what only the table knows ({{control.<key>.last_clicked_row}}, `.row_count`; lib/forms/rule-variables.ts). */
  onControl?: (patch: Record<string, unknown>) => void
  /** Also report the loaded rows ({{control.<key>.rows}} — a Label's expression reads them; lib/forms/label-field.ts). */
  reportRows?: boolean
  /** People a people-picker cell offers (the form's people list). */
  people?: Array<{ id: string; display_name: string | null; email: string | null }>
  id: string
  describedBy?: string
  invalid?: boolean
  disabled?: boolean
}) {
  const config = field.data_table as DataTableFieldConfig | undefined
  const source = useFormLookupSource()
  // The shared grid engine (components/grid): bound options through forms.lookup, signature PNGs through the form's upload pipeline.
  const valuesRef = useRef(values)
  valuesRef.current = values
  const peopleKey = (people ?? []).map((p) => p.id).join(',')
  const surface = useMemo<GridSurface>(() => ({
    scope: `form:${source?.kind === 'task' ? source.taskId : source?.kind === 'form' ? source.formId : 'preview'}:${field.key}`,
    fetchOptions: source ? formOptionsFetcher(source, field, () => valuesRef.current) : undefined,
    signatureUploadKey: (col) => `${field.key}.${col.key}`,
    people,
    locale: config?.locale,
  // Keyed on the people's ids, not the array (a caller's default [] is a new array each render).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [source, field, peopleKey, config?.locale])
  const gridCols = useMemo(() => (config?.columns ?? []).filter(usesEngine).map(gridColumnFromForm), [config])
  const [state, setState] = useState<QueryState>({ search: '', filters: {}, sort: null, page: 1 })
  const [searchText, setSearchText] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ row: string; col: string } | null>(null)
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 })
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({})
  const [reload, setReload] = useState(0)
  const gridRef = useRef<HTMLTableElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Form rules: row events ({{event.row.<column>}}) and "Refresh" actions.
  const rules = useFormRules()
  const refresh = rules?.refreshTick(field.key) ?? 0
  const emit = (type: FormRuleEventType, context: Record<string, unknown>) => {
    // The last clicked row is control state any rule can read ({{control.<key>.last_clicked_row.<column>}}) —
    // the click's own rules included: they run once React has applied it.
    if ((type === 'row_click' || type === 'row_double_click') && onControl) {
      onControl({ last_clicked_row: context.row ?? null, last_clicked_row_id: context.key ?? null })
      setTimeout(() => rules?.dispatch({ type, target: field.key, context: { field: field.key, ...context } }), 0)
      return
    }
    rules?.dispatch({ type, target: field.key, context: { field: field.key, ...context } })
  }
  const controlRef = useRef<Record<string, unknown> | null>(null)
  controlRef.current = (values[CONTROLS_KEY] as Record<string, Record<string, unknown>> | undefined)?.[field.key] ?? null
  const onControlRef = useRef(onControl)
  onControlRef.current = onControl
  const reportRowsRef = useRef(reportRows)
  reportRowsRef.current = reportRows

  const deps = useMemo(() => (config ? dataTableDependencies(config) : []), [config])
  const depValues = useMemo(() => Object.fromEntries(deps.map((k) => [k, values[k]])), [deps, values])
  // refresh_on_change false: the fields the source reads are sent with each query, but a change doesn't reload by itself.
  const depKey = config?.refresh_on_change === false ? '' : JSON.stringify(depValues)
  const mode = config?.mode ?? 'display'
  const keyColumn = config ? dataTableKeyColumn(config) : ''
  const visibleCols = useMemo(() => (config?.columns ?? []).filter((c) => !c.hidden), [config])
  const filterable = visibleCols.filter((c) => c.filterable)
  const changes: DataTableChangeSet = mode === 'edit' && isChangeSet(value) ? { added: value.added ?? [], updated: value.updated ?? [], deleted: value.deleted ?? [] } : emptyChangeSet()
  const selected = mode === 'select' && Array.isArray(value) ? value as Array<Record<string, unknown>> : []
  const selectedKeys = new Set(selected.map((r) => String(r[keyColumn] ?? '')))
  const fmt = { locale: config?.locale }
  // Editable table rules (lib/forms/row-rules.ts): the current row, and the rows on screen for rules that find rows by number / key.
  const currentRef = mode === 'edit' ? currentRowRef(values, field.key) : null
  const rowsForRules = useRef<Array<{ key: string; values: Record<string, unknown> }>>([])
  const registerRows = rules?.registerRows
  useEffect(() => (registerRows && mode === 'edit' ? registerRows(field.key, () => rowsForRules.current) : undefined), [registerRows, mode, field.key])
  // A rule made a row current (New row): bring it into view.
  const currentKey = currentRef ? JSON.stringify('rid' in currentRef ? currentRef.rid : 'key' in currentRef ? currentRef.key : '') : ''
  useEffect(() => {
    if (!currentKey) return
    const t = requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-data-table-field="${CSS.escape(field.key)}"] tr[data-current]`)?.scrollIntoView?.({ block: 'nearest' }))
    return () => cancelAnimationFrame(t)
  }, [currentKey, field.key])

  // Search: debounced into the query.
  useEffect(() => {
    const t = setTimeout(() => setState((s) => (s.search === searchText.trim() ? s : { ...s, search: searchText.trim(), page: 1 })), 300)
    return () => clearTimeout(t)
  }, [searchText])

  // An applied / cleared change set (value back to empty): show the source's current rows.
  const prevCount = useRef(changeCount(value))
  useEffect(() => {
    const count = changeCount(value)
    if (mode === 'edit' && prevCount.current > 0 && (value === null || value === undefined)) setReload((n) => n + 1)
    prevCount.current = count
  }, [value, mode])

  useEffect(() => {
    if (!config || !source) return
    const t = setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setStatus('loading')
      try {
        const query = {
          search: state.search || undefined,
          filters: Object.entries(state.filters).filter(([, f]) => f.value.trim() || f.operator === 'is_set' || f.operator === 'is_not_set').map(([column, f]) => ({ column, operator: f.operator, value: f.value })),
          sort: state.sort ?? undefined,
          page: state.page,
        }
        const res = await fetchRows(source, field, query, depValues, controller.signal)
        if (controller.signal.aborted) return
        setResult(res); setStatus('done'); setError(null)
        const count = typeof res.total === 'number' ? res.total : res.rows.length
        if (reportRowsRef.current && onControlRef.current) onControlRef.current({ row_count: count, loaded_rows: res.rows.slice(0, CONTROL_LIMITS.rows).map((r) => r.values) })
        else if (onControlRef.current && controlRef.current?.row_count !== count) onControlRef.current({ row_count: count })
      } catch (e) {
        if (controller.signal.aborted) return
        setStatus('error'); setError(e instanceof Error ? e.message : 'The table is not available right now')
      }
    }, 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depKey stands for depValues; field identity changes with its config
  }, [config, source, state, depKey, reload, refresh, field.key])
  useEffect(() => () => abortRef.current?.abort(), [])

  /*
   * "Edit all rows" (lib/grid/edit-all.ts): every row's cells editable at
   * once. Each change is folded into the control's value (the change set) as
   * a whole, in one update, and the cell rules fire per changed cell, so the
   * "for each changed row" rules see exactly what single edits produce.
   * Cancel puts the value back as it was when the session began.
   */
  const eaCtx = useRef<{ rowKeys: string[]; colKeys: string[]; canEdit: (row: string, col: string) => boolean; col: (key: string) => DataTableColumn | undefined; onChanged: (moved: CellChange[]) => void; locale?: string }>({
    rowKeys: [], colKeys: [], canEdit: () => false, col: () => undefined, onChanged: () => {},
  })
  const ea = useEditAll({
    get rowKeys() { return eaCtx.current.rowKeys },
    get colKeys() { return eaCtx.current.colKeys },
    canEdit: (row, col) => eaCtx.current.canEdit(row, col),
    isBoolean: (k) => eaCtx.current.col(k)?.type === 'boolean',
    pasteColumn: (k) => {
      const col = eaCtx.current.col(k)!
      const g = gridColumnFromForm(col)
      return { key: col.key, label: col.label, control: g.control, choices: g.control_options?.choices, multiple: isMultiValue(g), bound: Boolean(col.binding) }
    },
    coerce: (k, raw) => coerceCell(eaCtx.current.col(k)!, raw),
    dependents: (k) => dependentColumns(gridCols, k),
    allowAdd: false,
    blankRow: () => ({}),
    people,
    get locale() { return eaCtx.current.locale },
    focusDom: (r, c) => focusCellRef.current(r, c),
    onChanged: (moved) => eaCtx.current.onChanged(moved),
    onSave: () => finishRef.current(),
    announce: (m) => setAnnounceText(m),
  })
  const [announceText, setAnnounceText] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const snapshotRef = useRef<unknown>(null)
  const valueRef = useRef(value)
  valueRef.current = value
  const focusCellRef = useRef<(r: number, c: number) => void>(() => {})
  const finishRef = useRef<() => void>(() => {})
  const autoOpened = useRef(false)

  if (!config) return null
  const pageSize = result?.page_size ?? dataTablePageSize(config)
  const rows = result?.rows ?? []
  const total = result?.total ?? null
  const pages = total !== null ? Math.max(1, Math.ceil(total / pageSize)) : null
  const canNext = pages !== null ? state.page < pages : Boolean(result?.has_more)
  const sortOf = (col: string) => (state.sort ?? config.sort ?? []).find((s) => s.column === col)
  const interactive = !disabled && (mode === 'select' || mode === 'edit')
  // The first data column sticks at the left edge (after the select column in select mode).
  const firstLeft = mode === 'select' ? SELECT_COL : '0'

  /* ── Value updates ─────────────────────────────────────────────────── */

  function setChanges(next: DataTableChangeSet) {
    onChange(changeCount(next) ? next : null)
  }

  function displayed(row: DataTableRow): Record<string, unknown> {
    const u = changes.updated.find((x) => x.key === row.key)
    return u ? { ...row.values, ...u.after } : row.values
  }

  /** Apply one cell edit; false (and the cell's error shown) when the value doesn't fit the column. */
  function editCell(row: DataTableRow | null, addedIndex: number | null, col: DataTableColumn, raw: unknown): boolean {
    const coerced = coerceCell(col, raw)
    const errKey = `${row?.key ?? `new-${addedIndex}`}:${col.key}`
    if ('error' in coerced) { setCellErrors((e) => ({ ...e, [errKey]: coerced.error })); return false }
    setCellErrors((e) => { const n = { ...e }; delete n[errKey]; return n })
    // Cascading: a bound column whose filter reads this one ({{row.<column>}}) starts again empty.
    const cleared = Object.fromEntries(dependentColumns(gridCols, col.key).map((k) => [k, null]))
    if (addedIndex !== null) {
      const added = changes.added.map((r, i) => (i === addedIndex ? { ...r, ...cleared, [col.key]: coerced.value } : r))
      setChanges({ ...changes, added })
      emit('cell_edit', { row: added[addedIndex], column: col.key, value: coerced.value, previous: changes.added[addedIndex]?.[col.key] ?? null })
      emit('cell_change', { row: added[addedIndex], row_number: addedIndex + 1, column: col.key, value: coerced.value, previous: changes.added[addedIndex]?.[col.key] ?? null })
      return true
    }
    if (!row) return false
    // The same folding as an "Edit all rows" batch (lib/forms/data-table-edits.ts).
    const existing = changes.updated.find((x) => x.key === row.key)
    const after = { ...(existing?.after ?? {}), ...cleared, [col.key]: coerced.value }
    const edits: TableEdit[] = Object.entries({ ...cleared, [col.key]: coerced.value }).map(([k, v]) => ({ kind: 'row', key: row.key, before: row.values, col: k, value: v }))
    setChanges(applyTableEdits(config!, changes, edits))
    emit('cell_edit', { row: { ...row.values, ...after }, key: row.key, column: col.key, value: coerced.value, previous: displayed(row)[col.key] ?? null })
    emit('cell_change', { row: { ...row.values, ...after }, key: row.key, row_number: null, column: col.key, value: coerced.value, previous: displayed(row)[col.key] ?? null })
    return true
  }

  function addRow() {
    const blank: Record<string, unknown> = {}
    for (const c of addableColumns(config!)) blank[c.key] = c.type === 'boolean' ? false : null
    blank[ROW_ID_KEY] = newRowId()
    if (ea.session) {
      // Editing all rows: the new row goes at the bottom, its first editable cell focused.
      setChanges({ ...changes, added: [...changes.added, blank] })
      const r = rows.length + changes.added.length
      ea.setPos({ r, c: 0 })
      // The latest render's focus helper (this render's lines don't have the new row yet).
      requestAnimationFrame(() => requestAnimationFrame(() => focusCellRef.current(r, 0)))
      emit('row_add', { row: blank })
      return
    }
    setChanges({ ...changes, added: [blank, ...changes.added] })
    setFocus({ r: 0, c: 0 })
    emit('row_add', { row: blank })
  }

  function deleteRow(row: DataTableRow) {
    if (changes.deleted.some((d) => d.key === row.key)) {
      setChanges({ ...changes, deleted: changes.deleted.filter((d) => d.key !== row.key) })
      return
    }
    setChanges({ ...changes, updated: changes.updated.filter((u) => u.key !== row.key), deleted: [...changes.deleted, { key: row.key, before: row.values }] })
    emit('row_delete', { row: row.values, key: row.key })
  }

  function toggleSelect(row: DataTableRow) {
    if (selectedKeys.has(row.key)) {
      onChange(selected.filter((r) => String(r[keyColumn] ?? '') !== row.key))
      emit('row_deselect', { row: row.values, key: row.key })
    } else {
      onChange(config!.multiple ? [...selected, row.values] : [row.values])
      emit('row_select', { row: row.values, key: row.key, selected: true })
    }
  }

  /* ── Query updates ─────────────────────────────────────────────────── */

  function toggleSort(col: DataTableColumn, add: boolean) {
    const current = state.sort ?? config!.sort ?? []
    // A plain click cycles the column as THE sort (asc → desc → default); Shift adds / cycles it within a multi-column sort.
    const hit = add ? current.find((s) => s.column === col.key) : (current[0]?.column === col.key ? current[0] : undefined)
    const nextDir: 'asc' | 'desc' | null = !hit ? 'asc' : hit.direction === 'asc' ? 'desc' : null
    let next: DataTableSort[]
    if (add) next = nextDir ? [...current.filter((s) => s.column !== col.key), { column: col.key, direction: nextDir }].slice(-3) : current.filter((s) => s.column !== col.key)
    else next = nextDir ? [{ column: col.key, direction: nextDir }] : []
    setState((s) => ({ ...s, sort: next.length ? next : null, page: 1 }))
  }

  function setFilter(col: string, patch: Partial<{ operator: DataTableOperator; value: string }>) {
    setState((s) => {
      const c = config!.columns.find((x) => x.key === col)!
      const prev = s.filters[col] ?? { operator: userOperatorsFor(c.type)[0], value: '' }
      return { ...s, filters: { ...s.filters, [col]: { ...prev, ...patch } }, page: 1 }
    })
  }

  /* ── Rows drawn ────────────────────────────────────────────────────── */

  type Line = { kind: 'added'; index: number; values: Record<string, unknown> } | { kind: 'row'; row: DataTableRow; values: Record<string, unknown>; deleted: boolean; changed: string[] }
  const addedLines: Line[] = mode === 'edit' ? changes.added.map((values, index) => ({ kind: 'added' as const, index, values })) : []
  const lines: Line[] = [
    // Editing all rows: new rows are drawn at the bottom (added there too).
    ...(ea.session ? [] : addedLines),
    ...rows.map((row) => ({
      kind: 'row' as const, row, values: mode === 'edit' ? displayed(row) : row.values,
      deleted: mode === 'edit' && changes.deleted.some((d) => d.key === row.key),
      changed: mode === 'edit' ? changes.updated.find((u) => u.key === row.key)?.changed_fields ?? [] : [],
    })),
    ...(ea.session ? addedLines : []),
  ]
  const editableKeys = new Set(editableColumns(config).map((c) => c.key))
  const addableKeys = new Set(addableColumns(config).map((c) => c.key))
  rowsForRules.current = rows.map((row) => ({ key: row.key, values: displayed(row) }))
  // Pending rows (a rule's New row / Set row values, not committed), their commit messages, the current row.
  const pendingOf = (line: Line): 'new' | 'edited' | null => (line.kind === 'added' ? rowDraftState(line.values) : changes.updated.find((u) => u.key === line.row.key)?.draft ? 'edited' : null)
  const commitErrorsOf = (line: Line): Record<string, string> => (line.kind === 'added' ? rowCellErrors(line.values) : changes.updated.find((u) => u.key === line.row.key)?.errors ?? {})
  const isCurrent = (line: Line) => Boolean(currentRef && (line.kind === 'added' ? 'rid' in currentRef && currentRef.rid === line.values[ROW_ID_KEY] : 'key' in currentRef && currentRef.key === line.row.key))
  const targetOf = (line: Line): RowTarget => (line.kind === 'added' ? { kind: 'added', rid: String(line.values[ROW_ID_KEY] ?? ''), index: line.index } : { kind: 'existing', key: line.row.key, row: line.row.values })
  function commitLine(line: Line) {
    const scope = { [field.key]: changes }
    const target = targetOf(line)
    const outcome = commitRow(field, scope, target)
    onChange(outcome.value)
    const ctx = { row: outcome.row, row_number: line.kind === 'added' ? line.index + 1 : null, key: line.kind === 'row' ? line.row.key : null }
    if (outcome.ok) emit('row_committed', { ...ctx, saved: false })
    else emit('row_commit_failed', { ...ctx, errors: outcome.errors, error: Object.values(outcome.errors)[0] ?? null })
  }
  const discardLine = (line: Line) => onChange(discardRow(field, { [field.key]: changes }, targetOf(line), 'discard').value)
  const controls = mode === 'edit' && Boolean(config.row_commit_controls) && !disabled
  const leadCols = mode === 'select' ? 1 : 0
  const trailCols = mode === 'edit' && (config.allow_delete || controls) ? 1 : 0
  const colCount = leadCols + visibleCols.length + trailCols

  function focusCell(r: number, c: number) {
    const rr = Math.max(0, Math.min(lines.length - 1, r))
    const cc = Math.max(0, Math.min(colCount - 1, c))
    setFocus({ r: rr, c: cc })
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-cell="${rr}:${cc}"]`)?.focus())
  }

  function onGridKey(e: React.KeyboardEvent, r: number, c: number, line: Line) {
    if (editing) return
    const col = visibleCols[c - leadCols]
    if (e.key === 'ArrowRight') { e.preventDefault(); focusCell(r, c + 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); focusCell(r, c - 1) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusCell(r + 1, c) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(r - 1, c) }
    else if (e.key === 'Home') { e.preventDefault(); focusCell(e.ctrlKey ? 0 : r, 0) }
    else if (e.key === 'End') { e.preventDefault(); focusCell(e.ctrlKey ? lines.length - 1 : r, colCount - 1) }
    else if (e.key === ' ' && mode === 'select' && line.kind === 'row') { e.preventDefault(); toggleSelect(line.row) }
    else if ((e.key === 'Enter' || e.key === 'F2') && mode === 'edit' && col && canEdit(line, col)) { e.preventDefault(); setEditing({ row: lineId(line), col: col.key }) }
    else if ((e.key === 'Delete') && mode === 'edit' && config!.allow_delete && line.kind === 'row') { e.preventDefault(); deleteRow(line.row) }
  }

  const lineId = (line: Line) => (line.kind === 'added' ? `new-${line.index}` : line.row.key)
  const canEdit = (line: Line, col: DataTableColumn) => !disabled && mode === 'edit' && (line.kind === 'added' ? addableKeys.has(col.key) : !line.deleted && editableKeys.has(col.key))

  /* ── Edit all rows: the session's view of the lines ─────────────────── */
  const eaKey = (line: Line) => (line.kind === 'added' ? `rid:${String(line.values[ROW_ID_KEY] ?? `i${line.index}`)}` : line.row.key)
  const lineByKey = new Map(lines.map((l) => [eaKey(l), l]))
  const session = ea.session
  const editAllAllowed = mode === 'edit' && !disabled && Boolean(source)
  function foldEdits(moved: CellChange[]) {
    const current: DataTableChangeSet = isChangeSet(valueRef.current) ? { added: valueRef.current.added ?? [], updated: valueRef.current.updated ?? [], deleted: valueRef.current.deleted ?? [] } : emptyChangeSet()
    const edits: TableEdit[] = []
    for (const m of moved) {
      const line = lineByKey.get(m.row)
      if (!line) continue
      edits.push(line.kind === 'added' ? { kind: 'added', rid: String(line.values[ROW_ID_KEY] ?? ''), col: m.col, value: m.value } : { kind: 'row', key: line.row.key, before: line.row.values, col: m.col, value: m.value })
    }
    if (!edits.length) return
    const next = applyTableEdits(config!, current, edits)
    valueRef.current = changeCount(next) ? next : null
    onChange(valueRef.current)
    // The cell rules, once per changed cell (as single edits fire them).
    for (const m of moved) {
      const line = lineByKey.get(m.row)
      if (!line) continue
      const previous = line.values[m.col] ?? null
      if (line.kind === 'added') {
        const row = next.added.find((r) => String(r[ROW_ID_KEY] ?? '') === String(line.values[ROW_ID_KEY] ?? '')) ?? line.values
        emit('cell_edit', { row, column: m.col, value: m.value, previous })
        emit('cell_change', { row, row_number: line.index + 1, column: m.col, value: m.value, previous })
      } else {
        const row = { ...line.row.values, ...(next.updated.find((u) => u.key === line.row.key)?.after ?? {}) }
        emit('cell_edit', { row, key: line.row.key, column: m.col, value: m.value, previous })
        emit('cell_change', { row, key: line.row.key, row_number: null, column: m.col, value: m.value, previous })
      }
    }
  }
  eaCtx.current = {
    rowKeys: lines.map(eaKey),
    colKeys: visibleCols.map((c) => c.key),
    canEdit: (key, colKey) => { const line = lineByKey.get(key); const col = visibleCols.find((c) => c.key === colKey); return Boolean(line && col && canEdit(line, col)) },
    col: (k) => visibleCols.find((c) => c.key === k),
    onChanged: foldEdits,
    locale: config.locale,
  }
  focusCellRef.current = (r, c) => focusCell(r, c + leadCols)
  finishRef.current = () => finishEditAll()
  function startEditAll() {
    if (!editAllAllowed) return
    snapshotRef.current = value ?? null
    setEditing(null)
    ea.start(lines.map((l) => ({ key: eaKey(l), values: l.values, version: null })))
    setAnnounceText('Editing all rows. Arrow keys move, type to edit, Escape reverts a cell.')
    const first = visibleCols.findIndex((c) => lines[0] && canEdit(lines[0], c))
    requestAnimationFrame(() => focusCell(0, Math.max(0, first) + leadCols))
  }
  if (session) {
    // New lines (the next page, a row added) join the session.
    const next = registerEditAllRows(session, lines.map((l) => ({ key: eaKey(l), values: l.values, version: null })))
    if (next !== session) queueMicrotask(() => { if (ea.current() === session) ea.set(next) })
  } else if (config.open_in_edit_mode && editAllAllowed && status === 'done' && !autoOpened.current) {
    autoOpened.current = true
    queueMicrotask(startEditAll)
  }
  /** Done: the changes stay in the value; new rows left blank are dropped. */
  function finishEditAll() {
    const current = valueRef.current
    if (isChangeSet(current) && (current.added ?? []).some((r) => isBlankAdded(r))) {
      const next = { added: (current.added ?? []).filter((r) => !isBlankAdded(r)), updated: current.updated ?? [], deleted: current.deleted ?? [] }
      valueRef.current = changeCount(next) ? next : null
      onChange(valueRef.current)
    }
    ea.stop()
    setAnnounceText('Done — the changes are part of the form; submit it to save them')
  }
  function cancelEditAll() {
    if (session && hasChanges(session)) { setConfirmCancel(true); return }
    ea.stop()
  }

  /** One cell of an "Edit all rows" session (the value shown is the control's value; the session tracks what changed). */
  function editAllCell(line: Line, col: DataTableColumn, ci: number, r: number) {
    const s = session!
    const key = eaKey(line)
    const c = ci + leadCols
    const g = gridColumnFromForm(col)
    const editable = canEdit(line, col)
    const value = line.values[col.key]
    const changed = isCellChanged(s, key, col.key) || line.kind === 'added' || (line.kind === 'row' && line.changed.includes(col.key))
    const err = s.errors[key]?.[col.key] ?? cellErrors[`${lineId(line)}:${col.key}`] ?? commitErrorsOf(line)[col.key]
    const isEditing = ea.editing?.row === key && ea.editing.col === col.key
    const selected = ea.multi && inRange(ea.range, r, ci)
    const focused = ea.pos.r === r && ea.pos.c === ci
    const cell = formatCell(col, value, fmt)
    const label = `${col.label}, row ${r + 1}`
    return (
      <td key={col.key} role="gridcell" data-cell={`${r}:${c}`} data-col={col.key} aria-colindex={c + 1} tabIndex={focused ? 0 : -1}
        aria-readonly={!editable || undefined} aria-invalid={err ? true : undefined} aria-selected={ea.multi ? selected : undefined} title={err ?? (!editable ? 'Read-only' : undefined)}
        onFocus={() => { if (!focused) ea.setPos({ r, c: ci }) }}
        onKeyDown={(e) => ea.onCellKey(e, r, ci)}
        onMouseDown={(e) => { if (e.shiftKey && !isEditing) { e.preventDefault(); ea.setAnchor((a) => a ?? ea.pos); ea.setPos({ r, c: ci }) } }}
        onClick={(e) => {
          if (e.shiftKey || isEditing) return
          ea.setAnchor(null); ea.setPos({ r, c: ci })
          if (editable && col.type !== 'boolean') ea.setEditing({ row: key, col: col.key })
          emit('row_click', { row: line.values, key: line.kind === 'row' ? line.row.key : null, column: col.key })
        }}
        className={cn('px-1.5 py-1', alignClass(cell.align), isEditing && editorFloats(g) && 'relative', selected && 'bg-primary-wash', line.kind === 'row' && line.deleted && 'line-through', ci === 0 && STICKY,
          focused && !isEditing && 'outline outline-2 -outline-offset-2 outline-primary')}
        style={{
          ...(col.width ? { minWidth: col.width } : {}),
          ...(changed && !selected ? { backgroundColor: EDIT_ALL_CHANGED_WASH } : {}),
          ...(ci === 0 ? stickyStyle(firstLeft, changed ? EDIT_ALL_CHANGED_WASH : undefined) : {}),
          ...(err ? { outline: '1px solid var(--status-blocked)', outlineOffset: '-1px' } : {}),
        }}
        data-dt-sticky={ci === 0 || undefined} data-changed={changed || undefined} data-dt-readonly={!editable || undefined}>
        {isEditing ? (
          <GridCellEditor col={g} value={value} row={line.values} label={label} invalid={Boolean(err)} initialText={ea.editing?.initial}
            onCommit={(next, move) => { ea.commit(key, col.key, next); ea.afterEdit(r, ci, key, col.key, move) }}
            onCancel={() => ea.afterCancel(r, ci, key, col.key)} />
        ) : col.type === 'boolean' && !usesEngine(col) ? (
          <span className="flex justify-center">
            <input type="checkbox" tabIndex={-1} className="accent-primary size-4" checked={value === true} disabled={!editable} aria-label={label}
              onChange={(e) => ea.apply([{ row: key, col: col.key, value: e.target.checked }])} />
          </span>
        ) : (
          <span className={cn(editable ? EDIT_ALL_FIELD : EDIT_ALL_READONLY, cell.align === 'right' && 'justify-end', changed && editable && 'border-primary font-medium')} style={changed && editable ? { backgroundColor: EDIT_ALL_CHANGED_WASH } : undefined}>
            {usesEngine(col) ? <GridCellDisplay col={g} value={value} row={line.values} locale={config!.locale} /> : <FormattedCellView cell={cell} wrap={false} />}
            {!editable && <Lock size={11} className="ml-auto shrink-0" aria-hidden />}
          </span>
        )}
        <span className="sr-only">{changed ? ', changed' : ''}{editable ? '' : ', read-only'}</span>
        {err && !isEditing && <span className="block text-2xs text-(--status-blocked)" data-dt-cell-error={col.key}>{err}</span>}
      </td>
    )
  }

  const statusText = status === 'loading' ? 'Loading rows…'
    : status === 'error' ? (error ?? 'The table is not available right now')
      : status === 'done' && !rows.length ? 'No rows match'
        : status === 'done' ? (total !== null ? `Showing ${(state.page - 1) * pageSize + 1}–${(state.page - 1) * pageSize + rows.length} of ${total} row${total === 1 ? '' : 's'}` : `Showing ${rows.length} row${rows.length === 1 ? '' : 's'}`) : ''
  // An API that pages itself: what the server applied (filters, search, sort) covers this page only.
  const pageOnly = result?.applied_locally?.filter((x) => x !== 'page' && !result.applied_locally!.includes('page')) ?? []
  const pageNote = status === 'done' && pageOnly.length ? ` · ${pageOnly.join(', ')} applied to this page of results` : ''
  const changeText = mode === 'edit' && changeCount(changes) ? ` · ${changes.added.length} new, ${changes.updated.length} changed, ${changes.deleted.length} deleted` : ''
  const selectText = mode === 'select' && selected.length ? ` · ${selected.length} selected` : ''

  return (
    <GridSurfaceProvider value={surface}>
    <PageLabels columns={gridCols} rows={lines.map((l) => l.values)}>
    <div className="min-w-0 max-w-full space-y-2" data-data-table-field={field.key} data-mode={mode}>
      {(config.searchable !== false || filterable.length > 0 || config.refresh_button || editAllAllowed || (mode === 'edit' && config.allow_add && !disabled)) && (
        <div className="flex flex-wrap items-center gap-2">
          {config.searchable !== false && (
            <div className="relative min-w-[10rem] flex-1">
              <Search size={13} aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input type="search" aria-label={`Search ${field.label}`} aria-controls={`${id}-grid`} value={searchText} onChange={(e) => setSearchText(e.target.value)}
                placeholder={field.placeholder || 'Search…'} className={cn(inputBase, 'pl-7')} disabled={!source} />
            </div>
          )}
          {filterable.length > 0 && (
            <button type="button" aria-expanded={showFilters} aria-controls={`${id}-filters`} onClick={() => setShowFilters((v) => !v)}
              className="inline-flex h-8 items-center gap-1 rounded border px-2 text-xs border-border text-fg">
              <Filter size={12} aria-hidden /> Filters{Object.values(state.filters).filter((f) => f.value || f.operator === 'is_set' || f.operator === 'is_not_set').length ? ` (${Object.values(state.filters).filter((f) => f.value || f.operator === 'is_set' || f.operator === 'is_not_set').length})` : ''}
            </button>
          )}
          {config.refresh_button && (
            <button type="button" onClick={() => setReload((n) => n + 1)} disabled={!source || status === 'loading'} aria-label={`Refresh ${field.label}`}
              className="inline-flex h-8 items-center gap-1 rounded border px-2 text-xs border-border text-fg disabled:opacity-50" data-dt-refresh>
              <RefreshCw size={12} aria-hidden className={status === 'loading' ? 'animate-spin' : undefined} /> Refresh
            </button>
          )}
          {editAllAllowed && !session && (
            <button type="button" onClick={startEditAll} className="inline-flex h-8 items-center gap-1 rounded border px-2 text-xs font-medium border-border text-fg"
              title="Every row becomes editable at once (Shift+E)" aria-keyshortcuts="Shift+E" data-dt-edit-all>
              <PencilLine size={12} aria-hidden /> Edit all
            </button>
          )}
          {mode === 'edit' && config.allow_add && !disabled && (
            <button type="button" onClick={addRow} className="inline-flex h-8 items-center gap-1 rounded border px-2 text-xs font-medium border-primary text-primary-text"
              data-dt-add>
              <Plus size={12} aria-hidden /> Add row
            </button>
          )}
        </div>
      )}
      {showFilters && filterable.length > 0 && (
        <fieldset id={`${id}-filters`} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-2 border-border">
          <legend className="px-1 text-2xs font-medium text-fg-muted">Filter {field.label}</legend>
          {filterable.map((col) => {
            const f = state.filters[col.key] ?? { operator: userOperatorsFor(col.type)[0], value: '' }
            const fid = `${id}-filter-${col.key}`
            const needsValue = f.operator !== 'is_set' && f.operator !== 'is_not_set'
            return (
              <div key={col.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-end gap-1">
                <div>
                  <label htmlFor={`${fid}-op`} className="block text-2xs text-fg-muted">{col.label}</label>
                  <select id={`${fid}-op`} className={inputBase} value={f.operator} onChange={(e) => setFilter(col.key, { operator: e.target.value as DataTableOperator })}>
                    {userOperatorsFor(col.type).map((op) => <option key={op} value={op}>{DATA_TABLE_OPERATOR_LABELS[op]}</option>)}
                  </select>
                </div>
                {needsValue ? (
                  col.type === 'boolean' ? (
                    <select aria-label={`${col.label} value`} className={inputBase} value={f.value} onChange={(e) => setFilter(col.key, { value: e.target.value })}>
                      <option value="">Any</option><option value="true">Yes</option><option value="false">No</option>
                    </select>
                  ) : col.type === 'choice' && col.options?.length ? (
                    <select aria-label={`${col.label} value`} className={inputBase} value={f.value} onChange={(e) => setFilter(col.key, { value: e.target.value })}>
                      <option value="">Any</option>{col.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input aria-label={`${col.label} value`} type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'} className={inputBase}
                      value={f.value} onChange={(e) => setFilter(col.key, { value: e.target.value })} />
                  )
                ) : <span />}
              </div>
            )
          })}
          <div className="sm:col-span-2">
            <button type="button" className="inline-flex items-center gap-1 text-2xs underline text-primary-text" onClick={() => setState((s) => ({ ...s, filters: {}, page: 1 }))}>
              <RotateCcw size={11} aria-hidden /> Clear filters
            </button>
          </div>
        </fieldset>
      )}

      {session && (
        <EditAllBar changedRows={changedRowCount(session)} errors={errorCount(session)} conflicts={0} canUndo={canUndo(session)} saveLabel="Done"
          saveHint="Keep the changes in the form (submit the form to save them)" onUndo={ea.undo} onCancel={cancelEditAll} onSave={finishEditAll} />
      )}
      <p className="sr-only" role="status" aria-live="polite">{announceText}</p>
      {/* A grid (select / edit) is reached cell by cell — arrow keys scroll it; a display table is one focusable scroll region. */}
      <div className={cn(SCROLL_BOX, invalid ? 'border-(--status-blocked)' : 'border-border')} data-dt-scroll
        role={interactive ? undefined : 'region'} aria-label={interactive ? undefined : `${field.label} (scrollable)`} tabIndex={interactive ? undefined : 0}>
        {!source ? (
          <p className="p-3 text-xs text-fg-muted">The rows appear when the form is filled in.</p>
        ) : (
          <table ref={gridRef} id={`${id}-grid`} role={interactive ? 'grid' : undefined} aria-labelledby={`${id}-label`} aria-describedby={[describedBy, `${id}-status`].filter(Boolean).join(' ')}
            aria-busy={status === 'loading' || undefined} aria-invalid={invalid || undefined}
            className="w-full border-collapse text-xs text-fg" data-dt-table data-fm-table
            aria-multiselectable={session ? true : mode === 'select' ? Boolean(config.multiple) : undefined} data-edit-all={session ? true : undefined}
            onPaste={session ? ea.onPaste : undefined} onCopy={session ? ea.onCopy : undefined}
            onKeyDown={(e) => {
              const t = e.target as HTMLElement
              if (e.key === 'E' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !session && editAllAllowed && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) { e.preventDefault(); startEditAll() }
            }}>
            <thead className="bg-primary-wash">
              <tr>
                {mode === 'select' && <th scope="col" className={cn(cellPad, STICKY)} style={selectColStyle(HEAD_WASH)}><span className="sr-only">Select</span></th>}
                {visibleCols.map((col, ci) => {
                  const s = sortOf(col.key)
                  const align = columnFormat(col).align ?? formatCell(col, null).align
                  return (
                    <th key={col.key} scope="col" aria-sort={s ? (s.direction === 'asc' ? 'ascending' : 'descending') : col.sortable ? 'none' : undefined}
                      className={cn(cellPad, 'whitespace-nowrap font-semibold', alignClass(align), ci === 0 && STICKY)}
                      style={{ ...(col.width ? { minWidth: col.width } : {}), ...(ci === 0 ? stickyStyle(firstLeft, HEAD_WASH) : {}) }} data-dt-sticky={ci === 0 || undefined}>
                      {col.sortable ? (
                        <button type="button" onClick={(e) => toggleSort(col, e.shiftKey)} className={cn('inline-flex items-center gap-1 rounded', align === 'right' && 'flex-row-reverse')} title="Sort (Shift: add to the sort)">
                          {col.label}{col.required && mode === 'edit' ? <span className="text-(--status-blocked)" aria-hidden>*</span> : null}
                          {s ? (s.direction === 'asc' ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />) : <ArrowUpDown size={11} aria-hidden className="opacity-40" />}
                        </button>
                      ) : <>{col.label}{col.required && mode === 'edit' ? <span className="text-(--status-blocked)" aria-hidden>*</span> : null}</>}
                    </th>
                  )
                })}
                {trailCols > 0 && <th scope="col" className={cn(cellPad, 'w-8')}><span className="sr-only">Delete</span></th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, r) => {
                const lid = lineId(line)
                const isSelected = line.kind === 'row' && selectedKeys.has(line.row.key)
                const pendingState = mode === 'edit' ? pendingOf(line) : null
                const commitErrors = mode === 'edit' ? commitErrorsOf(line) : {}
                const current = isCurrent(line)
                return (
                  <tr key={lid} aria-selected={mode === 'select' ? isSelected : undefined} aria-current={current || undefined} className="border-t border-border"
                    style={{ ...(line.kind === 'row' && line.deleted ? { opacity: 0.55 } : {}), ...(current ? { boxShadow: 'inset 3px 0 0 var(--theme-primary)' } : {}) }}
                    data-dt-row={lid} data-dt-state={line.kind === 'added' ? 'added' : line.deleted ? 'deleted' : line.changed.length ? 'changed' : undefined}
                    data-row-state={pendingState ?? undefined} data-current={current || undefined}>
                    {mode === 'select' && line.kind === 'row' && (
                      <td role="gridcell" className={cn(cellPad, STICKY)} style={selectColStyle(isSelected ? HEAD_WASH : undefined)} data-cell={`${r}:0`} tabIndex={focus.r === r && focus.c === 0 ? 0 : -1} onKeyDown={(e) => onGridKey(e, r, 0, line)} onFocus={() => setFocus({ r, c: 0 })}>
                        <input className="accent-primary" type={config.multiple ? 'checkbox' : 'radio'} name={`${id}-select`} tabIndex={-1} checked={isSelected} disabled={disabled}
                          aria-label={`Select row ${String(line.values[visibleCols[0]?.key] ?? line.row.key)}`} onChange={() => toggleSelect(line.row)} />
                      </td>
                    )}
                    {visibleCols.map((col, ci) => {
                      if (session) return editAllCell(line, col, ci, r)
                      const c = ci + leadCols
                      const cell = formatCell(col, line.values[col.key], fmt)
                      const isEditing = editing?.row === lid && editing.col === col.key
                      const err = cellErrors[`${lid}:${col.key}`] ?? commitErrors[col.key]
                      const changed = line.kind === 'added' || (line.kind === 'row' && line.changed.includes(col.key))
                      const missing = line.kind === 'added' && col.required && (line.values[col.key] === null || line.values[col.key] === undefined || line.values[col.key] === '')
                      return (
                        <td key={col.key} role={interactive ? 'gridcell' : undefined} data-cell={`${r}:${c}`}
                          tabIndex={interactive ? (focus.r === r && focus.c === c ? 0 : -1) : undefined}
                          aria-invalid={err || missing ? true : undefined} aria-readonly={interactive && mode === 'edit' && !canEdit(line, col) ? true : undefined}
                          title={err ?? (missing ? `${col.label} is required` : undefined)}
                          onKeyDown={interactive ? (e) => onGridKey(e, r, c, line) : undefined}
                          onFocus={interactive ? () => setFocus({ r, c }) : undefined}
                          onClick={() => {
                            if (mode === 'select' && line.kind === 'row' && !disabled) toggleSelect(line.row)
                            if (!isEditing) emit('row_click', { row: line.values, key: line.kind === 'row' ? line.row.key : null, column: col.key })
                          }}
                          onDoubleClick={() => {
                            if (canEdit(line, col)) setEditing({ row: lid, col: col.key })
                            emit('row_double_click', { row: line.values, key: line.kind === 'row' ? line.row.key : null, column: col.key })
                          }}
                          className={cn(cellPad, alignClass(cell.align), !columnFormat(col).wrap && 'whitespace-nowrap', isEditing && editorFloats(gridColumnFromForm(col)) && 'relative', mode === 'select' && !disabled && 'cursor-pointer', canEdit(line, col) && 'cursor-text', mode === 'edit' && !disabled && !canEdit(line, col) && 'text-fg-muted', line.kind === 'row' && line.deleted && 'line-through', ci === 0 && STICKY)}
                          data-dt-readonly={mode === 'edit' && !canEdit(line, col) ? true : undefined}
                          style={{
                            ...(changed && mode === 'edit' ? { backgroundColor: CHANGED_WASH } : {}),
                            ...(ci === 0 ? stickyStyle(firstLeft, changed && mode === 'edit' ? CHANGED_WASH : isSelected ? HEAD_WASH : undefined) : {}),
                            ...(err || missing ? { outline: '1px solid var(--status-blocked)', outlineOffset: '-1px' } : {}),
                          }}
                          data-dt-sticky={ci === 0 || undefined}
                          data-col={col.key}>
                          {isEditing && usesEngine(col) ? (
                            <GridCellEditor col={gridColumnFromForm(col)} value={line.values[col.key]} row={line.values} label={`${col.label}, row ${r + 1}`} invalid={Boolean(err)}
                              onCommit={(next, move) => {
                                if (!editCell(line.kind === 'row' ? line.row : null, line.kind === 'added' ? line.index : null, col, next)) return
                                setEditing(null)
                                // Spreadsheet keys: Tab / Shift+Tab along the row's editable cells, Enter down the column.
                                if (move === 'down') { focusCell(r + 1, c); return }
                                const editableIdx = visibleCols.map((x, xi) => (canEdit(line, x) ? xi : -1)).filter((xi) => xi >= 0)
                                const after = move === 'prev' ? editableIdx.filter((xi) => xi < ci).pop() ?? -1 : move === 'next' ? editableIdx.find((xi) => xi > ci) ?? -1 : -1
                                focusCell(r, after >= 0 ? after + leadCols : c)
                              }}
                              onCancel={() => { setEditing(null); setCellErrors((e) => { const n = { ...e }; delete n[`${lid}:${col.key}`]; return n }); focusCell(r, c) }} />
                          ) : isEditing ? (
                            <CellEditor col={col} value={line.values[col.key]} label={`${col.label}, row ${r + 1}`}
                              onCommit={(raw, next) => {
                                if (!editCell(line.kind === 'row' ? line.row : null, line.kind === 'added' ? line.index : null, col, raw)) return
                                setEditing(null)
                                // Enter: on to the row's next editable cell (read-only ones skipped).
                                const after = next ? visibleCols.findIndex((x, xi) => xi > ci && canEdit(line, x)) : -1
                                focusCell(r, after >= 0 ? after + leadCols : c)
                              }}
                              onCancel={() => { setEditing(null); setCellErrors((e) => { const n = { ...e }; delete n[`${lid}:${col.key}`]; return n }) }} />
                          ) : (
                            <>
                              {usesEngine(col)
                                ? <GridCellDisplay col={gridColumnFromForm(col)} value={line.values[col.key]} row={line.values} locale={config.locale} />
                                : <FormattedCellView cell={cell} wrap={columnFormat(col).wrap} />}
                              {ci === 0 && pendingState && <span className="ml-1 rounded-full border border-primary px-1.5 py-0.5 text-2xs font-medium text-primary-text" data-row-badge={pendingState}>{pendingState === 'new' ? 'New' : 'Edited'}</span>}
                              {canEdit(line, col) && <span className="sr-only">, editable — press Enter</span>}
                              {mode === 'edit' && !canEdit(line, col) && <span className="sr-only">, read-only</span>}
                              {commitErrors[col.key] && <span className="block text-2xs text-(--status-blocked)" data-dt-cell-error={col.key}>{commitErrors[col.key]}</span>}
                            </>
                          )}
                        </td>
                      )
                    })}
                    {trailCols > 0 && (
                      <td role={interactive ? 'gridcell' : undefined} className={cn(cellPad, 'whitespace-nowrap')} data-cell={`${r}:${colCount - 1}`} tabIndex={interactive ? (focus.r === r && focus.c === colCount - 1 ? 0 : -1) : undefined}
                        onKeyDown={interactive ? (e) => onGridKey(e, r, colCount - 1, line) : undefined}>
                        {controls && pendingState && (
                          <span className="inline-flex" data-row-commit-controls>
                            <button type="button" tabIndex={-1} aria-label={`Commit row ${r + 1}`} className="rounded p-1" onClick={() => commitLine(line)}><Check size={12} aria-hidden /></button>
                            <button type="button" tabIndex={-1} aria-label={`Discard row ${r + 1}`} className="rounded p-1" onClick={() => discardLine(line)}><X size={12} aria-hidden /></button>
                          </span>
                        )}
                        {!disabled && config.allow_delete && (
                          line.kind === 'added' ? (
                            <button type="button" tabIndex={-1} aria-label="Remove new row" className="rounded p-1" onClick={() => setChanges({ ...changes, added: changes.added.filter((_, i) => i !== line.index) })}><X size={12} aria-hidden /></button>
                          ) : (
                            <button type="button" tabIndex={-1} aria-label={line.deleted ? 'Undo delete' : 'Delete row'} aria-pressed={line.deleted} className="rounded p-1" onClick={() => deleteRow(line.row)} data-dt-delete>
                              {line.deleted ? <RotateCcw size={12} aria-hidden /> : <Trash2 size={12} aria-hidden />}
                            </button>
                          )
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
              {!lines.length && (
                <tr><td colSpan={colCount} className="p-3 text-center text-fg-muted">
                  {status === 'loading' ? <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" aria-hidden /> Loading…</span>
                    : status === 'error' ? <span className="text-(--status-blocked)" role="alert">{error}</span>
                      : 'No rows match'}
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-fg-muted">
        <p id={`${id}-status`} role="status" aria-live="polite" className="flex items-center gap-1">
          {status === 'loading' && rows.length > 0 && <Loader2 size={11} className="animate-spin" aria-hidden />}
          {statusText}{pageNote}{selectText}{changeText}
        </p>
        {source && (state.page > 1 || canNext) && (
          <nav aria-label={`${field.label} pages`} className="flex items-center gap-1">
            <button type="button" className="inline-flex h-7 items-center rounded border px-1.5 disabled:opacity-40 border-border"
              disabled={state.page <= 1 || status === 'loading'} onClick={() => setState((s) => ({ ...s, page: s.page - 1 }))} aria-label="Previous page"><ChevronLeft size={12} aria-hidden /></button>
            <span>Page {state.page}{pages !== null ? ` of ${pages}` : ''}</span>
            <button type="button" className="inline-flex h-7 items-center rounded border px-1.5 disabled:opacity-40 border-border"
              disabled={!canNext || status === 'loading'} onClick={() => setState((s) => ({ ...s, page: s.page + 1 }))} aria-label="Next page"><ChevronRight size={12} aria-hidden /></button>
          </nav>
        )}
      </div>
      {status === 'error' && rows.length > 0 && <p role="alert" className="text-2xs text-(--status-blocked)">{error}</p>}
      {Object.keys(cellErrors).length > 0 && (
        <ul role="alert" className="space-y-0.5 text-2xs text-(--status-blocked)" data-dt-cell-errors>
          {Object.entries(cellErrors).map(([k, message]) => <li key={k}>Row {k.split(':')[0].replace(/^new-(\d+)$/, (_m, n) => `new ${Number(n) + 1}`)}: {message}</li>)}
        </ul>
      )}
      <ConfirmDialog open={confirmCancel} onOpenChange={setConfirmCancel} destructive
        title={`Discard ${session ? changedRowCount(session) : 0} changed row${session && changedRowCount(session) === 1 ? '' : 's'}?`}
        description="The table goes back to how it was before you pressed Edit all." confirmLabel="Discard changes"
        onConfirm={() => { setConfirmCancel(false); onChange(snapshotRef.current); valueRef.current = snapshotRef.current; ea.stop(); setAnnounceText('Changes discarded') }} />
    </div>
    </PageLabels>
    </GridSurfaceProvider>
  )
}

/**
 * A stored Data table value in read-only views (completed tasks, viewers,
 * the review step): the selected rows, or the change set (added / changed /
 * deleted rows with the changed cells marked). Formatted like the live table.
 */
export function DataTableValueView({ field, value }: { field: TaskFieldDef; value: unknown }) {
  const config = field.data_table
  if (!config) return null
  const cols = config.columns.filter((c) => !c.hidden)
  const fmt = { locale: config.locale }
  type Line = { label?: string; values: Record<string, unknown>; changed?: string[]; deleted?: boolean }
  let lines: Line[] = []
  if (config.mode === 'select') lines = (Array.isArray(value) ? value : []).map((v) => ({ values: (v ?? {}) as Record<string, unknown> }))
  if (config.mode === 'edit' && isChangeSet(value)) {
    lines = [
      ...(value.added ?? []).map((v) => ({ label: 'Added', values: v })),
      ...(value.updated ?? []).map((u) => ({ label: 'Changed', values: { ...u.before, ...u.after }, changed: u.changed_fields })),
      ...(value.deleted ?? []).map((d) => ({ label: 'Deleted', values: d.before, deleted: true })),
    ]
  }
  if (!lines.length) return <p className="text-sm text-fg">{config.mode === 'edit' ? 'No changes' : config.mode === 'select' ? 'Nothing selected' : '—'}</p>
  return (
    <div className={cn(SCROLL_BOX, 'border-border')} role="region" aria-label={`${field.label} (scrollable)`} tabIndex={0} data-dt-scroll>
      <table className="w-full border-collapse text-xs text-fg" data-dt-readonly>
        <caption className="sr-only">{field.label}</caption>
        <thead className="bg-primary-wash">
          <tr>
            {config.mode === 'edit' && <th scope="col" className={cn(cellPad, 'text-left', STICKY)} style={stickyStyle('0', HEAD_WASH)}>Change</th>}
            {cols.map((c, ci) => {
              const sticky = ci === 0 && config.mode !== 'edit'
              return <th key={c.key} scope="col" className={cn(cellPad, 'whitespace-nowrap font-semibold', alignClass(formatCell(c, null).align), sticky && STICKY)} style={sticky ? stickyStyle('0', HEAD_WASH) : undefined} data-dt-sticky={sticky || undefined}>{c.label}</th>
            })}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="border-t border-border">
              {config.mode === 'edit' && <td className={cn(cellPad, STICKY)} style={stickyStyle('0')}>{line.label}</td>}
              {cols.map((c, ci) => {
                const cell = formatCell(c, line.values[c.key], fmt)
                const sticky = ci === 0 && config.mode !== 'edit'
                return (
                  <td key={c.key} className={cn(cellPad, alignClass(cell.align), line.deleted && 'line-through', !columnFormat(c).wrap && 'whitespace-nowrap', sticky && STICKY)}
                    style={{ ...(line.changed?.includes(c.key) ? { fontWeight: 600 } : {}), ...(sticky ? stickyStyle('0') : {}) }}>
                    {usesEngine(c) ? <GridCellDisplay col={gridColumnFromForm(c)} value={line.values[c.key]} row={line.values} locale={config.locale} /> : <FormattedCellView cell={cell} wrap={columnFormat(c).wrap} />}
                    {line.changed?.includes(c.key) && <span className="sr-only"> (changed)</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
