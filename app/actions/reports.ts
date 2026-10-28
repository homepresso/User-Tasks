'use server'

import { createClient, getCachedUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { ReportConfig } from '@/lib/report-sources'
import { requirePermission } from '@/lib/permissions-server'
import { writeAudit } from '@/lib/audit-log'
import { enqueueDeletionJob, kickDeletionProcessor } from '@/lib/deletion-queue'
import { normalizeReportConfig } from '@/lib/report-config'
import { recordAssetChange } from '@/lib/github-sync/enqueue'

async function getAuthContext() {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')
  const { data: profile } = await supabase.from('users').select('current_tenant_id, tenant_id').eq('id', user.id).single()
  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id
  if (!tenantId) throw new Error('No tenant')
  return { supabase, userId: user.id, tenantId }
}

export async function getReport(id: string) {
  const { supabase } = await getAuthContext()
  const { data, error } = await (supabase as any)
    .from('reports')
    .select('*')
    .eq('id', id)
    .single()
  if (error || !data) throw new Error('Report not found')
  return data as any
}

export async function createReport(input: {
  name: string
  description?: string
  config: ReportConfig
  category?: string
  is_shared?: boolean
}) {
  const { supabase, userId, tenantId } = await getAuthContext()
  await requirePermission('reports.create')

  const { data, error } = await (supabase as any)
    .from('reports')
    .insert({
      tenant_id: tenantId,
      created_by: userId,
      name: input.name,
      description: input.description || null,
      config: normalizeReportConfig(input.config),
      category: input.category || 'custom',
      is_shared: input.is_shared ?? false,
    })
    .select('id')
    .single()

  if (error) throw new Error('Failed to create report')
  await writeAudit({
    supabase, tenantId, actorId: userId,
    objectType: 'report', objectId: (data as any).id, action: 'create',
    summary: `Created report "${input.name}"`,
    metadata: { category: input.category || 'custom' },
  })
  void recordAssetChange({ supabase, tenantId, assetType: 'report', assetId: (data as any).id, assetName: input.name, action: 'save', actorId: userId })
  revalidatePath('/reports')
  return data
}

export async function updateReport(id: string, input: {
  name?: string
  description?: string
  config?: ReportConfig
  category?: string
}) {
  const { supabase, userId, tenantId } = await getAuthContext()
  await requirePermission('reports.edit_own')
  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  if (input.name !== undefined) updates.name = input.name
  if (input.description !== undefined) updates.description = input.description || null
  if (input.config !== undefined) updates.config = normalizeReportConfig(input.config)
  if (input.category !== undefined) updates.category = input.category

  const { error } = await (supabase as any)
    .from('reports')
    .update(updates)
    .eq('id', id)
    .eq('created_by', userId)

  if (error) throw new Error('Failed to update report')
  void recordAssetChange({ supabase, tenantId, assetType: 'report', assetId: id, assetName: input.name ?? null, action: 'save', actorId: userId })
  revalidatePath('/reports')
}

export async function deleteReport(id: string) {
  const { supabase, userId, tenantId } = await getAuthContext()
  await requirePermission('reports.delete')
  const { data: report } = await (supabase as any).from('reports').select('name').eq('id', id).eq('created_by', userId).single()
  if (!report) throw new Error('Failed to delete report')
  await enqueueDeletionJob(supabase, {
    tenantId,
    createdBy: userId,
    targetType: 'report',
    targetId: id,
    payload: { name: (report as any).name ?? null },
  })
  if (report) {
    await writeAudit({
      supabase, tenantId, actorId: userId,
      objectType: 'report', objectId: id, action: 'delete',
      summary: `Queued deletion for report "${(report as any).name}"`,
    })
  }
  void recordAssetChange({ supabase, tenantId, assetType: 'report', assetId: id, assetName: (report as any).name ?? null, action: 'delete', actorId: userId })
  kickDeletionProcessor()
  revalidatePath('/reports')
}

export async function bulkDeleteReports(ids: string[]) {
  const { supabase, userId, tenantId } = await getAuthContext()
  await requirePermission('reports.delete')

  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
  if (uniqueIds.length === 0) return { queued: 0 }

  const { data: ownedReports, error } = await (supabase as any)
    .from('reports')
    .select('id, name')
    .in('id', uniqueIds)
    .eq('created_by', userId)

  if (error) throw new Error('Failed to queue report deletions')

  const reports = (ownedReports ?? []) as { id: string; name: string | null }[]
  for (const report of reports) {
    await enqueueDeletionJob(supabase, {
      tenantId,
      createdBy: userId,
      targetType: 'report',
      targetId: report.id,
      payload: { name: report.name ?? null },
    })
    await writeAudit({
      supabase,
      tenantId,
      actorId: userId,
      objectType: 'report',
      objectId: report.id,
      action: 'delete',
      summary: `Queued deletion for report "${report.name ?? report.id}"`,
    })
    void recordAssetChange({ supabase, tenantId, assetType: 'report', assetId: report.id, assetName: report.name ?? null, action: 'delete', actorId: userId })
  }

  kickDeletionProcessor()
  revalidatePath('/reports')
  return { queued: reports.length }
}

export async function duplicateReport(id: string) {
  const { supabase, userId, tenantId } = await getAuthContext()
  await requirePermission('reports.create')

  const original = await getReport(id)

  const { data, error } = await (supabase as any)
    .from('reports')
    .insert({
      tenant_id: tenantId,
      created_by: userId,
      name: `${original.name} (Copy)`,
      description: original.description,
      config: normalizeReportConfig(original.config),
      category: original.category,
      is_shared: false,
    })
    .select('id')
    .single()

  if (error) throw new Error('Failed to duplicate report')
  void recordAssetChange({ supabase, tenantId, assetType: 'report', assetId: (data as any).id, assetName: `${original.name} (Copy)`, action: 'save', actorId: userId })
  revalidatePath('/reports')
  return data
}

export async function toggleFavorite(id: string) {
  const { supabase, userId } = await getAuthContext()
  const { data: current } = await (supabase as any)
    .from('reports')
    .select('is_favorite')
    .eq('id', id)
    .eq('created_by', userId)
    .single()
  if (!current) return
  await (supabase as any)
    .from('reports')
    .update({ is_favorite: !current.is_favorite })
    .eq('id', id)
    .eq('created_by', userId)
  revalidatePath('/reports')
}

export async function toggleShare(id: string) {
  const { supabase, userId } = await getAuthContext()
  const { data: current } = await (supabase as any)
    .from('reports')
    .select('is_shared')
    .eq('id', id)
    .eq('created_by', userId)
    .single()
  if (!current) return
  await (supabase as any)
    .from('reports')
    .update({ is_shared: !current.is_shared })
    .eq('id', id)
    .eq('created_by', userId)
  revalidatePath('/reports')
}
