'use server'

import { createClient, getCachedUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/permissions-server'
import { enqueueDataTableEventWorkflows } from '@/lib/data-table-workflow-triggers'
import { enqueueDeletionJob, kickDeletionProcessor } from '@/lib/deletion-queue'
import { slugifyColumnName } from '@/lib/data-table-cells'
import { recordAssetChange } from '@/lib/github-sync/enqueue'

async function requireAuth() {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')
  return { supabase, user }
}

export async function createCustomTable(formData: FormData) {
  await requirePermission('data.create')
  const { supabase, user } = await requireAuth()

  const { data: profile } = await supabase.from('users').select('current_tenant_id, tenant_id').eq('id', user.id).single()
  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id
  if (!tenantId) throw new Error('No tenant')

  const name = formData.get('name') as string
  const description = formData.get('description') as string
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const { data: created, error } = await supabase.from('custom_tables').insert({
    tenant_id: tenantId,
    name,
    slug,
    description: description || null,
    columns: [
      { id: crypto.randomUUID(), name: 'ID', type: 'number', key: 'id' },
      { id: crypto.randomUUID(), name: 'Date Created', type: 'date', key: 'date_created' },
    ],
    created_by: user.id,
  }).select('id').single()

  if (error) throw error
  if ((created as any)?.id) {
    void recordAssetChange({ supabase, tenantId, assetType: 'data_table', assetId: (created as any).id, assetName: name, action: 'save', actorId: user.id })
  }
  revalidatePath('/data')
}

export async function updateTableColumns(tableId: string, columns: any[]) {
  await requirePermission('data.edit_schema')
  const { supabase } = await requireAuth()
  // Every column needs a stable `key` — it is the canonical row-data key used
  // by the grid, workflow engine, MCP tools, and agents. Backfill missing keys
  // from the name (once assigned, a key never changes even if the name does).
  const normalized = columns.map((col) => ({
    ...col,
    key: col.key || slugifyColumnName(String(col.name ?? '')),
  }))
  const { data: updated, error } = await supabase.from('custom_tables').update({ columns: normalized }).eq('id', tableId).select('tenant_id, name').single()
  if (error) throw error
  if ((updated as any)?.tenant_id) {
    void recordAssetChange({ supabase, tenantId: (updated as any).tenant_id, assetType: 'data_table', assetId: tableId, assetName: (updated as any).name ?? null, action: 'save' })
  }
  revalidatePath('/data')
}

export async function deleteCustomTable(tableId: string) {
  await requirePermission('data.delete')
  const { supabase, user } = await requireAuth()
  const { data: table, error } = await supabase.from('custom_tables').select('id, name, tenant_id').eq('id', tableId).single()
  if (error) throw error
  if (!table) throw new Error('Table not found')
  await enqueueDeletionJob(supabase, {
    tenantId: (table as any).tenant_id,
    createdBy: user.id,
    targetType: 'data_table',
    targetId: tableId,
    payload: { name: (table as any).name ?? null },
  })
  void recordAssetChange({ supabase, tenantId: (table as any).tenant_id, assetType: 'data_table', assetId: tableId, assetName: (table as any).name ?? null, action: 'delete', actorId: user.id })
  kickDeletionProcessor()
  revalidatePath('/data')
}

export async function bulkDeleteCustomTables(tableIds: string[]) {
  await requirePermission('data.delete')
  const { supabase, user } = await requireAuth()

  const uniqueIds = Array.from(new Set(tableIds.map((id) => id.trim()).filter(Boolean)))
  if (uniqueIds.length === 0) return { queued: 0 }

  const { data: tables, error } = await supabase
    .from('custom_tables')
    .select('id, name, tenant_id')
    .in('id', uniqueIds)

  if (error) throw error

  for (const table of tables ?? []) {
    await enqueueDeletionJob(supabase, {
      tenantId: (table as any).tenant_id,
      createdBy: user.id,
      targetType: 'data_table',
      targetId: (table as any).id,
      payload: { name: (table as any).name ?? null },
    })
    void recordAssetChange({ supabase, tenantId: (table as any).tenant_id, assetType: 'data_table', assetId: (table as any).id, assetName: (table as any).name ?? null, action: 'delete', actorId: user.id })
  }

  kickDeletionProcessor()
  revalidatePath('/data')
  return { queued: (tables ?? []).length }
}

export async function insertRow(tableId: string, tenantId: string, data: Record<string, any>) {
  await requirePermission('data.manage_rows')
  const { supabase, user } = await requireAuth()

  const { data: profile } = await supabase.from('users').select('current_tenant_id, tenant_id').eq('id', user.id).single()
  const userTenantId = profile?.current_tenant_id ?? profile?.tenant_id
  const effectiveTenantId = userTenantId ?? tenantId

  // Auto-populate system columns
  const { data: table } = await supabase.from('custom_tables').select('columns').eq('id', tableId).single()
  const cols = (table?.columns ?? []) as any[]

  // Auto-number ID
  if (!data.id && data.id !== 0) {
    const idCol = cols.find((c: any) => c.key === 'id' && c.type === 'number')
    if (idCol) {
      const { data: rows } = await supabase.from('custom_table_rows').select('data').eq('table_id', tableId).order('created_at', { ascending: false }).limit(1)
      const maxId = rows?.length ? (Number((rows[0].data as any)?.id) || 0) : 0
      data.id = maxId + 1
    }
  }

  // Auto date created
  if (!data.date_created && !data['Date Created']) {
    const dateCol = cols.find((c: any) => c.key === 'date_created')
    if (dateCol) data['Date Created'] = new Date().toISOString().split('T')[0]
  }

  const { data: insertedRow, error } = await supabase.from('custom_table_rows').insert({
    table_id: tableId,
    tenant_id: effectiveTenantId,
    data,
    created_by: user.id,
    updated_by: user.id, // On insert, creator is also the most recent editor
  } as any).select('id').single()
  if (error) throw new Error(`Insert row failed: ${error.message} (tenant: ${effectiveTenantId}, table: ${tableId})`)
  if (insertedRow?.id) {
    await enqueueDataTableEventWorkflows({
      supabase,
      tenantId: effectiveTenantId,
      tableId,
      rowId: insertedRow.id,
      rowData: data,
      eventType: 'created',
      initiator: { userId: user.id, via: 'ui' },
    })
  }
  return insertedRow?.id as string | undefined
}

export async function updateRow(rowId: string, data: Record<string, any>) {
  await requirePermission('data.manage_rows')
  const { supabase, user } = await requireAuth()
  const { data: existingRow } = await supabase
    .from('custom_table_rows')
    .select('id, table_id, tenant_id')
    .eq('id', rowId)
    .single()
  // Stamp updated_by so the detail drawer can show "Last edited by X".
  // Pass updated_at explicitly rather than relying on a DB trigger —
  // the column has a default of now() but UPDATEs don't re-fire
  // defaults; we need to set it in the payload.
  const { error } = await (supabase as any)
    .from('custom_table_rows')
    .update({
      data,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId)
  if (error) throw error
  if (existingRow?.table_id && existingRow?.tenant_id) {
    await enqueueDataTableEventWorkflows({
      supabase,
      tenantId: existingRow.tenant_id,
      tableId: existingRow.table_id,
      rowId,
      rowData: data,
      eventType: 'updated',
      initiator: { userId: user.id, via: 'ui' },
    })
  }
}

export async function deleteRow(rowId: string) {
  await requirePermission('data.manage_rows')
  const { supabase, user } = await requireAuth()

  const { data: row } = await supabase.from('custom_table_rows').select('table_id, tenant_id, data').eq('id', rowId).single()
  if (!row) throw new Error('Row not found')

  await enqueueDeletionJob(supabase, {
    tenantId: row.tenant_id,
    createdBy: user.id,
    targetType: 'data_row',
    targetId: rowId,
    payload: {
      table_id: row.table_id,
      row_data: (row.data as Record<string, any>) ?? {},
    },
  })
  kickDeletionProcessor()
}

export async function bulkDeleteRows(rowIds: string[]) {
  await requirePermission('data.manage_rows')
  const { supabase, user } = await requireAuth()

  const uniqueIds = Array.from(new Set(rowIds.map((id) => id.trim()).filter(Boolean)))
  if (uniqueIds.length === 0) return { queued: 0 }

  const { data: rows, error } = await supabase
    .from('custom_table_rows')
    .select('id, table_id, tenant_id, data')
    .in('id', uniqueIds)

  if (error) throw error

  for (const row of rows ?? []) {
    await enqueueDeletionJob(supabase, {
      tenantId: (row as any).tenant_id,
      createdBy: user.id,
      targetType: 'data_row',
      targetId: (row as any).id,
      payload: {
        table_id: (row as any).table_id,
        row_data: ((row as any).data as Record<string, any>) ?? {},
      },
    })
  }

  kickDeletionProcessor()
  return { queued: (rows ?? []).length }
}
