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

export const dataTableEndpoints = [
  listDataTablesEndpoint, createDataTableEndpoint, getDataTableEndpoint, updateDataTableEndpoint, deleteDataTableEndpoint,
  listRowsEndpoint, upsertRowsEndpoint, getRowEndpoint, updateRowEndpoint, deleteRowEndpoint, bulkDeleteRowsEndpoint,
]
