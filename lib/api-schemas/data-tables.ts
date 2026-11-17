import { z } from 'zod'
import { defineEndpoint } from './registry'
import { deletedResponse, idParams, itemResponse, listResponse, looseObject, paginationQuery } from './common'

export const dataColumnSchema = z.looseObject({
  id: z.string().optional().describe('Stable column id (kept when given; matched by key otherwise)'),
  key: z.string().optional().describe('Canonical row-data key (default: slug of the name; never changes once set)'),
  name: z.string().min(1).describe('Column label'),
  type: z.enum(['text', 'number', 'date', 'boolean', 'select', 'file', 'longtext', 'lookup']),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional().describe('Allowed values for select columns'),
  lookup: looseObject.optional().describe('Lookup config: sourceTableId, sourceColumn, filters, distinct, sortBy, sortDir'),
})

export const dataTableCreateBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  columns: z.array(dataColumnSchema).default([]).describe('Custom columns; the system ID and Date Created columns are added automatically'),
})

export const dataTableUpdateBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  columns: z.array(dataColumnSchema).optional().describe('Full replacement list of custom columns (system columns are kept)'),
})

export const rowFilterSchema = z.object({
  field: z.string().min(1).describe('Column key/name, or id, created_at, updated_at, created_by'),
  operator: z.enum(['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'not_empty']),
  value: z.any().optional(),
})

/** `filters` arrives as a JSON-encoded array in the query string. */
const filtersParam = z.string().optional()
  .describe('JSON array of {field, operator, value}, e.g. [{"field":"status","operator":"equals","value":"open"}]')
  .transform((value, ctx) => {
    if (!value) return undefined
    let parsed: unknown
    try { parsed = JSON.parse(value) } catch {
      ctx.addIssue({ code: 'custom', message: 'filters must be a JSON array' })
      return z.NEVER
    }
    const result = z.array(rowFilterSchema).max(20).safeParse(parsed)
    if (!result.success) {
      ctx.addIssue({ code: 'custom', message: `filters: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}` })
      return z.NEVER
    }
    return result.data
  })

export const rowQuerySchema = paginationQuery.extend({
  search: z.string().optional().describe('Text matched against the row id and every cell'),
  filters: filtersParam,
  order: z.string().optional().describe('Sort: field, -field (descending) or field.desc / field.asc (default -created_at)'),
})

const rowInput = z.object({
  row_id: z.string().optional().describe('Existing row to replace (omit to insert)'),
  data: z.record(z.string(), z.any()).describe('Cells keyed by column key (or name)'),
})

export const rowUpsertBody = z.object({
  row_id: z.string().optional().describe('Single row: existing row to replace (omit to insert)'),
  data: z.record(z.string(), z.any()).optional().describe('Single row: cells keyed by column key (or name)'),
  rows: z.array(rowInput).max(500).optional().describe('Bulk: up to 500 rows, validated before any is written'),
}).refine((body) => Boolean(body.data) !== Boolean(body.rows), { message: 'Provide exactly one of data or rows' })

export const rowUpdateBody = z.object({
  data: z.record(z.string(), z.any()).describe('Cells to change; other cells are kept'),
})

export const rowBulkDeleteBody = z.object({
  row_ids: z.array(z.string().min(1)).min(1).max(500),
})

const rowParams = z.object({ id: z.string().describe('Table id'), rowId: z.string().describe('Row id') })
const tags = ['Data tables']
const TRIGGER_NOTE = 'Created and updated rows fire data_table_event workflows.'

export const listDataTablesEndpoint = defineEndpoint({
  method: 'GET', path: '/data-tables', operationId: 'listDataTables', tags,
  summary: 'List data tables', permission: 'data.view',
  query: paginationQuery.extend({ search: z.string().optional().describe('Name contains') }),
  response: listResponse('data_tables'), listKey: 'data_tables',
  cli: { resource: 'tables', verb: 'list' },
})

export const createDataTableEndpoint = defineEndpoint({
  method: 'POST', path: '/data-tables', operationId: 'createDataTable', tags,
  summary: 'Create a data table', permission: 'data.create',
  body: dataTableCreateBody, successStatus: 201, response: itemResponse('data_table'),
  cli: { resource: 'tables', verb: 'create' },
})

export const getDataTableEndpoint = defineEndpoint({
  method: 'GET', path: '/data-tables/{id}', operationId: 'getDataTable', tags,
  summary: 'Get a data table with its columns', permission: 'data.view',
  params: idParams, response: itemResponse('data_table'),
  cli: { resource: 'tables', verb: 'get', positional: ['id'] },
})

export const updateDataTableEndpoint = defineEndpoint({
  method: 'PATCH', path: '/data-tables/{id}', operationId: 'updateDataTable', tags,
  summary: 'Rename a data table or replace its custom columns', permission: 'data.edit_schema',
  params: idParams, body: dataTableUpdateBody, response: itemResponse('data_table'),
  roundTrip: { unwrap: 'data_table' },
  cli: { resource: 'tables', verb: 'update', positional: ['id'] },
})

export const deleteDataTableEndpoint = defineEndpoint({
  method: 'DELETE', path: '/data-tables/{id}', operationId: 'deleteDataTable', tags,
  summary: 'Delete a data table and all its rows (queued)', permission: 'data.delete',
  params: idParams, response: deletedResponse,
  cli: { resource: 'tables', verb: 'delete', positional: ['id'] },
})

export const listRowsEndpoint = defineEndpoint({
  method: 'GET', path: '/data-tables/{id}/rows', operationId: 'listDataRows', tags,
  summary: 'List or search rows', permission: 'data.view',
  description: 'Without search/filters/cell sort, pages come straight from the database with an exact total. Otherwise the newest 500 rows are scanned and `truncated` is true when the table holds more.',
  params: idParams, query: rowQuerySchema,
  response: z.looseObject({ rows: z.array(looseObject), total: z.number().int(), truncated: z.boolean() }), listKey: 'rows',
  cli: { resource: 'rows', verb: 'list', positional: ['id'] },
})

export const upsertRowsEndpoint = defineEndpoint({
  method: 'POST', path: '/data-tables/{id}/rows', operationId: 'upsertDataRows', tags,
  summary: 'Insert rows, or replace existing ones by row_id (single or bulk)', permission: 'data.manage_rows',
  description: `Cells must match declared columns and are stored under canonical column keys; inserts auto-number the ID column and stamp Date Created. ${TRIGGER_NOTE}`,
  params: idParams, body: rowUpsertBody,
  response: z.looseObject({ rows: z.array(z.looseObject({ row_id: z.string(), action: z.enum(['created', 'updated']), row: looseObject })), created: z.number().int(), updated: z.number().int() }),
  cli: { resource: 'rows', verb: 'upsert', positional: ['id'] },
})

export const getRowEndpoint = defineEndpoint({
  method: 'GET', path: '/data-tables/{id}/rows/{rowId}', operationId: 'getDataRow', tags,
  summary: 'Get a row', permission: 'data.view',
  params: rowParams, response: itemResponse('row'),
  cli: { resource: 'rows', verb: 'get', positional: ['id', 'rowId'] },
})

export const updateRowEndpoint = defineEndpoint({
  method: 'PATCH', path: '/data-tables/{id}/rows/{rowId}', operationId: 'updateDataRow', tags,
  summary: 'Change cells of a row (others are kept)', permission: 'data.manage_rows',
  description: TRIGGER_NOTE,
  params: rowParams, body: rowUpdateBody, response: itemResponse('row'),
  roundTrip: { unwrap: 'row' },
  cli: { resource: 'rows', verb: 'update', positional: ['id', 'rowId'] },
})

export const deleteRowEndpoint = defineEndpoint({
  method: 'DELETE', path: '/data-tables/{id}/rows/{rowId}', operationId: 'deleteDataRow', tags,
  summary: 'Delete a row (queued; fires data_table_event "deleted" workflows)', permission: 'data.manage_rows',
  params: rowParams, response: deletedResponse,
  cli: { resource: 'rows', verb: 'delete', positional: ['id', 'rowId'] },
})

export const bulkDeleteRowsEndpoint = defineEndpoint({
  method: 'POST', path: '/data-tables/{id}/rows/bulk-delete', operationId: 'bulkDeleteDataRows', tags,
  summary: 'Delete up to 500 rows of a table (queued); unknown ids are ignored', permission: 'data.manage_rows',
  params: idParams, body: rowBulkDeleteBody,
  response: z.looseObject({ deleted: z.number().int(), ids: z.array(z.string()) }),
  cli: { resource: 'rows', verb: 'bulk-delete', positional: ['id'] },
  async: true,
})

// ─── Import (CSV / TSV / .xlsx) ─────────────────────────────────────────────

const boolish = z.union([z.boolean(), z.enum(['true', 'false', '1', '0', 'on', 'off'])]).transform((v) => v === true || v === 'true' || v === '1' || v === 'on')
/** JSON fields also arrive as JSON text (multipart/form-data). */
const jsonText = <T extends z.ZodType>(schema: T) => z.union([schema, z.string().transform((value, ctx) => {
  try { return JSON.parse(value) as unknown } catch {
    ctx.addIssue({ code: 'custom', message: 'must be JSON' })
    return z.NEVER
  }
}).pipe(schema)])

const importColumnType = z.enum(['text', 'longtext', 'number', 'date', 'boolean', 'select'])

export const rowImportBody = z.object({
  file_base64: z.string().min(1).describe('The file, base64: .csv, .tsv or .xlsx, at most 10 MB and 50,000 data rows (hosted instances accept request bodies up to about 4.5 MB). With multipart/form-data: the `file` field.'),
  file_name: z.string().min(1).max(255).describe('File name; its extension (.csv, .tsv, .xlsx) picks the reader'),
  sheet: z.string().max(200).optional().describe('.xlsx: the sheet to read (default the first)'),
  delimiter: z.enum(['auto', ',', ';', '\t']).optional().describe('CSV delimiter (default auto: comma, semicolon or tab, detected)'),
  encoding: z.enum(['auto', 'utf-8', 'utf-16le', 'utf-16be', 'windows-1252']).optional().describe('Text encoding (default auto: UTF-8 with or without BOM, UTF-16 with BOM, else Windows-1252)'),
  mapping: jsonText(z.record(z.string(), z.string().nullable())).optional().describe('File header → column key or name; null skips the header. Headers left out are matched to columns by name (case-insensitive; spaces, underscores and hyphens ignored)'),
  new_columns: jsonText(z.array(z.object({
    header: z.string().min(1).max(500).describe('File header the new column is filled from'),
    name: z.string().max(200).optional().describe('Column name (default the header)'),
    type: importColumnType.optional().describe('Column type (default text)'),
    options: z.array(z.string().max(500)).max(500).optional().describe('Choices, for select columns'),
    required: z.boolean().optional(),
  })).max(200)).optional().describe('Columns to add to the table before importing (needs data.edit_schema)'),
  mode: z.enum(['insert', 'upsert', 'replace']).optional().describe('insert (default): add every row; upsert: update rows whose key_column value matches, insert the rest; replace: delete every existing row first (confirm_replace)'),
  key_column: z.string().max(200).optional().describe('upsert: the column (key or name) whose value identifies a row'),
  confirm_replace: z.string().max(200).optional().describe('replace: the table name, typed, to confirm deleting every existing row'),
  date_order: z.enum(['auto', 'dmy', 'mdy', 'ymd']).optional().describe('Day / month order of numeric dates such as 03/04/2026 (default auto: detected from the values; month/day when undecidable)'),
  trim: boolish.optional().describe('Trim leading / trailing whitespace (default true)'),
  empty_cells: z.enum(['empty', 'ignore']).optional().describe('empty (default): an empty cell clears the column; ignore: it leaves the column out (an upsert keeps the stored value)'),
  skip_invalid: boolish.optional().describe('Import the valid rows and skip rows with errors (default false: any error stops the import, nothing is written)'),
  fire_triggers: boolish.optional().describe('Fire data_table_event workflows for created / updated rows (default true, like POST /data-tables/{id}/rows)'),
  dry_run: boolish.optional().describe('Validate only: the report (mapping, counts, row errors, preview), nothing written'),
})

const importErrorSchema = z.object({ row: z.number().int(), column: z.string(), value: z.string(), reason: z.string() })

export const importRowsEndpoint = defineEndpoint({
  method: 'POST', path: '/data-tables/{id}/rows/import', operationId: 'importDataRows', tags,
  summary: 'Import rows from a CSV, TSV or .xlsx file (insert, upsert or replace)', permission: 'data.manage_rows',
  description: 'Reads the file (BOM, quoted fields with embedded newlines, comma / semicolon / tab, UTF-8 / UTF-16 / Windows-1252, an .xlsx sheet), matches headers to columns (or `mapping`; `new_columns` adds columns), validates every row (numbers incl. currency like $1,234.50, dates → YYYY-MM-DD, yes / no, choices, required columns) and writes in batches of 500. Row errors carry the spreadsheet row number (header = row 1), the column and the reason; with errors nothing is written unless skip_invalid. Values are stored as plain text / numbers and never evaluated. Limits: 10 MB, 50,000 rows, 200 columns; more than 5,000 rows need the async variant. Replace deletes the existing rows through the deletion queue (stored files removed; audited). ' + TRIGGER_NOTE.replace('.', ' unless fire_triggers is false.'),
  params: idParams, body: rowImportBody,
  multipart: { files: { file: { name: 'file_name', content: 'file_base64' } } },
  response: z.looseObject({
    table_id: z.string(), dry_run: z.boolean(), imported: z.boolean(), mode: z.enum(['insert', 'upsert', 'replace']),
    file: looseObject, mapping: z.record(z.string(), z.string().nullable()), date_order: z.enum(['dmy', 'mdy', 'ymd']),
    key_column: z.string().nullable(), fire_triggers: z.boolean(), columns_created: z.array(z.string()),
    counts: z.object({ rows: z.number().int(), valid: z.number().int(), invalid: z.number().int(), inserted: z.number().int(), updated: z.number().int(), skipped: z.number().int(), failed: z.number().int(), deleted: z.number().int() }),
    errors: z.array(importErrorSchema), errors_truncated: z.boolean(), preview: z.array(looseObject),
  }),
  cli: { resource: 'rows', verb: 'import', positional: ['id'] },
  async: true,
})

// ─── Grid views and inline cell writes (lib/grid/column-model.ts) ──────────

const GRID_CONTROL_VALUES = ['text', 'multiline', 'number', 'currency', 'date', 'datetime', 'boolean', 'dropdown', 'autocomplete', 'multiselect', 'people', 'lookup', 'signature', 'file', 'link', 'rich_text', 'display'] as const

export const gridColumnSchema = z.looseObject({
  key: z.string().min(1).max(600).describe('The table column key'),
  label: z.string().max(120).optional().describe('Header (default the key)'),
  width: z.number().int().min(40).max(800).optional().describe('Width in px'),
  control: z.enum(GRID_CONTROL_VALUES).optional().describe('How the cell is shown and edited (default inferred from the column type: longtext → multiline, select → dropdown, file → file, lookup → dropdown bound to the source table…)'),
  control_options: looseObject.optional().describe('choices [{ value, label }] (dropdown / multiselect without a binding), currency, min, max, decimals, max_length, boolean_style (checkbox | toggle), multiple / allow_teams (people), formula (display), signature { mode, statement }, placeholder'),
  binding: looseObject.optional().describe('dropdown / autocomplete / multiselect / lookup: options from a data table or an API reference — the form lookup config: source (table | reference), table_id or reference_id (+ integration_id, input_mappings, results_path), filters [{ column, operator, value }] (values may read {{row.<column>}} for cascading choices), sort { column, direction }, value_column / value_field (the stored id), display_columns / display_fields and label_template (what people see), search_columns, min_chars, max_results, cache_ttl_s, allow_free_text'),
  editable: z.boolean().optional().describe('false: read-only — inline writes of this column are refused'),
  required: z.boolean().optional(),
  hidden: z.boolean().optional(),
  format: looseObject.optional().describe('Display format (lib/formatting/cell-format.ts)'),
})

export const gridViewSchema = z.looseObject({
  id: z.string().max(40).optional().describe('Stable view id (kept when given; generated otherwise)'),
  name: z.string().min(1).max(80),
  columns: z.array(gridColumnSchema).max(40).describe('The columns shown, in order'),
  inline_edit: z.boolean().optional().describe('Allow inline editing (all rows): editable columns save per cell'),
  open_in_edit_mode: z.boolean().optional().describe('With inline_edit: the grid opens in "Edit all rows" mode (every row editable at once, saved as one batch)'),
  allow_add: z.boolean().optional(),
  allow_delete: z.boolean().optional(),
  page_size: z.number().int().min(10).max(500).optional().describe('Rows per page (default 100)'),
  default: z.boolean().optional().describe('The view the grid opens on'),
})

export const tableViewsBody = z.object({ views: z.array(gridViewSchema).max(20).describe('Full replacement list of the table\'s grid views') })

export const gridCellsBody = z.object({
  view_id: z.string().min(1).max(40).describe('The saved view whose rules apply (inline editing on, editable columns only)'),
  cells: z.record(z.string(), z.any()).describe('Column key → new value (typed by the column\'s control: text, number, YYYY-MM-DD, ISO date-time, true / false, a bound option\'s value, an array for multiselect, [{ kind, id }] for people, { name, url, path } for a file stored with this table)'),
  expected_updated_at: z.string().max(40).nullable().optional().describe('The row\'s updated_at as you read it: a newer row is a 409 conflict instead of an overwrite (omit: last write wins)'),
})

export const gridOptionsBody = z.object({
  column: z.string().min(1).max(600).describe('A bound column of the view'),
  query: z.string().max(500).optional().describe('Typed text (autocomplete search; server-side)'),
  resolve: z.array(z.union([z.string().max(1000), z.number()]).transform(String)).max(50).optional().describe('Resolve these stored values to their options (labels) instead of searching'),
  row: z.record(z.string(), z.any()).optional().describe('The row being edited, for {{row.<column>}} in the binding (cascading)'),
})

const viewParams = z.object({ id: z.string().describe('Table id'), viewId: z.string().describe('View id (`default`: the built-in view)') })
const viewsResponse = z.looseObject({ table_id: z.string(), views: z.array(looseObject), columns: z.array(looseObject) })

export const getTableViewsEndpoint = defineEndpoint({
  method: 'GET', path: '/data-tables/{id}/views', operationId: 'getDataTableViews', tags,
  summary: 'Get a table\'s grid views (columns, controls, bindings, editing)', permission: 'data.view',
  params: idParams, response: viewsResponse,
  cli: { resource: 'tables', verb: 'views', positional: ['id'] },
})

export const updateTableViewsEndpoint = defineEndpoint({
  method: 'PUT', path: '/data-tables/{id}/views', operationId: 'updateDataTableViews', tags,
  summary: 'Replace a table\'s grid views', permission: 'data.edit_schema',
  description: 'Per view: the columns shown and, per column, the control (signature pad, dropdown, autocomplete, multi-select, people, currency, rich text, calculated…), its binding to a data table or an API reference (filter, sort, value and display fields), editable / read-only, required and width; plus inline editing of all rows. Columns not in the table are dropped; a bound control without a source or choices is refused; bindings must name a table / read-only reference of this workspace.',
  params: idParams, body: tableViewsBody, response: viewsResponse,
  cli: { resource: 'tables', verb: 'set-views', positional: ['id'] },
})

export const writeRowCellsEndpoint = defineEndpoint({
  method: 'PATCH', path: '/data-tables/{id}/rows/{rowId}/cells', operationId: 'writeDataRowCells', tags,
  summary: 'Inline edit: write cells of a row through a grid view', permission: 'data.manage_rows',
  description: `The view's rules are enforced on the server: inline editing must be on and every cell must be an editable column of the view (read-only, hidden and calculated columns are refused even when sent), typed by its control; bound values must be options of their source; people must be in this workspace; a new signature is stamped with the signer and time. With expected_updated_at a row changed since you read it answers 409 with the current row. ${TRIGGER_NOTE}`,
  params: rowParams, body: gridCellsBody,
  response: z.looseObject({ row: looseObject, updated_at: z.string(), changed: z.array(z.string()) }),
  cli: { resource: 'rows', verb: 'cells', positional: ['id', 'rowId'] },
})

export const gridRowsBody = z.object({
  view_id: z.string().min(1).max(40).describe('The saved view whose rules apply (inline editing on, editable columns only)'),
  rows: z.array(z.object({
    row_id: z.string().describe('Row id'),
    cells: z.record(z.string(), z.any()).describe('Column key → new value (typed as for the single-row cells write)'),
    expected_updated_at: z.string().max(40).nullable().optional().describe('The row\'s updated_at as you read it: a newer row comes back as a conflict for that row'),
  })).max(500).optional().describe('Edited rows (at most 500 rows per call, new rows included)'),
  inserts: z.array(z.object({
    client_id: z.string().max(64).optional().describe('Your id for the new row, echoed in its outcome'),
    cells: z.record(z.string(), z.any()).describe('Column key → value; every required editable column of the view must be filled'),
  })).max(200).optional().describe('New rows (the view must allow adding rows)'),
})

const rowOutcome = z.looseObject({
  row_id: z.string(),
  status: z.enum(['saved', 'unchanged', 'conflict', 'invalid', 'not_found', 'forbidden', 'error']),
  row: looseObject.optional(), updated_at: z.string().optional(), changed: z.array(z.string()).optional(),
  error: z.string().optional(), cells: z.record(z.string(), z.string()).optional().describe('Column key → why that cell was refused'),
  current: looseObject.nullable().optional().describe('Conflict: the row as it is now'),
})

export const writeRowsCellsEndpoint = defineEndpoint({
  method: 'PATCH', path: '/data-tables/{id}/rows/cells', operationId: 'writeDataRowsCells', tags,
  summary: 'Batch inline edit: write cells of many rows through a grid view', permission: 'data.manage_rows',
  description: `"Edit all rows" in one call. Each row is checked exactly as the single-row cells write (inline editing on, editable columns only, typed by the control, bound values / people / files settled, the row's own access rules) and gets its own outcome: saved, unchanged, conflict (with the current row, when expected_updated_at is older than the row), invalid (cells: column → reason), not_found or forbidden. One row's refusal never stops the others and nothing is rolled back: re-send only the rows that failed. New rows (inserts) need the view's Add rows and every required editable column. Workflows: one data_table_event "updated" per row whose cells changed (unchanged and refused rows fire nothing) and one "created" per inserted row.`,
  params: idParams, body: gridRowsBody,
  response: z.looseObject({
    table_id: z.string(), view_id: z.string(), rows: z.array(rowOutcome),
    inserts: z.array(z.looseObject({ client_id: z.string(), status: z.enum(['saved', 'invalid', 'forbidden', 'error']), row: looseObject.optional(), error: z.string().optional(), cells: z.record(z.string(), z.string()).optional() })),
    saved: z.number().int(), failed: z.number().int(),
  }),
  cli: { resource: 'rows', verb: 'cells-batch', positional: ['id'] },
})

export const gridOptionsEndpoint = defineEndpoint({
  method: 'POST', path: '/data-tables/{id}/views/{viewId}/options', operationId: 'getDataGridColumnOptions', tags,
  summary: 'Options of a bound grid column (search or resolve labels)', permission: 'data.view',
  description: 'Runs the SAVED binding of the view\'s column: a data table with your own access, an API reference server-side with the workspace\'s credentials (cached per its cache_ttl_s). Rate limited like form lookups.',
  params: viewParams, body: gridOptionsBody,
  response: z.looseObject({ items: z.array(z.looseObject({ value: z.string(), label: z.string(), description: z.string().optional(), fields: looseObject })), truncated: z.boolean().optional(), too_short: z.boolean().optional(), cached: z.boolean().optional() }),
  cli: { resource: 'tables', verb: 'options', positional: ['id', 'viewId'] },
})

export const dataTableEndpoints = [
  listDataTablesEndpoint, createDataTableEndpoint, getDataTableEndpoint, updateDataTableEndpoint, deleteDataTableEndpoint,
  listRowsEndpoint, upsertRowsEndpoint, getRowEndpoint, updateRowEndpoint, deleteRowEndpoint, bulkDeleteRowsEndpoint, importRowsEndpoint,
  getTableViewsEndpoint, updateTableViewsEndpoint, writeRowCellsEndpoint, writeRowsCellsEndpoint, gridOptionsEndpoint,
]
