/**
 * Data-table tools of an agent (server only): query_data_table,
 * insert_data_row, insert_data_rows (many, same insert grant), update_data_rows, delete_data_rows.
 *
 * Access is per table and per operation (output_config.data_access.grants:
 * read / insert / update / delete). New agents have none; a legacy
 * "all tables" agent may read / insert / update any table (never delete).
 * With an acting person, reads need data.view and writes data.manage_rows;
 * without one the agent's grants apply. Updates and deletes are capped per
 * call.
 */
import { agentTableAllows, type AgentTableOperation } from '@/lib/agent-knowledge'
import { AgentToolError, requireActingPermission, type AgentToolRuntime, type ToolResult } from './runtime'

const COLUMN = /^[A-Za-z0-9_ -]{1,64}$/
export const MAX_UPDATE_ROWS = 100
export const MAX_INSERT_ROWS = 100

const OPERATION: Record<string, AgentTableOperation> = {
  query_data_table: 'read', insert_data_row: 'insert', insert_data_rows: 'insert', update_data_rows: 'update', delete_data_rows: 'delete',
}
const OPERATION_LABEL: Record<AgentTableOperation, string> = { read: 'read', insert: 'add rows to', update: 'update rows in', delete: 'delete rows from' }

export function dataToolsEnabled(runtime: AgentToolRuntime): boolean {
  const access = runtime.outputConfig.data_access
  return access.mode === 'all' || (access.mode === 'selected' && access.grants.length > 0)
}

async function resolveTable(runtime: AgentToolRuntime, tableName: unknown, op: AgentTableOperation) {
  const name = String(tableName ?? '').trim()
  if (!name) throw new AgentToolError('table_name is required')
  const db = runtime.db() as any
  const { data: table } = await db.from('custom_tables').select('id, name').eq('name', name).eq('tenant_id', runtime.tenantId).maybeSingle()
  if (!table) throw new AgentToolError(`Table "${name}" not found`, 404)
  if (!agentTableAllows(runtime.outputConfig.data_access, table.id, op)) {
    throw new AgentToolError(`This agent may not ${OPERATION_LABEL[op]} table "${table.name}" — grant it on the agent's Tools tab`, 403)
  }
  return table as { id: string; name: string }
}

function column(value: unknown, label: string): string {
  const col = String(value ?? '').trim()
  if (!COLUMN.test(col)) throw new AgentToolError(`${label} must be a column name (letters, numbers, spaces, - or _)`)
  return col
}

export async function runDataTool(runtime: AgentToolRuntime, name: string, args: Record<string, any>): Promise<ToolResult> {
  if (!dataToolsEnabled(runtime)) throw new AgentToolError('Data access is disabled for this agent', 403)
  const db = runtime.db() as any
  const op = OPERATION[name]
  if (!op) throw new AgentToolError(`Unknown data tool: ${name}`)
  const table = await resolveTable(runtime, args.table_name, op)

  if (name === 'query_data_table') {
    await requireActingPermission(runtime, ['data.view'], { requireUser: false, what: 'Reading data' })
    const limit = Math.max(1, Math.min(Number.isFinite(Number(args.limit)) ? Math.floor(Number(args.limit)) : 50, 100))
    let q = db.from('custom_table_rows').select('id, data').eq('table_id', table.id).eq('tenant_id', runtime.tenantId).limit(limit)
    if (args.filter_column && args.filter_value !== undefined && args.filter_value !== null) {
      q = q.filter(`data->>${column(args.filter_column, 'filter_column')}`, 'eq', String(args.filter_value))
    }
    const { data: rows, error } = await q
    if (error) throw new AgentToolError(error.message, 500)
    return { table: table.name, rows: (rows ?? []).map((r: any) => ({ id: r.id, ...r.data })), count: rows?.length ?? 0 }
  }

  if (name === 'insert_data_row') {
    await requireActingPermission(runtime, ['data.manage_rows'], { requireUser: false, what: 'Adding rows' })
    const data = args.data && typeof args.data === 'object' && !Array.isArray(args.data) ? args.data : null
    if (!data) throw new AgentToolError('data must be a JSON object of column values')
    const { data: row, error } = await db.from('custom_table_rows').insert({ table_id: table.id, tenant_id: runtime.tenantId, data }).select('id').maybeSingle()
    if (error) throw new AgentToolError(error.message, 500)
    return { success: true, table: table.name, row_id: row?.id ?? null }
  }

  if (name === 'insert_data_rows') {
    await requireActingPermission(runtime, ['data.manage_rows'], { requireUser: false, what: 'Adding rows' })
    const rows = Array.isArray(args.rows) ? args.rows : null
    if (!rows || !rows.length) throw new AgentToolError('rows must be a non-empty array of JSON objects of column values')
    if (rows.length > MAX_INSERT_ROWS) throw new AgentToolError(`At most ${MAX_INSERT_ROWS} rows per call`)
    if (rows.some((r: unknown) => !r || typeof r !== 'object' || Array.isArray(r))) throw new AgentToolError('Each row must be a JSON object of column values')
    const { data: inserted, error } = await db.from('custom_table_rows').insert(rows.map((data: Record<string, unknown>) => ({ table_id: table.id, tenant_id: runtime.tenantId, data }))).select('id')
    if (error) throw new AgentToolError(error.message, 500)
    return { success: true, table: table.name, inserted: inserted?.length ?? rows.length, row_ids: (inserted ?? []).map((r: any) => r.id) }
  }

  if (name === 'update_data_rows') {
    await requireActingPermission(runtime, ['data.manage_rows'], { requireUser: false, what: 'Updating rows' })
    const filterColumn = column(args.filter_column, 'filter_column')
    if (args.filter_value === undefined || args.filter_value === null) throw new AgentToolError('filter_value is required')
    const updates = args.updates && typeof args.updates === 'object' && !Array.isArray(args.updates) ? args.updates : null
    if (!updates) throw new AgentToolError('updates must be a JSON object of column values')
    const { data: rows, error } = await db.from('custom_table_rows').select('id, data')
      .eq('table_id', table.id).eq('tenant_id', runtime.tenantId)
      .filter(`data->>${filterColumn}`, 'eq', String(args.filter_value))
      .limit(MAX_UPDATE_ROWS + 1)
    if (error) throw new AgentToolError(error.message, 500)
    if ((rows ?? []).length > MAX_UPDATE_ROWS) {
      throw new AgentToolError(`More than ${MAX_UPDATE_ROWS} rows match — narrow the filter (agents update at most ${MAX_UPDATE_ROWS} rows per call)`)
    }
    let updated = 0
    for (const row of rows ?? []) {
      const { error: updateError } = await db.from('custom_table_rows').update({ data: { ...row.data, ...updates } })
        .eq('id', row.id).eq('tenant_id', runtime.tenantId).eq('table_id', table.id)
      if (updateError) throw new AgentToolError(updateError.message, 500)
      updated++
    }
    return { success: true, table: table.name, updated }
  }

  if (name === 'delete_data_rows') {
    await requireActingPermission(runtime, ['data.manage_rows'], { requireUser: false, what: 'Deleting rows' })
    const filterColumn = column(args.filter_column, 'filter_column')
    if (args.filter_value === undefined || args.filter_value === null || String(args.filter_value) === '') throw new AgentToolError('filter_value is required')
    const { data: rows, error } = await db.from('custom_table_rows').select('id')
      .eq('table_id', table.id).eq('tenant_id', runtime.tenantId)
      .filter(`data->>${filterColumn}`, 'eq', String(args.filter_value))
      .limit(MAX_UPDATE_ROWS + 1)
    if (error) throw new AgentToolError(error.message, 500)
    if ((rows ?? []).length > MAX_UPDATE_ROWS) {
      throw new AgentToolError(`More than ${MAX_UPDATE_ROWS} rows match — narrow the filter (agents delete at most ${MAX_UPDATE_ROWS} rows per call)`)
    }
    const ids = (rows ?? []).map((r: any) => r.id)
    if (ids.length === 0) return { success: true, table: table.name, deleted: 0 }
    const { error: deleteError } = await db.from('custom_table_rows').delete().in('id', ids).eq('tenant_id', runtime.tenantId).eq('table_id', table.id)
    if (deleteError) throw new AgentToolError(deleteError.message, 500)
    return { success: true, table: table.name, deleted: ids.length }
  }

  throw new AgentToolError(`Unknown data tool: ${name}`)
}
