/**
 * Data grid views of a data table (custom_tables.views) and the inline
 * cell writes they allow — the Data section's side of the shared grid
 * engine (lib/grid/column-model.ts). Shared by /api/v1/data-tables/{id}/views,
 * …/rows/{rowId}/cells, …/views/{viewId}/options, the MCP data_views_* /
 * data_rows_write_cells tools and the Data grid (app/actions/data-grid.ts).
 *
 * Permissions:
 *  - views: read with data.view, saved with data.edit_schema (like columns);
 *  - cell writes: data.manage_rows AND the saved view — inline editing on,
 *    the column in the view, editable (not read-only / hidden / calculated),
 *    the value fitting the column's control. Cells the view doesn't allow are
 *    refused even when a client sends them (no silent write). Row-level
 *    access is the table's RLS, unchanged;
 *  - bound options: data.view, the column bound in the saved view. A data
 *    table source is read with the caller's own access (RLS, key scopes); an
 *    API reference runs server-side with the workspace's credentials, as a
 *    form's autocomplete does (lib/services/form-lookup.ts).
 *
 * Concurrency: last write wins, guarded by the row's updated_at — a write
 * that names the updated_at it read is refused with a friendly conflict (and
 * the current row) when the row changed since.
 */

import {
  BOUND_CONTROLS, GRID_LIMITS, SYSTEM_COLUMN_KEYS, conflictMessage, gridCellWrite, isColumnEditable, gridViewProblem, isStaleWrite, normalizeFileValue, normalizeGridSignature, normalizeGridViews,
  pickView, rowVersion, sameGridValue, schemaColumns, type GridColumnDef, type GridViewConfig, type TableSchemaColumn,
} from '@/lib/grid/column-model'
import { LOOKUP_ROW_KEY, normalizeLookupConfig } from '@/lib/forms/lookup'
import { columnKey, normalizeRowData, type CellColumn } from '@/lib/data-table-cells'
import { normalizePeopleValue } from '@/lib/forms/people-field'
import { enqueueDataTableEvents } from '@/lib/data-table-workflow-triggers'
import { initiatorFromContext } from '@/lib/workflow-initiator'
import { isPlainObject } from '@/lib/utils/guards'
import { isServiceError, requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient, syncChange } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- jsonb columns and row data are free-form */

const ROW_COLUMNS = 'id, table_id, data, created_at, updated_at, created_by, updated_by'
const MISSING_COLUMN = '42703'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function requireTableScope(ctx: ServiceContext, tableId: string) {
  const allow = ctx.resourceScopes?.table_ids ?? []
  if (allow.length && !allow.includes(tableId)) throw ServiceError.forbidden('Forbidden: this credential is not allowed to access that table')
}

function viewsUnavailable(): ServiceError {
  return new ServiceError('internal', 'Grid views need database migration 20270116110000_data_table_views — ask an administrator to apply it', { status: 503 })
}

/** The table with its schema columns and saved views (views: [] until the migration is applied). */
async function loadTable(ctx: ServiceContext, tableId: string): Promise<{ id: string; name: string; columns: TableSchemaColumn[]; rawColumns: any[]; views: GridViewConfig[]; viewsColumn: boolean }> {
  requireTableScope(ctx, tableId)
  if (!UUID_RE.test(tableId)) throw ServiceError.notFound('Table not found')
  let viewsColumn = true
  let { data, error } = await (ctx.supabase as any).from('custom_tables').select('id, name, columns, views').eq('id', tableId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error?.code === MISSING_COLUMN) {
    viewsColumn = false
    ;({ data, error } = await (ctx.supabase as any).from('custom_tables').select('id, name, columns').eq('id', tableId).eq('tenant_id', ctx.tenantId).maybeSingle())
  }
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Table not found')
  const columns = schemaColumns(data.columns)
  return { id: data.id, name: data.name, columns, rawColumns: Array.isArray(data.columns) ? data.columns : [], views: normalizeGridViews(data.views ?? [], columns), viewsColumn }
}

/* ── Views ───────────────────────────────────────────────────────────── */

/** A table's saved views (normalised against its current columns) and its schema columns. */
export async function getTableViews(ctx: ServiceContext, tableId: string) {
  requirePerm(ctx, 'data.view')
  const table = await loadTable(ctx, tableId)
  return { table_id: table.id, views: table.views, columns: table.columns, default_view: pickView(table.views, null, table.columns) }
}

/** Check every binding names a source of this workspace (a table the caller may read; a read-only reference). */
async function checkBindings(ctx: ServiceContext, views: GridViewConfig[]) {
  const tableIds = new Set<string>()
  const referenceIds = new Set<string>()
  for (const view of views) {
    for (const col of view.columns) {
      if (!col.binding) continue
      if (col.binding.source === 'table' && col.binding.table_id) tableIds.add(col.binding.table_id)
      if (col.binding.source === 'reference' && col.binding.reference_id) referenceIds.add(col.binding.reference_id)
    }
  }
  for (const id of tableIds) {
    requireTableScope(ctx, id)
    if (!UUID_RE.test(id)) throw ServiceError.validation('A column is bound to a data table that does not exist')
  }
  if (tableIds.size) {
    const { data, error } = await (ctx.supabase as any).from('custom_tables').select('id').eq('tenant_id', ctx.tenantId).in('id', [...tableIds])
    if (error) throw dbError(error)
    const found = new Set(((data ?? []) as any[]).map((r) => String(r.id)))
    const missing = [...tableIds].filter((id) => !found.has(id))
    if (missing.length) throw ServiceError.validation('A column is bound to a data table that does not exist in this workspace')
  }
  if (referenceIds.size) {
    const ids = [...referenceIds].filter((id) => UUID_RE.test(id))
    if (ids.length !== referenceIds.size) throw ServiceError.validation('A column is bound to an API reference that does not exist')
    const db = await serviceRoleClient(ctx)
    const { data, error } = await (db as any).from('integration_references').select('id, request_config').eq('tenant_id', ctx.tenantId).in('id', ids)
    if (error) throw dbError(error)
    const rows = (data ?? []) as Array<{ id: string; request_config?: any }>
    if (rows.length !== ids.length) throw ServiceError.validation('A column is bound to an API reference that does not exist in this workspace')
    const { isWriteReference } = await import('@/lib/custom-references/types')
    if (rows.some((r) => isWriteReference(r as any))) throw ServiceError.validation('A column is bound to an API reference that writes data — bindings only read')
  }
}

/**
 * Replace a table's views (data.edit_schema). Columns are limited to the
 * table's columns; a view without columns, or a bound control without a
 * source or choices, is refused with the problem.
 */
export async function saveTableViews(ctx: ServiceContext, tableId: string, input: unknown) {
  requirePerm(ctx, 'data.edit_schema')
  const table = await loadTable(ctx, tableId)
  if (!table.viewsColumn) throw viewsUnavailable()
  if (!Array.isArray(input)) throw ServiceError.validation('views must be an array')
  const views = normalizeGridViews(input, table.columns)
  for (const view of views) {
    const problem = gridViewProblem(view)
    if (problem) throw ServiceError.validation(problem)
  }
  await checkBindings(ctx, views)
  const { data, error } = await (ctx.supabase as any).from('custom_tables')
    .update({ views, updated_at: new Date().toISOString() }).eq('id', tableId).eq('tenant_id', ctx.tenantId).select('id, name, slug, description, columns, views, updated_at').single()
  if (error || !data) throw dbError(error, 'Failed to save the views')
  await audit(ctx, {
    objectType: 'data_table', objectId: tableId, action: 'update',
    summary: `Updated the grid views of data table "${table.name}"`,
    metadata: { fields: ['views'], views: views.length, inline_edit: views.filter((v) => v.inline_edit).map((v) => v.name) },
  })
  await syncChange(ctx, 'data_table', data)
  return { table_id: tableId, views: normalizeGridViews(data.views, table.columns), columns: table.columns }
}

/* ── Cell writes ─────────────────────────────────────────────────────── */

export interface GridCellWriteInput {
  view_id: string
  cells: Record<string, unknown>
  /** The row's updated_at as the client read it: a newer row is a conflict (last write wins otherwise). */
  expected_updated_at?: string | null
}

/** Bound cells: every value must be one the column's source offers (with this row as {{row.<column>}}), unless free text is allowed. */
async function verifyBoundCells(ctx: ServiceContext, view: GridViewConfig, tableId: string, cells: Record<string, unknown>, row: Record<string, unknown>, errors: Record<string, string>) {
  const { confirmBoundValues } = await import('./form-lookup')
  for (const [key, value] of Object.entries(cells)) {
    const col = view.columns.find((c) => c.key === key)
    if (!col?.binding || !BOUND_CONTROLS.has(col.control) || col.binding.allow_free_text) continue
    const values = (Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value]).map(String)
    if (!values.length) continue
    const binding = normalizeLookupConfig(col.binding)
    if (binding.source === 'table' && binding.table_id) requireTableScope(ctx, binding.table_id)
    const db = binding.source === 'table' ? ctx.supabase : await serviceRoleClient(ctx)
    let found = new Map<string, unknown>()
    try {
      found = await confirmBoundValues(db as any, ctx.tenantId, binding, values, { [LOOKUP_ROW_KEY]: row }, { key: gridServedScope(tableId, view.id, ctx), column: key })
    } catch { /* judged below as not offered */ }
    const missing = values.find((v) => !found.has(v))
    if (missing) errors[key] = `${col.label}: "${missing.slice(0, 60)}" is not one of the options`
  }
}

/** People cells: users / teams of this workspace only; names from the workspace, never the client's. */
async function settlePeopleCells(ctx: ServiceContext, view: GridViewConfig, cells: Record<string, unknown>, errors: Record<string, string>) {
  for (const [key, value] of Object.entries(cells)) {
    const col = view.columns.find((c) => c.key === key)
    if (col?.control !== 'people' || value === null) continue
    const refs = normalizePeopleValue(value)
    const userIds = refs.filter((r) => r.kind === 'user').map((r) => r.id)
    const teamIds = refs.filter((r) => r.kind === 'team').map((r) => r.id)
    const names = new Map<string, string>()
    if (userIds.length) {
      const db = await serviceRoleClient(ctx)
      const { data: members } = await (db as any).from('user_memberships').select('user_id').eq('tenant_id', ctx.tenantId).eq('is_active', true).in('user_id', userIds)
      const ids = ((members ?? []) as any[]).map((m) => String(m.user_id))
      if (ids.length) {
        const { data: users } = await (db as any).from('users').select('id, display_name, email').in('id', ids)
        for (const u of (users ?? []) as any[]) names.set(`user:${u.id}`, u.display_name || u.email || 'A person')
      }
    }
    if (teamIds.length) {
      const { data } = await (ctx.supabase as any).from('teams').select('id, name').eq('tenant_id', ctx.tenantId).in('id', teamIds)
      for (const t of (data ?? []) as any[]) names.set(`team:${t.id}`, t.name || 'A team')
    }
    const unknown = refs.find((r) => !names.has(`${r.kind}:${r.id}`))
    if (unknown) { errors[key] = `${col.label}: someone picked is not in this workspace`; continue }
    cells[key] = refs.map((r) => ({ ...r, name: names.get(`${r.kind}:${r.id}`) }))
  }
}

/** File / signature cells: a new file must be one stored for THIS table; a new signature is stamped with who signed and when (the server's facts). */
function settleFileCells(ctx: ServiceContext, view: GridViewConfig, tableId: string, cells: Record<string, unknown>, before: Record<string, unknown>, errors: Record<string, string>, signer: string | null) {
  for (const [key, value] of Object.entries(cells)) {
    const col = view.columns.find((c) => c.key === key)
    if (!col || (col.control !== 'file' && col.control !== 'signature') || value === null) continue
    const file = col.control === 'file' ? normalizeFileValue(value) : normalizeGridSignature(value)?.file ?? null
    const previous = col.control === 'file' ? normalizeFileValue(before[key]) : normalizeGridSignature(before[key])?.file ?? null
    if (!file) continue
    const unchanged = previous && previous.url === file.url
    if (!unchanged && !(file.path && file.path.startsWith(`data-tables/${tableId}/`))) { errors[key] = `${col.label}: upload the file to this table first`; continue }
    if (col.control === 'signature' && !unchanged) {
      const sig = normalizeGridSignature(value)!
      cells[key] = { ...sig, signed_at: new Date().toISOString(), ...(ctx.actorId ? { user_id: ctx.actorId } : {}), ...(signer ? { user_name: signer } : {}) }
    }
  }
}

/** The served-items scope of a grid view (reference values confirmed on write). */
function gridServedScope(tableId: string, viewId: string, ctx: ServiceContext): string {
  return `grid:${tableId}:${viewId}:${ctx.actorId ?? 'key'}`
}

type LoadedTable = Awaited<ReturnType<typeof loadTable>>

/** The table's schema columns as cell columns (legacy name-keyed cells converge onto keys). */
function cellColumnsOf(table: LoadedTable): CellColumn[] {
  return table.rawColumns.filter((c: any) => c && (c.key || c.name)).map((c: any) => ({ key: c.key, name: String(c.name ?? c.key) }))
}

/** The view a write names (inline editing is judged per write by gridCellWrite). */
function viewFor(table: LoadedTable, viewId: string): GridViewConfig {
  const view = table.views.find((v) => v.id === viewId)
  if (!view) throw ServiceError.notFound(table.viewsColumn ? 'That view does not exist on this table' : 'Grid views need database migration 20270116110000_data_table_views')
  return view
}

async function userName(ctx: ServiceContext, id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const { data: u } = await (ctx.supabase as any).from('users').select('display_name, email').eq('id', id).maybeSingle()
  return u ? u.display_name || u.email || null : null
}

/** Signature cells are stamped with the signer's name (read once per request). */
function signerLoader(ctx: ServiceContext) {
  let signer: Promise<string | null> | null = null
  return () => (signer ??= userName(ctx, ctx.actorId))
}

/** Bound values, people, files and signatures of one row's cells, settled on the server (errors per column). */
async function settleCells(ctx: ServiceContext, view: GridViewConfig, tableId: string, cells: Record<string, unknown>, before: Record<string, unknown>, signer: () => Promise<string | null>): Promise<Record<string, string>> {
  const errors: Record<string, string> = {}
  await verifyBoundCells(ctx, view, tableId, cells, { ...before, ...cells }, errors)
  await settlePeopleCells(ctx, view, cells, errors)
  const signs = view.columns.some((c) => c.control === 'signature' && c.key in cells)
  settleFileCells(ctx, view, tableId, cells, before, errors, ctx.actorId && signs ? await signer() : null)
  return errors
}

/**
 * One row's write through the view — the shared core of writeGridCells
 * (one row) and writeGridRows (a batch): checked by gridCellWrite, the
 * updated_at guard, unchanged cells dropped, bound / people / file cells
 * settled, then written only while the row is still the version checked.
 * Does NOT queue workflows: the callers queue one event per changed row.
 */
async function writeRowThroughView(ctx: ServiceContext, table: LoadedTable, view: GridViewConfig, rowId: string, input: Omit<GridCellWriteInput, 'view_id'>, opts: { current?: any; signer: () => Promise<string | null> }) {
  const checked = gridCellWrite(view, isPlainObject(input.cells) ? input.cells : {})
  if (checked.errors._) throw ServiceError.validation(checked.errors._)
  if (Object.keys(checked.errors).length) throw ServiceError.validation(Object.values(checked.errors)[0], { cells: checked.errors })

  if (!UUID_RE.test(rowId)) throw ServiceError.notFound('Row not found in this table')
  let current = opts.current
  if (current === undefined) {
    const { data, error: readError } = await (ctx.supabase as any).from('custom_table_rows')
      .select(ROW_COLUMNS).eq('id', rowId).eq('table_id', table.id).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (readError) throw dbError(readError)
    current = data
  }
  if (!current) throw ServiceError.notFound('Row not found in this table')
  const before = normalizeRowData(current.data ?? {}, cellColumnsOf(table))

  if (isStaleWrite(input.expected_updated_at, current)) {
    const by = await userName(ctx, current.updated_by)
    throw new ServiceError('conflict', conflictMessage(by), { status: 409, details: { row: current, updated_by_name: by } })
  }

  const cells = { ...checked.cells }
  // Unchanged cells need no checks (a stale label or a since-removed option must not block other edits).
  for (const key of Object.keys(cells)) if (sameGridValue(cells[key], before[key])) delete cells[key]
  if (!Object.keys(cells).length) return { row: current, updated_at: current.updated_at ?? current.created_at, changed: [] as string[], data: before }
  const errors = await settleCells(ctx, view, table.id, cells, before, opts.signer)
  if (Object.keys(errors).length) throw ServiceError.validation(Object.values(errors)[0], { cells: errors })

  const data = { ...before, ...cells }
  // Canonical keys (a legacy name-keyed cell converges, as the grid's own writes do).
  for (const col of table.columns) if (col.key !== columnKey({ key: col.key, name: col.name })) delete data[col.name]
  const now = new Date().toISOString()
  let update = (ctx.supabase as any).from('custom_table_rows')
    .update({ data, updated_by: ctx.actorId, updated_at: now })
    .eq('id', rowId).eq('table_id', table.id).eq('tenant_id', ctx.tenantId)
  // The guard: only while the row is still the version we checked (another write in between → conflict).
  if (current.updated_at) update = update.eq('updated_at', current.updated_at)
  const { data: updated, error } = await update.select(ROW_COLUMNS).maybeSingle()
  if (error) throw dbError(error, 'Failed to save the cell')
  if (!updated) {
    // Nothing updated: someone else's write in between (a conflict), or the row's access rules don't let this person change it.
    const { data: now2 } = await (ctx.supabase as any).from('custom_table_rows').select(ROW_COLUMNS).eq('id', rowId).eq('table_id', table.id).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (now2 && (now2.updated_at ?? null) === (current.updated_at ?? null)) throw ServiceError.forbidden('You can\'t change this row')
    throw new ServiceError('conflict', conflictMessage(await userName(ctx, now2?.updated_by)), { status: 409, details: { row: now2 ?? null } })
  }
  return { row: updated, updated_at: updated.updated_at ?? now, changed: Object.keys(cells), data }
}

/**
 * Write one row's cells through a saved view (inline editing): checked by
 * gridCellWrite (inline editing on, editable columns only, values fitting
 * their controls), bound values confirmed in their sources, people names
 * and signatures settled on the server, then written with an updated_at
 * guard. Fires the table's `updated` workflows.
 */
export async function writeGridCells(ctx: ServiceContext, tableId: string, rowId: string, input: GridCellWriteInput) {
  requirePerm(ctx, 'data.manage_rows')
  const table = await loadTable(ctx, tableId)
  const view = viewFor(table, input.view_id)
  const res = await writeRowThroughView(ctx, table, view, rowId, input, { signer: signerLoader(ctx) })
  if (res.changed.length) await enqueueDataTableEvents({ supabase: ctx.supabase as any, tenantId: ctx.tenantId, tableId, events: [{ rowId, rowData: res.data, eventType: 'updated' }], initiator: initiatorFromContext(ctx) })
  return { row: res.row, updated_at: res.updated_at, changed: res.changed }
}

/* ── Batch writes ("Edit all rows") ──────────────────────────────────── */

export const GRID_BATCH_LIMITS = {
  /** Rows (edited + new) one batch may carry: a full page of the largest page size. */
  rows: GRID_LIMITS.pageSize,
  /** New rows one batch may insert. */
  inserts: 200,
  /** Rows written at the same time. */
  concurrency: 6,
} as const

export interface GridRowsWriteInput {
  view_id: string
  /** Edited rows: each with its changed cells and the updated_at it was edited against. */
  rows?: Array<{ row_id: string; cells: Record<string, unknown>; expected_updated_at?: string | null }>
  /** New rows (the view must allow adding rows): `client_id` comes back with the outcome. */
  inserts?: Array<{ client_id?: string; cells: Record<string, unknown> }>
}

export type GridRowOutcome =
  | { row_id: string; status: 'saved' | 'unchanged'; row: Record<string, unknown>; updated_at: string; changed: string[] }
  | { row_id: string; status: 'conflict'; error: string; current: Record<string, unknown> | null; updated_by_name?: string | null }
  | { row_id: string; status: 'invalid' | 'not_found' | 'forbidden' | 'error'; error: string; cells?: Record<string, string> }

export type GridInsertOutcome =
  | { client_id: string; status: 'saved'; row: Record<string, unknown> }
  | { client_id: string; status: 'invalid' | 'forbidden' | 'error'; error: string; cells?: Record<string, string> }

function outcomeOf(rowId: string, error: unknown): GridRowOutcome {
  if (isServiceError(error)) {
    const details = (error.details ?? {}) as { row?: Record<string, unknown> | null; cells?: Record<string, string>; updated_by_name?: string | null }
    if (error.code === 'conflict') return { row_id: rowId, status: 'conflict', error: error.message, current: details.row ?? null, updated_by_name: details.updated_by_name ?? null }
    const status = error.code === 'not_found' ? 'not_found' : error.code === 'forbidden' ? 'forbidden' : error.code === 'validation_error' ? 'invalid' : 'error'
    return { row_id: rowId, status, error: error.message, ...(details.cells ? { cells: details.cells } : {}) }
  }
  console.error('[writeGridRows]', error)
  return { row_id: rowId, status: 'error', error: 'The row could not be saved — try again.' }
}

/** Run `fn` over `items` with at most `limit` at a time, results in order. */
async function inPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]) }
  }))
  return out
}

/**
 * "Edit all rows": write many rows through a saved view in one request.
 * Every row goes through exactly the checks of a single inline write
 * (writeRowThroughView: inline editing on, editable columns only, values
 * fitting their controls, bound values / people / files settled, the
 * row's updated_at guard, the table's RLS) and gets its own outcome —
 * saved, unchanged, conflict (with the current row), invalid (errors per
 * column), not_found or forbidden. One row's refusal never stops the
 * others; nothing is rolled back. New rows need the view's "Add rows" and
 * every required editable column. Workflows: ONE `updated` event per row
 * whose cells actually changed (unchanged and refused rows fire nothing),
 * one `created` event per inserted row, queued together once.
 */
export async function writeGridRows(ctx: ServiceContext, tableId: string, input: GridRowsWriteInput) {
  requirePerm(ctx, 'data.manage_rows')
  const rows = Array.isArray(input?.rows) ? input.rows : []
  const inserts = Array.isArray(input?.inserts) ? input.inserts : []
  if (!rows.length && !inserts.length) throw ServiceError.validation('No rows to save')
  if (rows.length + inserts.length > GRID_BATCH_LIMITS.rows) throw ServiceError.validation(`At most ${GRID_BATCH_LIMITS.rows} rows per save`)
  if (inserts.length > GRID_BATCH_LIMITS.inserts) throw ServiceError.validation(`At most ${GRID_BATCH_LIMITS.inserts} new rows per save`)
  const ids = rows.map((r) => (isPlainObject(r) ? String(r.row_id ?? '') : ''))
  if (new Set(ids).size !== ids.length) throw ServiceError.validation('A row appears more than once in the save')
  const table = await loadTable(ctx, tableId)
  const view = viewFor(table, String(input.view_id ?? ''))
  if (!view.inline_edit) throw ServiceError.validation('Inline editing is turned off for this view')
  const signer = signerLoader(ctx)

  // The rows as they are now, in one read (RLS applies: rows this person can't read are "not found").
  const valid = ids.filter((id) => UUID_RE.test(id))
  const current = new Map<string, any>()
  if (valid.length) {
    const { data, error } = await (ctx.supabase as any).from('custom_table_rows').select(ROW_COLUMNS).eq('table_id', tableId).eq('tenant_id', ctx.tenantId).in('id', valid)
    if (error) throw dbError(error)
    for (const row of (data ?? []) as any[]) current.set(String(row.id), row)
  }

  const events: Array<{ rowId: string; rowData: Record<string, unknown>; eventType: 'updated' | 'created' }> = []
  const rowResults = await inPool(rows, GRID_BATCH_LIMITS.concurrency, async (entry, ): Promise<GridRowOutcome> => {
    const rowId = isPlainObject(entry) ? String(entry.row_id ?? '') : ''
    try {
      if (!isPlainObject(entry)) throw ServiceError.validation('A row is not in the expected shape')
      const res = await writeRowThroughView(ctx, table, view, rowId, { cells: entry.cells as Record<string, unknown>, expected_updated_at: entry.expected_updated_at ?? null }, { current: current.get(rowId) ?? null, signer })
      if (res.changed.length) events.push({ rowId, rowData: res.data, eventType: 'updated' })
      return { row_id: rowId, status: res.changed.length ? 'saved' : 'unchanged', row: res.row, updated_at: res.updated_at, changed: res.changed }
    } catch (error) {
      return outcomeOf(rowId, error)
    }
  })

  const insertResults: GridInsertOutcome[] = []
  if (inserts.length) {
    const addAllowed = view.allow_add === true
    // System cells, as the grid's Add row fills them in.
    const idColumn = table.rawColumns.some((c: any) => c?.key === 'id' && c?.type === 'number')
    const dateColumn = table.rawColumns.some((c: any) => c?.key === 'date_created')
    let nextNumber: number | null = null
    const today = new Date().toISOString().split('T')[0]
    const required = view.columns.filter((c) => c.required && isColumnEditable(c) && !SYSTEM_COLUMN_KEYS.has(c.key))
    for (const [index, entry] of inserts.entries()) {
      const clientId = isPlainObject(entry) && typeof entry.client_id === 'string' ? entry.client_id.slice(0, 64) : `new-${index + 1}`
      try {
        if (!addAllowed) throw ServiceError.forbidden('This view does not allow adding rows')
        if (!isPlainObject(entry) || !isPlainObject(entry.cells)) throw ServiceError.validation('A new row is not in the expected shape')
        const given = Object.fromEntries(Object.entries(entry.cells).filter(([, v]) => v !== undefined))
        const checked = Object.keys(given).length ? gridCellWrite(view, given) : { cells: {}, errors: {} as Record<string, string> }
        const errors: Record<string, string> = { ...checked.errors }
        delete errors._
        if (checked.errors._) throw ServiceError.validation(checked.errors._)
        for (const col of required) {
          const v = checked.cells[col.key]
          if (!errors[col.key] && (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length))) errors[col.key] = `${col.label} is required`
        }
        if (Object.keys(errors).length) throw ServiceError.validation(Object.values(errors)[0], { cells: errors })
        const cells = { ...checked.cells }
        const settled = await settleCells(ctx, view, tableId, cells, {}, signer)
        if (Object.keys(settled).length) throw ServiceError.validation(Object.values(settled)[0], { cells: settled })
        const data: Record<string, unknown> = { ...cells }
        if (idColumn) {
          if (nextNumber === null) {
            const { data: latest } = await (ctx.supabase as any).from('custom_table_rows').select('data').eq('table_id', tableId).eq('tenant_id', ctx.tenantId).order('created_at', { ascending: false }).limit(1)
            nextNumber = (Array.isArray(latest) && latest.length ? Number(latest[0]?.data?.id) || 0 : 0) + 1
          }
          data.id = nextNumber++
        }
        if (dateColumn) data.date_created = today
        const { data: inserted, error } = await (ctx.supabase as any).from('custom_table_rows')
          .insert({ table_id: tableId, tenant_id: ctx.tenantId, data, created_by: ctx.actorId, updated_by: ctx.actorId }).select(ROW_COLUMNS).single()
        if (error || !inserted) throw dbError(error, 'Failed to add the row')
        events.push({ rowId: inserted.id, rowData: data, eventType: 'created' })
        insertResults.push({ client_id: clientId, status: 'saved', row: inserted })
      } catch (error) {
        const o = outcomeOf(clientId, error)
        insertResults.push({ client_id: clientId, status: o.status === 'forbidden' ? 'forbidden' : o.status === 'invalid' ? 'invalid' : 'error', error: 'error' in o ? o.error : 'The row could not be added', ...('cells' in o && o.cells ? { cells: o.cells } : {}) })
      }
    }
  }

  // Workflows: once per changed / inserted row, in one queue call.
  if (events.length) await enqueueDataTableEvents({ supabase: ctx.supabase as any, tenantId: ctx.tenantId, tableId, events, initiator: initiatorFromContext(ctx) })
  const saved = rowResults.filter((r) => r.status === 'saved').length + insertResults.filter((r) => r.status === 'saved').length
  const failed = rowResults.filter((r) => r.status !== 'saved' && r.status !== 'unchanged').length + insertResults.filter((r) => r.status !== 'saved').length
  if (saved) {
    await audit(ctx, {
      objectType: 'data_table', objectId: tableId, action: 'update',
      summary: `Saved ${saved} row${saved === 1 ? '' : 's'} of data table "${table.name}" (edit all rows)`,
      metadata: { view_id: view.id, saved, failed, inserted: insertResults.filter((r) => r.status === 'saved').length },
    })
  }
  return { table_id: tableId, view_id: view.id, rows: rowResults, inserts: insertResults, saved, failed }
}

/* ── Bound options ───────────────────────────────────────────────────── */

export interface GridOptionsInput {
  column: string
  query?: string
  resolve?: string[]
  /** The row being edited ({{row.<column>}}): plain values of the view's columns only are used. */
  row?: Record<string, unknown>
}

/** A bound column's options (search, or labels for stored values) — from the SAVED view's binding, never the request's. */
export async function gridColumnOptions(ctx: ServiceContext, tableId: string, viewId: string, input: GridOptionsInput) {
  requirePerm(ctx, 'data.view')
  const table = await loadTable(ctx, tableId)
  const view = table.views.find((v) => v.id === viewId) ?? (viewId === 'default' ? pickView([], null, table.columns) : undefined)
  if (!view) throw ServiceError.notFound('That view does not exist on this table')
  const col: GridColumnDef | undefined = view.columns.find((c) => c.key === input.column)
  if (!col?.binding) throw ServiceError.notFound(`"${String(input.column).slice(0, 64)}" is not a bound column of this view`)
  const binding = normalizeLookupConfig(col.binding)
  if (binding.source === 'table' && binding.table_id) requireTableScope(ctx, binding.table_id)
  const { lookupRateLimit, runBoundLookup } = await import('./form-lookup')
  await lookupRateLimit(ctx)
  const row: Record<string, unknown> = {}
  if (isPlainObject(input.row)) {
    for (const c of view.columns) {
      const v = input.row[c.key]
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) row[c.key] = typeof v === 'string' ? v.slice(0, 500) : v
    }
  }
  // A table source with the caller's own access (RLS); a reference with the workspace's credentials, server-side.
  const db = binding.source === 'table' ? ctx.supabase : await serviceRoleClient(ctx)
  const resolve = Array.isArray(input.resolve) ? input.resolve.map(String).filter(Boolean).slice(0, 50) : undefined
  return runBoundLookup(db as any, ctx.tenantId, binding, { query: input.query, values: { [LOOKUP_ROW_KEY]: row }, resolve }, { key: gridServedScope(tableId, view.id, ctx), column: col.key })
}

/** The row version the client keeps for the conflict check. */
export { rowVersion }
