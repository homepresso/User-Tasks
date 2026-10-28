import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { canAccessTable } from '@/lib/api-key-permissions'
import { fromMcpContext, type ServiceContext } from '@/lib/services/context'
import * as dataTables from '@/lib/services/data-tables'
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

const rowFilterSchema = z.object({
  field: z.string().describe('Field to filter on. Use a table column key/name, or system fields like id, created_at, updated_at, created_by'),
  operator: z.enum(['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'not_empty']).describe('Filter operator'),
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

  server.tool('data_tables_list', 'List custom data tables. Data tables are the foundation for reports, lookups, retention assignment, and workflow triggers when rows are created, updated, or deleted.', {}, async () => run(async () => {
    const { data_tables } = await dataTables.listDataTables(readCtx(), {}, { limit: null, offset: 0 })
    return { tables: data_tables }
  }))

  server.tool('data_tables_get', 'Get a custom table schema including columns, lookup metadata, and table settings so MCP can safely build workflows, reports, and row operations against it.', {
    table_id: z.string().describe('Table ID'),
  }, async (args) => run(() => dataTables.getDataTable(readCtx(), args.table_id)))

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
    const result = await dataTables.queryRows(readCtx(), args.table_id, {
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
  }, async (args) => run(async () => ({ row: await dataTables.getRow(readCtx(), args.table_id, args.row_id) })))

  server.tool('data_rows_upsert', 'Insert or update a row in a custom table. When the table is used by data-table event workflows, created and updated rows trigger those workflows automatically, making this a core MCP write path for app state.', {
    table_id: z.string().describe('Table ID'),
    row_id: z.string().optional().describe('Row ID for update (omit for insert)'),
    data: z.record(z.string(), z.any()).describe('Row data as key-value pairs'),
  }, async (args) => run(async () => {
    const [result] = await dataTables.upsertRows(writeCtx(), args.table_id, [{ row_id: args.row_id, data: args.data }])
    return result.action === 'updated' ? { updated: true, row_id: result.row_id } : { created: true, row_id: result.row_id }
  }))

  server.tool('data_rows_delete', 'Delete a row from a custom table. If the table is connected to data_table_event workflows, deleting a row triggers those workflows.', {
    row_id: z.string().describe('Row ID to delete'),
  }, async (args) => run(async () => {
    await dataTables.deleteRowById(writeCtx(), args.row_id)
    return { deleted: true, row_id: args.row_id }
  }))

  server.tool('data_rows_bulk_delete', 'Delete several rows of a custom table at once. Data-table event workflows fire for each deleted row.', {
    table_id: z.string().describe('Table ID'),
    row_ids: z.array(z.string()).min(1).max(1000).describe('Row IDs to delete'),
  }, async (args) => run(() => dataTables.deleteRows(writeCtx(), args.table_id, args.row_ids)))
}
