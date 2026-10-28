// Data-table rows for exports and packages. Config manifests carry schemas
// only by default; a `table_rows` section (opt-in) or a package's data block
// carries rows as { id, data } (the source row id is identity, never reused
// as the local primary key — row ids are global).
//
// Writing modes:
//   merge   — rows already mapped (source id → local row that still exists)
//             are updated, the rest inserted (default)
//   replace — every existing row of the table is deleted, then all inserted
//   skip    — nothing is written
//
// Mappings are kept by the caller (github_sync_asset_map for config apply,
// package_install_assets for packages) through the `mapping` callbacks.

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */

export type RowMode = 'merge' | 'replace' | 'skip'

export interface PortableRow {
  id: string
  data: Record<string, unknown>
}

export const MAX_ROWS_PER_TABLE = 10_000

/** Rows of one table, oldest first, as { id, data }. */
export async function exportTableRows(supabase: any, tenantId: string, tableId: string, limit = MAX_ROWS_PER_TABLE): Promise<PortableRow[]> {
  const rows: PortableRow[] = []
  const pageSize = 1000
  for (let offset = 0; offset < limit; offset += pageSize) {
    const { data, error } = await supabase.from('custom_table_rows')
      .select('id, data')
      .eq('tenant_id', tenantId)
      .eq('table_id', tableId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, Math.min(offset + pageSize, limit) - 1)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) rows.push({ id: String(row.id), data: (row.data ?? {}) as Record<string, unknown> })
    if (!data || data.length < pageSize) break
  }
  if (rows.length >= limit) {
    const { count } = await supabase.from('custom_table_rows').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('table_id', tableId)
    if ((count ?? 0) > limit) throw new Error(`Table has ${count} rows; at most ${limit} rows can travel with an export or package`)
  }
  return rows
}

export interface RowWriteResult {
  inserted: number
  updated: number
  deleted: number
  skipped: boolean
  /** source row id → local row id for every written row. */
  mappings: Record<string, string>
}

export async function writeTableRows(args: {
  supabase: any
  tenantId: string
  tableId: string
  rows: PortableRow[]
  mode: RowMode
  actorId?: string | null
  /** Known source → local row ids (merge). */
  existingMappings?: Record<string, string>
}): Promise<RowWriteResult> {
  const { supabase, tenantId, tableId, rows, mode } = args
  const result: RowWriteResult = { inserted: 0, updated: 0, deleted: 0, skipped: mode === 'skip', mappings: {} }
  if (mode === 'skip') return result
  if (rows.length > MAX_ROWS_PER_TABLE) throw new Error(`At most ${MAX_ROWS_PER_TABLE} rows per table`)

  let live = new Set<string>()
  if (mode === 'replace') {
    const { count, error } = await supabase.from('custom_table_rows').delete({ count: 'exact' }).eq('tenant_id', tenantId).eq('table_id', tableId)
    if (error) throw new Error(error.message)
    result.deleted = count ?? 0
  } else {
    const localIds = Object.values(args.existingMappings ?? {})
    for (let i = 0; i < localIds.length; i += 200) {
      const { data } = await supabase.from('custom_table_rows').select('id').eq('tenant_id', tenantId).eq('table_id', tableId).in('id', localIds.slice(i, i + 200))
      for (const row of data ?? []) live.add(String(row.id))
    }
  }
  if (mode === 'replace') live = new Set()

  const inserts: Array<{ source: string; data: Record<string, unknown> }> = []
  const updates: Array<{ source: string; local: string; data: Record<string, unknown> }> = []
  for (const row of rows) {
    const local = mode === 'merge' ? args.existingMappings?.[row.id] : undefined
    if (local && live.has(local)) updates.push({ source: row.id, local, data: row.data ?? {} })
    else inserts.push({ source: row.id, data: row.data ?? {} })
  }
  // Rows applied before: one upsert per 500 (was one UPDATE per row). The ids
  // were checked above to be this tenant's rows of this table, so the
  // conflict target only ever updates them.
  const updatedAt = new Date().toISOString()
  for (let i = 0; i < updates.length; i += 500) {
    const chunk = updates.slice(i, i + 500)
    const { error } = await supabase.from('custom_table_rows')
      .upsert(chunk.map((row) => ({ id: row.local, tenant_id: tenantId, table_id: tableId, data: row.data, updated_by: args.actorId ?? null, updated_at: updatedAt })), { onConflict: 'id' })
    if (error) throw new Error(error.message)
    for (const row of chunk) result.mappings[row.source] = row.local
    result.updated += chunk.length
  }
  for (let i = 0; i < inserts.length; i += 500) {
    const chunk = inserts.slice(i, i + 500)
    const { data, error } = await supabase.from('custom_table_rows')
      .insert(chunk.map((row) => ({ tenant_id: tenantId, table_id: tableId, data: row.data, created_by: args.actorId ?? null })))
      .select('id')
    if (error) throw new Error(error.message)
    // PostgREST returns inserted rows in request order.
    ;(data ?? []).forEach((row: any, index: number) => { result.mappings[chunk[index].source] = String(row.id) })
    result.inserted += chunk.length
  }
  return result
}
