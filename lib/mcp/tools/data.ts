import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { canAccessTable } from '@/lib/api-key-permissions'
import { fromMcpContext, type ServiceContext } from '@/lib/services/context'
import * as dataTables from '@/lib/services/data-tables'
import { decodeBase64, importRowsNow, planImport, type DataImportOptions } from '@/lib/services/data-import'
import { DATA_IMPORT_LIMITS } from '@/lib/data-import/parse'
import { messageOf } from './_util'

const columnSchema = z.object({
  name: z.string().describe('Column label shown to users'),
  type: z.enum(['text', 'number', 'date', 'boolean', 'select', 'file', 'longtext', 'lookup']).describe('Column type'),
  key: z.string().optional().describe('Stable column key. Defaults to a slug from the name'),
  required: z.boolean().optional().describe('Whether the column is required'),
  options: z.array(z.string()).optional().describe('Allowed values for select columns'),
  lookup: z.object({
    sourceTableId: z.string().describe('Source table ID'),
    sourceTableName: z.string().optional().describe('Source table display name'),
    sourceColumn: z.string().describe('Column on the source table to use as the lookup value'),
    filters: z.array(z.object({
      id: z.string().optional().describe('Filter ID'),
      column: z.string().describe('Source table column to filter on'),
      operator: z.enum(['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'is_empty', 'not_empty']).describe('Lookup filter operator'),
      value: z.string().optional().describe('Optional filter value'),
    })).optional().describe('Optional lookup filters'),
    distinct: z.boolean().optional().describe('Return distinct values only'),
    sortBy: z.string().optional().describe('Column to sort results by'),
    sortDir: z.enum(['asc', 'desc']).optional().describe('Lookup sort direction'),
  }).optional().describe('Lookup configuration for lookup columns'),
})

// The Data step's spellings (eq, neq, ilike, is_null, ==, …) are accepted too.
const ROW_FILTER_OPERATOR_ALIASES: Record<string, string> = {
  eq: 'equals', '==': 'equals', '=': 'equals', equal: 'equals', neq: 'not_equals', ne: 'not_equals', '!=': 'not_equals', '<>': 'not_equals', not_equal: 'not_equals',
  like: 'contains', ilike: 'contains', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte', greater_than: 'gt', less_than: 'lt',
  is_null: 'is_empty', not_null: 'not_empty', is_not_empty: 'not_empty', is_not_null: 'not_empty',
}

const rowFilterSchema = z.object({
  field: z.string().describe('Field to filter on. Use a table column key/name, or system fields like id, created_at, updated_at, created_by'),
  operator: z.preprocess(
    (op) => (typeof op === 'string' ? ROW_FILTER_OPERATOR_ALIASES[op.trim().toLowerCase()] ?? op.trim().toLowerCase() : op),
    z.enum(['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'not_empty']),
  ).describe('Filter operator (the Data step spellings eq, neq, ilike, is_null, not_null are accepted too)'),
  value: z.any().optional().describe('Filter value when required by the operator'),
})

function getSearchableValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(getSearchableValue).join(' ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Max rows one data_rows_create / data_rows_update / filtered data_rows_bulk_delete call may touch. */
export const MCP_ROW_WRITE_CAP = 200

/** A table id, or a table's name / system name (slug) resolved to its id (exact, case-insensitive). */
export async function resolveTableRef(ctx: ServiceContext, ref: string): Promise<string> {
  const value = String(ref ?? '').trim()
  if (!value) throw new Error('table_id is required')
  if (UUID.test(value)) return value
  let data_tables: any[]
  try {
    ({ data_tables } = await dataTables.listDataTables(ctx, { search: value }, { limit: 50, offset: 0 }))
    // A system name (slug) isn't a name search: look through every table's slug.
    if (!data_tables.length) data_tables = (await dataTables.listDataTables(ctx, {}, { limit: 1000, offset: 0 })).data_tables.filter((t: any) => String(t.slug ?? '').toLowerCase() === value.toLowerCase())
  } catch { return value }
  const lower = value.toLowerCase()
  const exact = data_tables.filter((t: any) => String(t.name ?? '').toLowerCase() === lower || String(t.slug ?? '').toLowerCase() === lower)
  if (exact.length === 1) return String(exact[0].id)
  if (exact.length > 1) throw new Error(`Several tables are called "${value}": ${exact.map((t: any) => `${t.name} (${t.id})`).join(', ')} — pass the id`)
  if (data_tables.length === 1) return String(data_tables[0].id)
  if (data_tables.length) throw new Error(`No table is called exactly "${value}". Close matches: ${data_tables.slice(0, 10).map((t: any) => `${t.name} (${t.id})`).join(', ')}`)
  // Not a name either: let the service answer for it as an id ("Table not found").
  return value
}

/** Rows matching filters (capped): throws when more match than `max` (or the scan was cut short). */
async function rowsMatching(ctx: ServiceContext, tableId: string, filters: any[], max: number) {
  const result = await dataTables.queryRows(ctx, tableId, { filters }, { limit: max + 1, offset: 0 })
  if (result.rows.length > max || result.total > max) throw new Error(`${result.total} or more rows match — at most ${max} per call. Narrow the filters, or pass row_ids.`)
  if (result.truncated) throw new Error(`The table has more rows than one filtered call can scan (${dataTables.DATA_ROW_LIMITS.scan}) — pass row_ids instead.`)
  return result.rows as any[]
}

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

/*
 * Table and row tools are thin wrappers over lib/services/data-tables, which
 * owns column validation, canonical cell keys, resource scopes, workflow
 * triggers and the deletion queue (schema writes are audited there). Reads
 * need data.view (READ_TOOL_PERMISSIONS in ../authz). data_rows_search is MCP-only.
 */
export function registerDataTools(server: McpToolServer, ctx: McpContext) {
  const { tenantId, supabase } = ctx
  const scopedTableIds = ctx.scopes?.table_ids ?? []
  const writeCtx = (): ServiceContext => fromMcpContext(ctx)
  const readCtx = (): ServiceContext => fromMcpContext(ctx) // reads are gated too (READ_TOOL_PERMISSIONS)

  server.tool('data_tables_list', 'List custom data tables. Data tables are the foundation for reports, lookups, retention assignment, and workflow triggers when rows are created, updated, or deleted. Pass query to find tables by name.', {
    query: z.string().optional().describe('Only tables whose name contains this text (case-insensitive)'),
  }, async (args) => run(async () => {
    const { data_tables } = await dataTables.listDataTables(readCtx(), { search: args?.query }, { limit: null, offset: 0 })
    return { tables: data_tables }
  }))

  server.tool('data_tables_get', 'Get a custom table schema including columns, lookup metadata, and table settings so MCP can safely build workflows, reports, and row operations against it. table_id may be the id, the table name or its system name.', {
    table_id: z.string().describe('Table ID, name or system name (slug)'),
  }, async (args) => run(async () => dataTables.getDataTable(readCtx(), await resolveTableRef(readCtx(), args.table_id))))

  server.tool('data_tables_create', 'Create a new custom data table. Supports standard columns plus lookup columns with filters, distinct result handling, and sorting.', {
    name: z.string().describe('Table name'),
    description: z.string().optional().describe('Optional table description'),
    columns: z.array(columnSchema).describe('Column definitions. System columns for ID and Date Created are added automatically.'),
  }, async (args) => run(async () => {
    const table = await dataTables.createDataTable(writeCtx(), args)
    return { created: true, table: { id: table.id, name: table.name, slug: table.slug } }
  }))

  server.tool('data_tables_update_schema', 'Replace the schema for an existing custom data table. Use this to add, remove, rename, or reconfigure columns including lookup columns while preserving the table as a reusable asset.', {
    table_id: z.string().describe('Table ID'),
    columns: z.array(columnSchema).describe('Full replacement list of custom columns. System columns ID and Date Created are preserved automatically.'),
    description: z.string().optional().describe('Optional updated table description'),
    name: z.string().optional().describe('Optional updated table name'),
  }, async (args) => run(async () => {
    await dataTables.updateDataTable(writeCtx(), args.table_id, { columns: args.columns, description: args.description, name: args.name })
    return { updated: true, table_id: args.table_id }
  }))

  server.tool('data_tables_delete', 'Delete a custom data table. Its rows are removed by the deletion queue shortly after; workflows, reports and objects that use the table stop working.', {
    table_id: z.string().describe('Table ID'),
  }, async (args) => run(() => dataTables.deleteDataTable(writeCtx(), args.table_id)))

  server.tool('data_rows_query', 'Query rows from a custom table. Supports full row-value search, row filters, sorting, and pagination. Search checks row IDs and all serialized row data so MCP can surface real table content rather than table names only.', {
    table_id: z.string().describe('Table ID'),
    search: z.string().optional().describe('Search across row ID and all row values'),
    filters: z.array(rowFilterSchema).optional().describe('Optional row filters'),
    sort_field: z.string().optional().describe('Sort field. Use a row field or system fields like id, created_at, updated_at'),
    sort_direction: z.enum(['asc', 'desc']).optional().describe('Sort direction. Default: desc'),
    limit: z.number().optional().describe('Max results, default 50, hard cap 200'),
    offset: z.number().optional().describe('Pagination offset'),
  }, async (args) => run(async () => {
    const limit = Math.min(args.limit ?? 50, 200)
    const offset = Math.max(args.offset ?? 0, 0)
    const local = Boolean(args.search) || Boolean(args.filters?.length) || Boolean(args.sort_field && !['created_at', 'updated_at', 'id', 'row_id'].includes(args.sort_field))
    const result = await dataTables.queryRows(readCtx(), await resolveTableRef(readCtx(), args.table_id), {
      search: args.search, filters: args.filters, sort_field: args.sort_field, sort_direction: args.sort_direction,
    }, { limit, offset })
    const rows = result.rows.map(({ table_id: _tableId, updated_by: _updatedBy, ...row }: any) => row)
    if (!local) return { rows, count: rows.length, limit, offset }
    return {
      rows,
      count: rows.length,
      total_matches: result.total,
      truncated: result.truncated,
      ...(result.truncated
        ? { note: `Only the first ${dataTables.DATA_ROW_LIMITS.scan} rows were scanned for search/filter/sort; total_matches is a lower bound. Narrow the query or use data_rows_query without in-memory search for complete results.` }
        : {}),
      limit,
      offset,
      search: args.search ?? null,
    }
  }))

  server.tool('data_rows_search', 'Search across table rows and return matched columns/snippets to help MCP consumers show the relevant field content. This is useful for global-search style experiences.', {
    table_id: z.string().optional().describe('Optional table ID. Omit to search all tables in the tenant'),
    query: z.string().describe('Search text'),
    limit: z.number().optional().describe('Max results, default 20, hard cap 100'),
  }, async (args) => {
    const limit = Math.min(args.limit ?? 20, 100)
    if (args.table_id && !canAccessTable({ ...ctx, success: true } as any, args.table_id)) return mcpErr('This API key is not allowed to access that table')

    if (!args.table_id) {
      if (scopedTableIds.length > 0) {
        const { data, error } = await supabase.from('custom_table_rows')
          .select('id, table_id, data')
          .eq('tenant_id', tenantId)
          .in('table_id', scopedTableIds)
          .order('created_at', { ascending: false })
          .limit(500)
        if (error) return mcpErr(error.message)

        const lowerQuery = args.query.toLowerCase()
        const results = ((data ?? []) as any[])
          .map((row) => {
            const rowData = row.data && typeof row.data === 'object' ? row.data as Record<string, any> : {}
            let matched_column: string | null = String(row.id).toLowerCase().includes(lowerQuery) ? 'id' : null
            let matched_value: string | null = matched_column ? String(row.id) : null

            if (!matched_column) {
              for (const [key, value] of Object.entries(rowData)) {
                const rendered = getSearchableValue(value)
                if (rendered.toLowerCase().includes(lowerQuery)) {
                  matched_column = key
                  matched_value = rendered.length > 120 ? `${rendered.slice(0, 120)}...` : rendered
                  break
                }
              }
            }

            if (!matched_column) return null
            return {
              row_id: row.id,
              table_id: row.table_id,
              matched_column,
              matched_value,
              data: row.data ?? {},
            }
          })
          .filter(Boolean)
          .slice(0, limit)

        return mcpOk({ results, count: results.length, scope: 'scoped' })
      }

      const { data, error } = await (supabase as any).rpc('search_custom_table_rows', { q: args.query, lim: limit })
      if (error) return mcpErr(error.message)

      const results = ((data ?? []) as any[]).map((row) => {
        const rowData = row.data && typeof row.data === 'object' ? row.data as Record<string, any> : {}
        const lowerQuery = args.query.toLowerCase()
        let matched_column: string | null = null
        let matched_value: string | null = null

        for (const [key, value] of Object.entries(rowData)) {
          const rendered = getSearchableValue(value)
          if (rendered.toLowerCase().includes(lowerQuery)) {
            matched_column = key
            matched_value = rendered.length > 120 ? `${rendered.slice(0, 120)}...` : rendered
            break
          }
        }

        return {
          row_id: row.id,
          table_id: row.table_id,
          table_name: row.table_name ?? null,
          matched_column,
          matched_value,
          data: row.data ?? {},
        }
      })

      return mcpOk({ results, count: results.length, scope: 'tenant' })
    }

    const { data, error } = await supabase.from('custom_table_rows')
      .select('id, data, created_at, updated_at, created_by')
      .eq('table_id', args.table_id)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) return mcpErr(error.message)

    const lowerQuery = args.query.toLowerCase()
    const results = ((data ?? []) as any[])
      .map((row) => {
        const rowData = row.data && typeof row.data === 'object' ? row.data as Record<string, any> : {}
        let matched_column: string | null = String(row.id).toLowerCase().includes(lowerQuery) ? 'id' : null
        let matched_value: string | null = matched_column ? String(row.id) : null

        if (!matched_column) {
          for (const [key, value] of Object.entries(rowData)) {
            const rendered = getSearchableValue(value)
            if (rendered.toLowerCase().includes(lowerQuery)) {
              matched_column = key
              matched_value = rendered.length > 120 ? `${rendered.slice(0, 120)}...` : rendered
              break
            }
          }
        }

        if (!matched_column && row.created_by && String(row.created_by).toLowerCase().includes(lowerQuery)) {
          matched_column = 'created_by'
          matched_value = String(row.created_by)
        }

        if (!matched_column) return null
        return {
          row_id: row.id,
          table_id: args.table_id,
          matched_column,
          matched_value,
          data: row.data ?? {},
          created_at: row.created_at,
          updated_at: row.updated_at,
        }
      })
      .filter(Boolean)
      .slice(0, limit)

    return mcpOk({ results, count: results.length, scope: 'table' })
  })

  server.tool('data_rows_get', 'Get one row of a custom table by ID.', {
    table_id: z.string().describe('Table ID'),
    row_id: z.string().describe('Row ID'),
  }, async (args) => run(async () => ({ row: await dataTables.getRow(readCtx(), await resolveTableRef(readCtx(), args.table_id), args.row_id) })))

  server.tool('data_rows_upsert', 'Insert or update a row in a custom table. When the table is used by data-table event workflows, created and updated rows trigger those workflows automatically, making this a core MCP write path for app state.', {
    table_id: z.string().describe('Table ID'),
    row_id: z.string().optional().describe('Row ID for update (omit for insert)'),
    data: z.record(z.string(), z.any()).describe('Row data as key-value pairs'),
  }, async (args) => run(async () => {
    const [result] = await dataTables.upsertRows(writeCtx(), await resolveTableRef(writeCtx(), args.table_id), [{ row_id: args.row_id, data: args.data }])
    return result.action === 'updated' ? { updated: true, row_id: result.row_id } : { created: true, row_id: result.row_id }
  }))

  server.tool('data_rows_create', `Insert several rows into a custom table in one call (up to ${MCP_ROW_WRITE_CAP}). Cells are validated against the column types; data-table event workflows fire for each created row.`, {
    table_id: z.string().describe('Table ID, name or system name'),
    rows: z.array(z.record(z.string(), z.any())).min(1).max(MCP_ROW_WRITE_CAP).describe('Row data objects (column key → value), one per new row'),
  }, async (args) => run(async () => {
    const tableId = await resolveTableRef(writeCtx(), args.table_id)
    const results = await dataTables.upsertRows(writeCtx(), tableId, (args.rows as Array<Record<string, unknown>>).map((data) => ({ data })))
    return { created: results.length, table_id: tableId, row_ids: results.map((r) => r.row_id) }
  }))

  server.tool('data_rows_update', `Change cells of existing rows of a custom table — the rows given by row_ids, or every row matching filters (at most max_rows, default 50, cap ${MCP_ROW_WRITE_CAP}; more matches fail without changing anything). Other cells are kept. data-table event workflows fire for each updated row.`, {
    table_id: z.string().describe('Table ID, name or system name'),
    data: z.record(z.string(), z.any()).describe('Cells to set (column key → value)'),
    row_ids: z.array(z.string()).max(MCP_ROW_WRITE_CAP).optional().describe('Rows to update'),
    filters: z.array(rowFilterSchema).optional().describe('Update every row matching all filters (instead of row_ids)'),
    max_rows: z.number().optional().describe(`Safety cap for a filtered update (default 50, at most ${MCP_ROW_WRITE_CAP})`),
  }, async (args) => run(async () => {
    const tableId = await resolveTableRef(writeCtx(), args.table_id)
    let ids = args.row_ids ?? []
    if (!ids.length) {
      if (!args.filters?.length) throw new Error('Pass row_ids or filters')
      const max = Math.min(Math.max(1, Math.floor(args.max_rows ?? 50)), MCP_ROW_WRITE_CAP)
      ids = (await rowsMatching(writeCtx(), tableId, args.filters, max)).map((r) => String(r.id))
    }
    const updated: string[] = []
    for (const id of [...new Set(ids as string[])]) { await dataTables.updateRow(writeCtx(), tableId, id, args.data as Record<string, unknown>); updated.push(id) }
    return { updated: updated.length, table_id: tableId, row_ids: updated }
  }))

  server.tool('data_rows_import', `Import rows into a custom table from a CSV, TSV or .xlsx file (file_base64 + file_name) or from CSV text (csv_text, e.g. data pasted into the chat). Headers are matched to columns by name (case-insensitive, spaces / underscores ignored) unless mapping says otherwise; new_columns adds columns first. Every row is validated (numbers incl. currency such as $1,234.50, dates → YYYY-MM-DD, yes / no, choices, required columns) and errors come back with the spreadsheet row number, column and reason. Use dry_run first. mode: insert (default), upsert (key_column), or replace (deletes every existing row; confirm_replace must be the table name). With errors nothing is written unless skip_invalid. fire_triggers (default true) fires data-table event workflows for created / updated rows. Limits: ${DATA_IMPORT_LIMITS.maxBytes / 1024 / 1024} MB, ${DATA_IMPORT_LIMITS.maxRows.toLocaleString('en-US')} rows; above ${DATA_IMPORT_LIMITS.syncRows.toLocaleString('en-US')} rows the import runs as a background job (the result says which job).`, {
    table_id: z.string().describe('Table ID, name or system name'),
    file_base64: z.string().optional().describe('The file, base64 (.csv, .tsv or .xlsx)'),
    file_name: z.string().optional().describe('File name; the extension picks the reader (default import.csv)'),
    csv_text: z.string().optional().describe('CSV text with a header row, instead of file_base64'),
    sheet: z.string().optional().describe('.xlsx: the sheet to read (default the first)'),
    mapping: z.record(z.string(), z.string().nullable()).optional().describe('File header → column key or name (null skips the header)'),
    new_columns: z.array(z.object({
      header: z.string().describe('File header the new column is filled from'),
      name: z.string().optional().describe('Column name (default the header)'),
      type: z.enum(['text', 'longtext', 'number', 'date', 'boolean', 'select']).optional().describe('Column type (default text)'),
      options: z.array(z.string()).optional().describe('Choices, for select columns'),
    })).optional().describe('Columns to add before importing (needs data.edit_schema)'),
    mode: z.enum(['insert', 'upsert', 'replace']).optional().describe('insert (default), upsert (match key_column), replace (delete every existing row first)'),
    key_column: z.string().optional().describe('upsert: the column whose value identifies a row'),
    confirm_replace: z.string().optional().describe('replace: the table name, to confirm'),
    date_order: z.enum(['auto', 'dmy', 'mdy', 'ymd']).optional().describe('Day / month order of numeric dates (default auto)'),
    trim: z.boolean().optional().describe('Trim whitespace (default true)'),
    empty_cells: z.enum(['empty', 'ignore']).optional().describe('empty (default) clears the column; ignore leaves it unchanged'),
    skip_invalid: z.boolean().optional().describe('Import the valid rows and skip rows with errors'),
    fire_triggers: z.boolean().optional().describe('Fire data-table event workflows for created / updated rows (default true)'),
    dry_run: z.boolean().optional().describe('Validate only and return the report; nothing is written'),
  }, async (args) => run(async () => {
    const tableId = await resolveTableRef(writeCtx(), args.table_id)
    const { table_id: _ref, file_base64, csv_text, ...rest } = args as Record<string, any>
    if (!file_base64 && typeof csv_text !== 'string') throw new Error('Pass file_base64 (with file_name) or csv_text')
    const bytes = file_base64 ? decodeBase64(file_base64) : new TextEncoder().encode(String(csv_text))
    const options: DataImportOptions = { ...rest, file_name: String(rest.file_name ?? '').trim() || 'import.csv' }
    if (!options.dry_run) {
      const plan = await planImport(writeCtx(), tableId, bytes, { ...options, dry_run: true })
      if (plan.validation.valid.length > DATA_IMPORT_LIMITS.syncRows) {
        // Large imports run in resumable batches as a background job.
        const { enqueueUserJob } = await import('@/lib/user-jobs/runner')
        const job = await enqueueUserJob(writeCtx(), 'data.import', { ...options, table_id: tableId, table_name: plan.table.name, dry_run: undefined }, { input: bytes })
        return { started_job: true, job_id: job.id, status: job.status, rows: plan.validation.valid.length, note: 'The import runs in the background; the job result has the counts and errors.' }
      }
    }
    return importRowsNow(writeCtx(), tableId, bytes, options)
  }))

  server.tool('data_rows_delete', 'Delete a row from a custom table. If the table is connected to data_table_event workflows, deleting a row triggers those workflows.', {
    row_id: z.string().describe('Row ID to delete'),
  }, async (args) => run(async () => {
    await dataTables.deleteRowById(writeCtx(), args.row_id)
    return { deleted: true, row_id: args.row_id }
  }))

  server.tool('data_rows_bulk_delete', `Delete several rows of a custom table at once — by row_ids, or every row matching filters (at most max_rows, default 50, cap ${MCP_ROW_WRITE_CAP}; more matches fail without deleting anything). Data-table event workflows fire for each deleted row.`, {
    table_id: z.string().describe('Table ID'),
    row_ids: z.array(z.string()).max(1000).optional().describe('Row IDs to delete'),
    filters: z.array(rowFilterSchema).optional().describe('Delete every row matching all filters (instead of row_ids)'),
    max_rows: z.number().optional().describe(`Safety cap for a filtered delete (default 50, at most ${MCP_ROW_WRITE_CAP})`),
  }, async (args) => run(async () => {
    const tableId = await resolveTableRef(writeCtx(), args.table_id)
    if (args.row_ids?.length) return dataTables.deleteRows(writeCtx(), tableId, args.row_ids)
    if (!args.filters?.length) throw new Error('Pass row_ids or filters')
    const max = Math.min(Math.max(1, Math.floor(args.max_rows ?? 50)), MCP_ROW_WRITE_CAP)
    const rows = await rowsMatching(writeCtx(), tableId, args.filters, max)
    return dataTables.deleteRows(writeCtx(), tableId, rows.map((r) => String(r.id)))
  }))
}
