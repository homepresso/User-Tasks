/**
 * Saved reports: portable export / import. Shared by
 * GET /api/v1/reports/{id}/export, POST /api/v1/reports/import and the MCP
 * reports_export / reports_import tools. Imports always create a new report
 * (config normalised as on create).
 */

import { normalizeReportConfig } from '@/lib/report-config'
import { scopeReportRead, scopeReportWrite } from '@/lib/reports-access'
import { manifestTags } from '@/lib/tags/normalize'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError, syncChange } from './_shared'
import { isMissingTagsColumn, tagsNotApplied, validTags } from './tags-column'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped reports table (jsonb config) */

export const REPORT_EXPORT_VERSION = 1

export interface ReportExport {
  version: number
  asset_type: 'report'
  report: { name: string; description: string | null; category: string | null; is_shared: boolean; config: unknown; tags?: string[] }
}

export async function exportReport(ctx: ServiceContext, reportId: string): Promise<ReportExport> {
  requirePerm(ctx, 'reports.view')
  const { data, error } = await scopeReportRead((ctx.supabase as any).from('reports')
    .select('*').eq('id', reportId).eq('tenant_id', ctx.tenantId), ctx.actorId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Report not found')
  await audit(ctx, { objectType: 'report', objectId: reportId, action: 'export', summary: `Exported report "${data.name}"` })
  return {
    version: REPORT_EXPORT_VERSION,
    asset_type: 'report',
    report: {
      name: data.name,
      description: data.description ?? null,
      category: data.category ?? null,
      is_shared: data.is_shared ?? false,
      config: data.config,
      ...(Array.isArray(data.tags) && data.tags.length ? { tags: data.tags.map(String) } : {}),
    },
  }
}

/** Create a report from an export document (`{ report: {...} }`) or the bare report object. */
export async function importReport(ctx: ServiceContext, input: { payload: unknown; name_override?: string }) {
  requirePerm(ctx, 'reports.create')
  const raw = input.payload as any
  const payload = raw?.report ?? raw
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw ServiceError.validation('Import must contain a report object')
  const name = String(input.name_override ?? payload.name ?? '').trim()
  if (!name || !payload.config || typeof payload.config !== 'object') throw ServiceError.validation('Imported report must include name and config')

  const { data, error } = await (ctx.supabase as any).from('reports').insert({
    tenant_id: ctx.tenantId,
    created_by: ctx.actorId,
    name,
    description: typeof payload.description === 'string' ? payload.description.trim() || null : null,
    category: typeof payload.category === 'string' ? payload.category.trim() || null : null,
    is_shared: payload.is_shared === true,
    config: normalizeReportConfig(payload.config),
    ...(manifestTags(payload.tags).length ? { tags: manifestTags(payload.tags) } : {}),
  }).select('*').single()
  if (error || !data) throw dbError(error, 'Failed to import report')
  await audit(ctx, { objectType: 'report', objectId: data.id, action: 'create', summary: `Imported report "${data.name}"`, metadata: { kind: 'import' } })
  return data
}

/**
 * Replace a report's tags (the "Tags…" quick action, bulk tags, the
 * Settings → Tags tools). reports.edit_own and — as for every report edit —
 * only the report's creator (RLS for the app; scopeReportWrite for API keys
 * and MCP). Tags are list metadata: the config is untouched. Audited and
 * queued for GitHub sync.
 */
export async function setReportTags(ctx: ServiceContext, reportId: string, tags: unknown) {
  requirePerm(ctx, 'reports.edit_own')
  const next = validTags(tags)
  const { data, error } = await scopeReportWrite((ctx.supabase as any).from('reports')
    .update({ tags: next, updated_at: new Date().toISOString() })
    .eq('id', reportId).eq('tenant_id', ctx.tenantId), ctx.actorId)
    .select('id, name, tags')
  if (error) throw isMissingTagsColumn(error) ? tagsNotApplied('reports') : dbError(error, 'Failed to update the report')
  const row = (data ?? [])[0]
  if (!row) throw ServiceError.forbidden("Only the report's creator can change its tags")
  await audit(ctx, { objectType: 'report', objectId: reportId, action: 'update', summary: `Tags of report "${row.name}" set to ${next.join(', ') || '(none)'}`, diff: { tags: { before: null, after: next } } })
  await syncChange(ctx, 'report', row)
  return row as { id: string; name: string; tags: string[] }
}
