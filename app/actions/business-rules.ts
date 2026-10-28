'use server'

import { createClient, getCachedUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/permissions-server'
import { writeAudit } from '@/lib/audit-log'
import { shallowDiff } from '@/lib/audit-log'
import { enqueueDeletionJob, kickDeletionProcessor } from '@/lib/deletion-queue'
import { recordAssetChange } from '@/lib/github-sync/enqueue'

async function getAuthContext() {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')
  const { data: profile } = await supabase
    .from('users')
    .select('current_tenant_id, tenant_id')
    .eq('id', user.id)
    .single()
  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id
  if (!tenantId) throw new Error('No tenant')
  return { supabase, user, tenantId }
}

export async function createDecisionTable(formData: FormData) {
  await requirePermission('workflows.create')
  const { supabase, user, tenantId } = await getAuthContext()

  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  if (!name) throw new Error('Name is required')

  const { data, error } = await (supabase as any)
    .from('decision_tables')
    .insert({
      tenant_id: tenantId,
      name,
      description: description || null,
      inputs: [],
      outputs: [],
      rules: [],
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  await writeAudit({
    supabase,
    tenantId,
    actorId: user.id,
    objectType: 'decision_table',
    objectId: data.id,
    action: 'create',
    summary: `Created business rule "${name}"`,
    metadata: { feature: 'decision_table' },
  })

  void recordAssetChange({ supabase, tenantId, assetType: 'decision_table', assetId: data.id, assetName: name, action: 'save', actorId: user.id })

  revalidatePath('/automations/rules')
  return data
}

function normalizeImportedFields(fields: any[] | undefined) {
  if (!Array.isArray(fields)) return []
  return fields.map((field) => ({
    id: field.id || crypto.randomUUID(),
    key: String(field.key ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    label: String(field.label ?? ''),
    type: field.type ?? 'text',
  }))
}

function normalizeImportedRules(rules: any[] | undefined) {
  if (!Array.isArray(rules)) return []
  return rules.map((rule) => ({
    id: rule.id || crypto.randomUUID(),
    label: String(rule.label ?? ''),
    enabled: rule.enabled !== false,
    conditions: Array.isArray(rule.conditions) && rule.conditions.length > 0
      ? rule.conditions.map((condition: any) => ({
          id: condition.id || crypto.randomUUID(),
          inputKey: String(condition.inputKey ?? ''),
          operator: condition.operator ?? 'equals',
          value: condition.value ?? '',
        }))
      : [{ id: crypto.randomUUID(), inputKey: '', operator: 'equals', value: '' }],
    outputs: typeof rule.outputs === 'object' && rule.outputs !== null ? rule.outputs : {},
  }))
}

export async function createDecisionTableFromImport(payload: {
  name?: string
  description?: string
  inputs?: any[]
  outputs?: any[]
  rules?: any[]
}) {
  await requirePermission('workflows.create')
  const { supabase, user, tenantId } = await getAuthContext()

  const name = String(payload.name ?? '').trim()
  if (!name) throw new Error('Name is required')

  const inputs = normalizeImportedFields(payload.inputs)
  const outputs = normalizeImportedFields(payload.outputs)
  const rules = normalizeImportedRules(payload.rules)

  const { data, error } = await (supabase as any)
    .from('decision_tables')
    .insert({
      tenant_id: tenantId,
      name,
      description: payload.description?.trim() || null,
      inputs,
      outputs,
      rules,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  await writeAudit({
    supabase,
    tenantId,
    actorId: user.id,
    objectType: 'decision_table',
    objectId: data.id,
    action: 'create',
    summary: `Imported business rule "${name}"`,
    metadata: { feature: 'decision_table', source: 'json_import' },
  })

  void recordAssetChange({ supabase, tenantId, assetType: 'decision_table', assetId: data.id, assetName: name, action: 'save', actorId: user.id })

  revalidatePath('/automations/rules')
  return data
}

export async function updateDecisionTable(
  tableId: string,
  payload: { name: string; description?: string; inputs: any[]; outputs: any[]; rules: any[] },
) {
  await requirePermission('workflows.edit')
  const { supabase, user, tenantId } = await getAuthContext()

  const { data: existing } = await (supabase as any)
    .from('decision_tables')
    .select('id, name, description, inputs, outputs, rules')
    .eq('id', tableId)
    .eq('tenant_id', tenantId)
    .single()
  if (!existing) throw new Error('Business rule not found')

  const name = payload.name.trim()
  if (!name) throw new Error('Name is required')

  const updates = {
    name,
    description: payload.description?.trim() || null,
    inputs: payload.inputs ?? [],
    outputs: payload.outputs ?? [],
    rules: payload.rules ?? [],
    updated_at: new Date().toISOString(),
  }

  const { error } = await (supabase as any)
    .from('decision_tables')
    .update(updates)
    .eq('id', tableId)
    .eq('tenant_id', tenantId)
  if (error) throw new Error(error.message)

  await writeAudit({
    supabase,
    tenantId,
    actorId: user.id,
    objectType: 'decision_table',
    objectId: tableId,
    action: 'update',
    summary: `Updated business rule "${name}"`,
    diff: shallowDiff(existing, updates as any, ['name', 'description', 'inputs', 'outputs', 'rules'] as any),
    metadata: { feature: 'decision_table' },
  })

  void recordAssetChange({ supabase, tenantId, assetType: 'decision_table', assetId: tableId, assetName: name, action: 'save', actorId: user.id })

  revalidatePath('/automations/rules')
  revalidatePath(`/automations/rules/${tableId}`)
}

export async function deleteDecisionTable(tableId: string) {
  await requirePermission('workflows.delete')
  const { supabase, user, tenantId } = await getAuthContext()

  const { data: existing } = await (supabase as any)
    .from('decision_tables')
    .select('id, name')
    .eq('id', tableId)
    .eq('tenant_id', tenantId)
    .single()
  if (!existing) throw new Error('Business rule not found')

  await enqueueDeletionJob(supabase, {
    tenantId,
    createdBy: user.id,
    targetType: 'decision_table',
    targetId: tableId,
    payload: { name: existing.name ?? null },
  })

  await writeAudit({
    supabase,
    tenantId,
    actorId: user.id,
    objectType: 'decision_table',
    objectId: tableId,
    action: 'delete',
    summary: `Queued deletion for business rule "${existing.name}"`,
    metadata: { feature: 'decision_table' },
  })

  void recordAssetChange({ supabase, tenantId, assetType: 'decision_table', assetId: tableId, assetName: existing.name ?? null, action: 'delete', actorId: user.id })

  kickDeletionProcessor()
  revalidatePath('/automations/rules')
}

export async function bulkDeleteDecisionTables(tableIds: string[]) {
  await requirePermission('workflows.delete')
  const { supabase, user, tenantId } = await getAuthContext()

  const uniqueIds = Array.from(new Set(tableIds.map((id) => id.trim()).filter(Boolean)))
  if (uniqueIds.length === 0) return { queued: 0 }

  const { data: tables, error } = await (supabase as any)
    .from('decision_tables')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .in('id', uniqueIds)
  if (error) throw new Error(error.message)

  for (const table of tables ?? []) {
    await enqueueDeletionJob(supabase, {
      tenantId,
      createdBy: user.id,
      targetType: 'decision_table',
      targetId: (table as any).id,
      payload: { name: (table as any).name ?? null },
    })

    await writeAudit({
      supabase,
      tenantId,
      actorId: user.id,
      objectType: 'decision_table',
      objectId: (table as any).id,
      action: 'delete',
      summary: `Queued deletion for business rule "${(table as any).name}"`,
      metadata: { feature: 'decision_table' },
    })

    void recordAssetChange({ supabase, tenantId, assetType: 'decision_table', assetId: (table as any).id, assetName: (table as any).name ?? null, action: 'delete', actorId: user.id })
  }

  kickDeletionProcessor()
  revalidatePath('/automations/rules')
  return { queued: (tables ?? []).length }
}
