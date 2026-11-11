/**
 * Import CSV / TSV / .xlsx files into a data table: POST
 * /api/v1/data-tables/{id}/rows/import, the MCP / Agent tool
 * data_rows_import, `usertasks rows import`, and the import wizard (as the
 * `data.import` background job, lib/user-jobs/kinds/data.ts).
 *
 * Steps: read the file (lib/data-import/parse, ./xlsx) → match headers to
 * columns (or the caller's mapping; `new_columns` adds columns first) →
 * validate and convert every row (lib/data-import/rows) → write in batches
 * of DATA_IMPORT_LIMITS.batchSize:
 *
 *   insert  — every valid row is a new row;
 *   upsert  — rows whose key column value matches an existing row update it
 *             (cells not in the file are kept), the rest are inserted;
 *   replace — every existing row is deleted first (typed confirmation:
 *             `confirm_replace` = the table name; audited), then all inserted.
 *
 * Rows with errors stop the import unless `skip_invalid` (import the valid
 * rows only). Permissions are those of writing rows (data.manage_rows, the
 * credential's table scope, the tenant), plus data.edit_schema for
 * new_columns. Writes are audited once per import (and once for a replace's
 * delete). Values are stored as plain data: nothing is evaluated.
 *
 * Workflow triggers: `fire_triggers` (default true — like POST
 * /data-tables/{id}/rows, which fires data_table_event workflows for every
 * created / updated row) queues the created / updated events per batch;
 * false writes rows silently. A replace's deleted rows go through the
 * deletion queue, which removes their stored files and (when triggers fire)
 * fires `deleted` workflows.
 */

import { gunzipSync } from 'node:zlib'
import { normalizeRowData, slugifyColumnName, type CellColumn } from '@/lib/data-table-cells'
import { enqueueDataTableEvents, type DataTableEvent } from '@/lib/data-table-workflow-triggers'
import { initiatorFromContext } from '@/lib/workflow-initiator'
import { DATA_IMPORT_LIMITS, formatFromName, ImportFileError, parseTextFile, type ImportDelimiter, type ImportEncoding, type ParsedImportFile } from '@/lib/data-import/parse'
import {
  checkUpsertKeys, isImportableColumn, resolveMapping, upsertKeyOf, validateRows,
  type DateOrder, type EmptyCells, type ImportableColumnType, type ImportMapping, type ImportRowError, type ImportTargetColumn, type ValidationResult,
} from '@/lib/data-import/rows'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError, queueDeletions } from './_shared'
import { updateDataTable } from './data-tables'

/* eslint-disable @typescript-eslint/no-explicit-any -- row data is free-form jsonb */

export type ImportMode = 'insert' | 'upsert' | 'replace'

export interface NewColumnInput {
  /** File header the column is filled from. */
  header: string
  name?: string
  type?: ImportableColumnType
  options?: string[]
  required?: boolean
}

export interface DataImportOptions {
  file_name: string
  sheet?: string | null
  delimiter?: ImportDelimiter | 'auto' | null
  encoding?: ImportEncoding | 'auto' | null
  /** File header → column key or name (null = skip). Headers left out are matched by name. */
  mapping?: ImportMapping | null
  new_columns?: NewColumnInput[] | null
  mode?: ImportMode
  /** upsert: the column (key or name) whose value identifies a row. */
  key_column?: string | null
  /** replace: must equal the table name. */
  confirm_replace?: string | null
  date_order?: DateOrder | 'auto' | null
  trim?: boolean
  empty_cells?: EmptyCells
  /** Import the valid rows and skip the rest (default false: any error stops the import). */
  skip_invalid?: boolean
  /** Queue data_table_event workflows for created / updated rows (default true). */
  fire_triggers?: boolean
  dry_run?: boolean
}

export interface ImportCounts {
  rows: number
  valid: number
  invalid: number
  inserted: number
  updated: number
  skipped: number
  failed: number
  deleted: number
}

export interface ImportReport {
  table_id: string
  dry_run: boolean
  /** Rows were written (false for a dry run, or when errors stopped the import). */
  imported: boolean
  mode: ImportMode
  file: { name: string; format: string; encoding?: string; delimiter?: string; sheet?: string; sheets?: string[]; rows: number; headers: string[] }
  mapping: ImportMapping
  date_order: DateOrder
  key_column: string | null
  fire_triggers: boolean
  columns_created: string[]
  counts: ImportCounts
  /** Row errors (validation, then write failures), at most DATA_IMPORT_LIMITS.maxReportedErrors. */
  errors: ImportRowError[]
  errors_truncated: boolean
  /** First rows as they would be stored. */
  preview: Array<Record<string, unknown>>
}

/** Resumable write state (a background job's checkpoint). */
export interface ImportState {
  offset: number
  columns_created: string[]
  replaced: boolean
  deleted: number
  inserted: number
  updated: number
  failed: number
  failures: ImportRowError[]
  audited_start: boolean
}

export interface ImportHooks {
  progress?: (percent: number, message?: string) => Promise<void>
  /** ms left in this invocation; the import hands back (returns `state`) when it runs low. */
  timeLeft?: () => number
  /** Refuse to write more rows than this in one call (inline API / MCP calls). */
  maxRows?: number
}

const ROW_COLUMNS = 'id, data'

// ─── Reading ────────────────────────────────────────────────────────────────

/** Uploaded bytes: gzip (the wizard compresses CSV before sending) is unpacked within the size limit. */
export function unpackUpload(bytes: Uint8Array): Uint8Array {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      return new Uint8Array(gunzipSync(bytes, { maxOutputLength: DATA_IMPORT_LIMITS.maxBytes + 1 }))
    } catch (error) {
      if (error instanceof RangeError || /maxOutputLength|buffer/i.test(String((error as Error)?.message))) {
        throw ServiceError.validation(`The file is larger than ${DATA_IMPORT_LIMITS.maxBytes / 1024 / 1024} MB`)
      }
      throw ServiceError.validation('The compressed upload could not be read')
    }
  }
  return bytes
}

export function decodeBase64(value: string): Uint8Array {
  const clean = String(value ?? '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
  if (!clean) throw ServiceError.validation('The file is empty')
  if (clean.length > Math.ceil((DATA_IMPORT_LIMITS.maxBytes * 4) / 3) + 8) {
    throw ServiceError.validation(`The file is larger than ${DATA_IMPORT_LIMITS.maxBytes / 1024 / 1024} MB`)
  }
  return new Uint8Array(Buffer.from(clean, 'base64'))
}

/** Parse the upload (CSV / TSV / .xlsx by name; .xlsx also by its zip signature). */
export async function readImportFile(raw: Uint8Array, options: Pick<DataImportOptions, 'file_name' | 'sheet' | 'delimiter' | 'encoding'>): Promise<ParsedImportFile> {
  const bytes = unpackUpload(raw)
  const byName = formatFromName(options.file_name)
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b
  try {
    if (byName === 'xlsx' || (zip && byName !== 'csv' && byName !== 'tsv')) {
      const { parseXlsx } = await import('@/lib/data-import/xlsx')
      return await parseXlsx(bytes, { sheet: options.sheet })
    }
    if (zip) throw new ImportFileError('This looks like an Excel workbook: name it .xlsx')
    if (!byName && /\.(xls|xlsm|xlsb|ods|numbers)$/i.test(options.file_name)) {
      throw new ImportFileError('Only .csv, .tsv and .xlsx files can be imported. Save the file as .xlsx or CSV first.')
    }
    return parseTextFile(bytes, { fileName: options.file_name, delimiter: options.delimiter, encoding: options.encoding })
  } catch (error) {
    if (error instanceof ImportFileError) throw ServiceError.validation(error.message)
    throw error
  }
}

// ─── Planning ───────────────────────────────────────────────────────────────

async function loadImportTable(ctx: ServiceContext, tableId: string) {
  const allow = ctx.resourceScopes?.table_ids ?? []
  if (allow.length && !allow.includes(tableId)) throw ServiceError.forbidden('Forbidden: this credential is not allowed to access that table')
  const { data, error } = await (ctx.supabase as any).from('custom_tables')
    .select('id, name, columns').eq('id', tableId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Table not found')
  return data as { id: string; name: string; columns: any[] }
}

function targetColumns(columns: any[]): ImportTargetColumn[] {
  return (Array.isArray(columns) ? columns : [])
    .filter((col) => col && (col.key || col.name))
    .map((col) => ({ key: String(col.key || slugifyColumnName(String(col.name))), name: String(col.name ?? col.key), type: String(col.type ?? 'text'), required: Boolean(col.required), ...(Array.isArray(col.options) ? { options: col.options.map(String) } : {}) }))
}

/** Columns to add: unique keys (an existing column with the same key is reused when it was created by this import). */
function plannedNewColumns(existing: ImportTargetColumn[], requested: NewColumnInput[], headers: string[], alreadyCreated: string[]) {
  const keys = new Set(existing.map((col) => col.key))
  const out: Array<ImportTargetColumn & { header: string; exists: boolean }> = []
  for (const input of requested) {
    const header = headers.find((h) => h === input.header) ?? headers.find((h) => h.trim().toLowerCase() === String(input.header ?? '').trim().toLowerCase())
    if (!header) throw ServiceError.validation(`new_columns: the file has no column "${input.header}"`)
    const name = String(input.name ?? header).trim() || header
    const type = input.type ?? 'text'
    if (!(['text', 'longtext', 'number', 'date', 'boolean', 'select'] as string[]).includes(type)) throw ServiceError.validation(`new_columns: "${name}" has an unsupported type "${type}"`)
    const base = slugifyColumnName(name) || 'column'
    const reuse = alreadyCreated.includes(base) && keys.has(base)
    let key = base
    if (!reuse) for (let n = 2; keys.has(key) || key === 'id' || key === 'date_created'; n++) key = `${base}_${n}`
    keys.add(key)
    const options = type === 'select' ? (input.options ?? []).map(String).filter(Boolean) : undefined
    out.push({ header, key, name, type, required: Boolean(input.required), ...(options ? { options } : {}), exists: reuse })
  }
  return out
}

interface ImportPlan {
  table: { id: string; name: string; columns: any[] }
  file: ParsedImportFile
  columns: ImportTargetColumn[]
  newColumns: Array<ImportTargetColumn & { header: string; exists: boolean }>
  mapping: ImportMapping
  validation: ValidationResult
  mode: ImportMode
  keyColumn: ImportTargetColumn | null
  options: DataImportOptions
}

/** Everything up to (not including) the writes: permission, file, mapping, validation. */
export async function planImport(ctx: ServiceContext, tableId: string, bytes: Uint8Array, options: DataImportOptions, alreadyCreated: string[] = []): Promise<ImportPlan> {
  requirePerm(ctx, 'data.manage_rows')
  const newRequested = options.new_columns ?? []
  if (newRequested.length) requirePerm(ctx, 'data.edit_schema')
  const table = await loadImportTable(ctx, tableId)
  const file = await readImportFile(bytes, options)
  const existing = targetColumns(table.columns)
  const newColumns = plannedNewColumns(existing, newRequested, file.headers, alreadyCreated)
  const columns = [...existing.filter((col) => !newColumns.some((n) => n.exists && n.key === col.key)), ...newColumns]

  const requested: ImportMapping | null = options.mapping || newColumns.length
    ? { ...(options.mapping ?? {}), ...Object.fromEntries(newColumns.map((col) => [col.header, col.key])) }
    : null
  const { mapping, problems } = resolveMapping(file.headers, columns, requested)
  if (problems.length) throw ServiceError.validation(`Column mapping: ${problems.join('; ')}`, { problems })
  if (!Object.values(mapping).some(Boolean)) throw ServiceError.validation('No file column is mapped to a table column: check the headers or pass a mapping')

  const mode: ImportMode = options.mode ?? 'insert'
  let keyColumn: ImportTargetColumn | null = null
  if (mode === 'upsert') {
    const wanted = String(options.key_column ?? '').trim()
    if (!wanted) throw ServiceError.validation('Upsert needs key_column: the column whose value identifies a row')
    keyColumn = columns.find((col) => col.key === wanted) ?? columns.find((col) => col.name.trim().toLowerCase() === wanted.toLowerCase()) ?? null
    if (!keyColumn) throw ServiceError.validation(`key_column "${wanted}" is not a column of this table`)
    if (!Object.values(mapping).includes(keyColumn.key)) throw ServiceError.validation(`The key column "${keyColumn.name}" must be mapped to a file column`)
  }

  let validation = validateRows(file.headers, file.rows, columns, mapping, { trim: options.trim, date_order: options.date_order, empty_cells: options.empty_cells })
  if (keyColumn) {
    const keyHeader = Object.entries(mapping).find(([, key]) => key === keyColumn!.key)![0]
    validation = checkUpsertKeys(validation, keyColumn, keyHeader)
  }
  return { table, file, columns, newColumns, mapping, validation, mode, keyColumn, options }
}

function emptyState(): ImportState {
  return { offset: 0, columns_created: [], replaced: false, deleted: 0, inserted: 0, updated: 0, failed: 0, failures: [], audited_start: false }
}

function report(plan: ImportPlan, state: ImportState, flags: { dry_run: boolean; imported: boolean }): ImportReport {
  const { file, validation } = plan
  const skipped = plan.options.skip_invalid || flags.dry_run ? validation.invalidRows.length : 0
  const all = [...validation.errors, ...state.failures]
  return {
    table_id: plan.table.id,
    dry_run: flags.dry_run,
    imported: flags.imported,
    mode: plan.mode,
    file: {
      name: plan.options.file_name, format: file.format, rows: file.rows.length, headers: file.headers,
      ...(file.encoding ? { encoding: file.encoding } : {}), ...(file.delimiter ? { delimiter: file.delimiter } : {}),
      ...(file.sheet ? { sheet: file.sheet, sheets: file.sheets } : {}),
    },
    mapping: plan.mapping,
    date_order: validation.dateOrder,
    key_column: plan.keyColumn?.key ?? null,
    fire_triggers: plan.options.fire_triggers ?? true,
    columns_created: flags.dry_run ? plan.newColumns.map((col) => col.key) : state.columns_created,
    counts: {
      rows: file.rows.length,
      valid: validation.valid.length,
      invalid: validation.invalidRows.length,
      inserted: state.inserted,
      updated: state.updated,
      skipped: flags.imported || flags.dry_run ? skipped : file.rows.length,
      failed: state.failed,
      deleted: state.deleted,
    },
    errors: all.slice(0, DATA_IMPORT_LIMITS.maxReportedErrors),
    errors_truncated: all.length > DATA_IMPORT_LIMITS.maxReportedErrors,
    preview: validation.valid.slice(0, 5).map((row) => row.data),
  }
}

// ─── Writing ────────────────────────────────────────────────────────────────

async function nextIdNumber(ctx: ServiceContext, tableId: string): Promise<number> {
  const { data } = await (ctx.supabase as any).from('custom_table_rows')
    .select('data').eq('table_id', tableId).eq('tenant_id', ctx.tenantId).order('created_at', { ascending: false }).limit(1)
  return (Array.isArray(data) && data.length ? Number(data[0]?.data?.id) || 0 : 0) + 1
}

/** Existing rows by upsert key (key column value), read in pages. */
async function existingKeys(ctx: ServiceContext, tableId: string, keyColumn: ImportTargetColumn): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const path = /^[a-z0-9_]+$/.test(keyColumn.key) ? keyColumn.key : null
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await (ctx.supabase as any).from('custom_table_rows')
      .select(path ? `id, k:data->>${path}` : 'id, data')
      .eq('table_id', tableId).eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw dbError(error)
    for (const row of data ?? []) {
      const key = upsertKeyOf(path ? row.k : row.data?.[keyColumn.key])
      if (key !== null && !map.has(key)) map.set(key, String(row.id))
    }
    if (!data || data.length < pageSize) break
  }
  return map
}

/** Delete every existing row (replace): through the deletion queue for files / `deleted` workflows, then directly so the table is empty now. */
async function deleteAllRows(ctx: ServiceContext, tableId: string, fireTriggers: boolean): Promise<number> {
  let deleted = 0
  for (;;) {
    const { data, error } = await (ctx.supabase as any).from('custom_table_rows')
      .select(ROW_COLUMNS).eq('table_id', tableId).eq('tenant_id', ctx.tenantId).limit(DATA_IMPORT_LIMITS.batchSize)
    if (error) throw dbError(error)
    const rows = (data ?? []) as Array<{ id: string; data: Record<string, unknown> | null }>
    if (!rows.length) break
    // Rows holding stored files always go through the queue (it removes the files); the rest only when `deleted` workflows should fire.
    const queued = rows.filter((row) => fireTriggers || Object.values(row.data ?? {}).some((v: any) => v && typeof v === 'object' && v.path && v.url))
    if (queued.length) await queueDeletions(ctx, 'data_row', queued.map((row) => ({ id: String(row.id), payload: { table_id: tableId, row_data: row.data ?? {} } })))
    const ids = rows.map((row) => String(row.id))
    const { error: deleteError } = await (ctx.supabase as any).from('custom_table_rows').delete().eq('table_id', tableId).eq('tenant_id', ctx.tenantId).in('id', ids)
    if (deleteError) throw dbError(deleteError, 'Failed to delete the existing rows')
    deleted += ids.length
  }
  return deleted
}

async function insertBatch(ctx: ServiceContext, tableId: string, rows: Array<{ row: number; data: Record<string, unknown> }>, state: ImportState, events: DataTableEvent[]) {
  const record = (data: Record<string, unknown>) => ({ table_id: tableId, tenant_id: ctx.tenantId, data, created_by: ctx.actorId, updated_by: ctx.actorId })
  const { data, error } = await (ctx.supabase as any).from('custom_table_rows').insert(rows.map((r) => record(r.data))).select('id')
  if (!error && Array.isArray(data)) {
    data.forEach((inserted: any, i: number) => events.push({ rowId: String(inserted.id), rowData: rows[i].data as Record<string, any>, eventType: 'created' }))
    state.inserted += rows.length
    return
  }
  // One bad row fails the whole batch: retry one by one to isolate it.
  for (const r of rows) {
    const single = await (ctx.supabase as any).from('custom_table_rows').insert(record(r.data)).select('id').single()
    if (single.error || !single.data) {
      state.failed++
      pushFailure(state, { row: r.row, column: '', value: '', reason: `Could not be saved: ${single.error?.message ?? 'unknown error'}` })
    } else {
      state.inserted++
      events.push({ rowId: String(single.data.id), rowData: r.data as Record<string, any>, eventType: 'created' })
    }
  }
}

async function updateBatch(ctx: ServiceContext, tableId: string, rows: Array<{ row: number; id: string; data: Record<string, unknown> }>, columns: CellColumn[], state: ImportState, events: DataTableEvent[]) {
  const { data: current, error } = await (ctx.supabase as any).from('custom_table_rows')
    .select(ROW_COLUMNS).eq('table_id', tableId).eq('tenant_id', ctx.tenantId).in('id', rows.map((r) => r.id))
  if (error) throw dbError(error)
  const before = new Map<string, any>((current ?? []).map((row: any) => [String(row.id), row.data ?? {}]))
  const now = new Date().toISOString()
  const merged = rows.map((r) => ({ ...r, data: { ...normalizeRowData(before.get(r.id) ?? {}, columns), ...r.data } }))
  const record = (r: { id: string; data: Record<string, unknown> }) => ({ id: r.id, table_id: tableId, tenant_id: ctx.tenantId, data: r.data, updated_by: ctx.actorId, updated_at: now })
  // The ids were read from this tenant's table above, so the conflict target only ever updates them.
  const { error: upsertError } = await (ctx.supabase as any).from('custom_table_rows').upsert(merged.map(record), { onConflict: 'id' })
  if (!upsertError) {
    for (const r of merged) events.push({ rowId: r.id, rowData: r.data as Record<string, any>, eventType: 'updated' })
    state.updated += merged.length
    return
  }
  for (const r of merged) {
    const single = await (ctx.supabase as any).from('custom_table_rows')
      .update({ data: r.data, updated_by: ctx.actorId, updated_at: now }).eq('id', r.id).eq('table_id', tableId).eq('tenant_id', ctx.tenantId)
    if (single.error) {
      state.failed++
      pushFailure(state, { row: r.row, column: '', value: '', reason: `Could not be saved: ${single.error.message}` })
    } else {
      state.updated++
      events.push({ rowId: r.id, rowData: r.data as Record<string, any>, eventType: 'updated' })
    }
  }
}

function pushFailure(state: ImportState, error: ImportRowError) {
  if (state.failures.length < DATA_IMPORT_LIMITS.maxReportedErrors) state.failures.push(error)
}

export type ImportStep = { done: true; report: ImportReport } | { done: false; state: ImportState; progress: number; message: string }

/**
 * Run (or continue) an import. Returns `done: false` with the state to
 * resume from when `hooks.timeLeft()` runs low (background jobs); without
 * hooks it runs to the end.
 */
export async function runImport(ctx: ServiceContext, tableId: string, bytes: Uint8Array, options: DataImportOptions, resume?: ImportState | null, hooks: ImportHooks = {}): Promise<ImportStep> {
  const state: ImportState = { ...emptyState(), ...(resume ?? {}) }
  const plan = await planImport(ctx, tableId, bytes, options, state.columns_created)
  const { validation, mode, table } = plan
  if (options.dry_run) return { done: true, report: report(plan, state, { dry_run: true, imported: false }) }

  if (validation.invalidRows.length && !options.skip_invalid) {
    const r = report(plan, state, { dry_run: false, imported: false })
    throw ServiceError.validation(
      `${validation.invalidRows.length} of ${plan.file.rows.length} rows have errors; nothing was imported. Fix them, or import the valid rows only (skip_invalid).`,
      { counts: r.counts, errors: r.errors, errors_truncated: r.errors_truncated },
    )
  }
  if (hooks.maxRows !== undefined && validation.valid.length > hooks.maxRows) {
    throw ServiceError.validation(`Imports of more than ${hooks.maxRows.toLocaleString('en-US')} rows run as a background job: repeat the request with ?async=true (or the Prefer: respond-async header)`)
  }
  if (mode === 'replace' && !state.replaced) {
    if (String(options.confirm_replace ?? '').trim().toLowerCase() !== table.name.trim().toLowerCase()) {
      throw ServiceError.validation(`Replacing all rows deletes every existing row of "${table.name}": confirm by sending confirm_replace with the table name`)
    }
  }
  const fireTriggers = options.fire_triggers ?? true
  const timeLeft = hooks.timeLeft ?? (() => Infinity)

  if (!state.audited_start) {
    await audit(ctx, {
      objectType: 'data_table', objectId: table.id, action: 'import_started',
      summary: `Started ${mode} import of "${options.file_name}" into "${table.name}" (${validation.valid.length} rows)`,
      metadata: { file_name: options.file_name, mode, rows: plan.file.rows.length, valid: validation.valid.length, invalid: validation.invalidRows.length, fire_triggers: fireTriggers, key_column: plan.keyColumn?.key ?? null },
    })
    state.audited_start = true
  }

  // New columns first (they are part of the mapping).
  const toCreate = plan.newColumns.filter((col) => !col.exists)
  if (toCreate.length && !state.columns_created.length) {
    const custom = (Array.isArray(table.columns) ? table.columns : []).filter((col: any) => col?.key !== 'id' && col?.key !== 'date_created')
    await updateDataTable(ctx, table.id, {
      columns: [...custom, ...toCreate.map((col) => ({ key: col.key, name: col.name, type: col.type, required: col.required, ...(col.options ? { options: col.options } : {}) }))],
    })
    state.columns_created = toCreate.map((col) => col.key)
  }

  if (mode === 'replace' && !state.replaced) {
    await hooks.progress?.(2, 'Deleting the existing rows')
    state.deleted = await deleteAllRows(ctx, table.id, fireTriggers)
    state.replaced = true
    await audit(ctx, {
      objectType: 'data_table', objectId: table.id, action: 'replace_rows',
      summary: `Deleted ${state.deleted} row${state.deleted === 1 ? '' : 's'} of "${table.name}" to replace them from "${options.file_name}"`,
      metadata: { file_name: options.file_name, deleted: state.deleted, confirmed: options.confirm_replace },
    })
  }

  const cellColumns: CellColumn[] = plan.columns.map((col) => ({ key: col.key, name: col.name }))
  const hasIdColumn = (table.columns ?? []).some((col: any) => col?.key === 'id' && col?.type === 'number')
  const hasDateColumn = (table.columns ?? []).some((col: any) => col?.key === 'date_created')
  const today = new Date().toISOString().split('T')[0]
  let nextNumber = hasIdColumn ? await nextIdNumber(ctx, table.id) : null
  const keys = plan.keyColumn ? await existingKeys(ctx, table.id, plan.keyColumn) : null
  const total = validation.valid.length
  const batch = DATA_IMPORT_LIMITS.batchSize

  while (state.offset < total) {
    if (timeLeft() < 8_000) {
      const progress = 5 + (state.offset / total) * 94
      return { done: false, state, progress, message: `${state.offset.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} rows` }
    }
    const slice = validation.valid.slice(state.offset, state.offset + batch)
    const inserts: Array<{ row: number; data: Record<string, unknown> }> = []
    const updates: Array<{ row: number; id: string; data: Record<string, unknown> }> = []
    for (const row of slice) {
      const existingId = keys && plan.keyColumn ? keys.get(upsertKeyOf(row.data[plan.keyColumn.key])!) : undefined
      if (existingId) { updates.push({ row: row.row, id: existingId, data: row.data }); continue }
      const data: Record<string, unknown> = { ...row.data }
      if (nextNumber !== null) data.id = nextNumber++
      if (hasDateColumn) data.date_created = today
      inserts.push({ row: row.row, data })
    }
    const events: DataTableEvent[] = []
    try {
      if (updates.length) await updateBatch(ctx, table.id, updates, cellColumns, state, events)
      if (inserts.length) {
        await insertBatch(ctx, table.id, inserts, state, events)
        if (keys && plan.keyColumn) for (const ev of events) if (ev.eventType === 'created') {
          const key = upsertKeyOf((ev.rowData as Record<string, unknown>)[plan.keyColumn.key])
          if (key && !keys.has(key)) keys.set(key, ev.rowId)
        }
      }
    } finally {
      if (fireTriggers && events.length) {
        await enqueueDataTableEvents({ supabase: ctx.supabase as any, tenantId: ctx.tenantId, tableId: table.id, events, initiator: initiatorFromContext(ctx) })
      }
    }
    state.offset += slice.length
    await hooks.progress?.(5 + (state.offset / total) * 94, `${state.offset.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} rows`)
  }

  const final = report(plan, state, { dry_run: false, imported: true })
  await audit(ctx, {
    objectType: 'data_table', objectId: table.id, action: 'import',
    summary: `Imported "${options.file_name}" into "${table.name}": ${final.counts.inserted} inserted, ${final.counts.updated} updated, ${final.counts.skipped} skipped, ${final.counts.failed} failed`,
    metadata: { file_name: options.file_name, mode, ...final.counts, fire_triggers: fireTriggers, key_column: final.key_column, columns_created: final.columns_created },
  })
  return { done: true, report: final }
}

/** One-shot import (API / MCP inline calls): refuses large writes, which run as a background job instead. */
export async function importRowsNow(ctx: ServiceContext, tableId: string, bytes: Uint8Array, options: DataImportOptions): Promise<ImportReport> {
  const step = await runImport(ctx, tableId, bytes, options, null, { maxRows: DATA_IMPORT_LIMITS.syncRows })
  if (!step.done) throw new Error('Import did not finish')
  return step.report
}

/** Every importable table column (for "map to" pickers outside the wizard). */
export function importableColumns(columns: any[]): ImportTargetColumn[] {
  return targetColumns(columns).filter(isImportableColumn)
}
