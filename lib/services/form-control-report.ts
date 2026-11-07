/**
 * The `report` host service of custom form controls (capability `reports`):
 * the rows of the saved report a designer chose for a control on a form —
 * the Saved report control, or a Chart fed by a report.
 *
 * Security model (mirrors lookups, lib/services/form-lookup.ts):
 *  - The report id comes from the STORED form — the task's form (metadata
 *    fields), or the reusable form's fields — never from the request or the
 *    control: a control can only ever run the report its field names
 *    (`custom.props.report_id`), and only when the control's manifest
 *    declared `reports`.
 *  - It runs as the person filling in the form: reports.view, the report must
 *    be visible to them (their own, or shared — the reports_select RLS rule),
 *    queried with their own RLS client and permissions, so the rows are what
 *    they could see on the Reports page anyway.
 *  - Task forms: the task must be one they can act on (loadLookupTask);
 *    form pages: forms.submit. The designer preview (unsaved field) needs
 *    forms.edit or workflows.edit.
 *  - Rate limited per user; rows capped (default 200, at most 1000).
 */

import { controlReportId, normalizeCustomControlConfig } from '@/lib/forms/custom-controls/field'
import type { ReportResult } from '@/lib/forms/custom-controls/contract'
import { normalizeTaskFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'
import { getDb, hasPerm, rateSubject, requirePerm, ServiceError, type ServiceContext } from './context'
import { serviceRoleClient } from './_shared'
import { loadLookupTask } from './form-lookup'

/* eslint-disable @typescript-eslint/no-explicit-any -- report rows and configs are free-form JSON */

export const CONTROL_REPORT_RATE = { max: 60, windowMs: 60_000 } as const
export const CONTROL_REPORT_LIMITS = { defaultRows: 200, maxRows: 1000 } as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ControlReportInput {
  task_id?: string
  form_id?: string
  field_key?: string
  /** Designer preview only: the unsaved field definition. */
  field?: unknown
  limit?: number
}

/** The report id of a stored field that may run a report (null: it may not). */
export function reportIdOfField(field: TaskFieldDef | undefined): string | null {
  if (!field || field.type !== 'custom') return null
  return controlReportId(normalizeCustomControlConfig(field.custom))
}

function rowLimit(limit: unknown): number {
  const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.round(limit) : CONTROL_REPORT_LIMITS.defaultRows
  return Math.min(CONTROL_REPORT_LIMITS.maxRows, Math.max(1, n))
}

async function rateLimited(ctx: ServiceContext) {
  const { rateLimit } = await import('@/lib/rate-limit')
  const who = rateSubject(ctx)
  const hit = await rateLimit(`control-report:${ctx.tenantId}:${who}`, CONTROL_REPORT_RATE)
  if (!hit.ok) throw new ServiceError('rate_limited', 'Too many report requests — wait a moment and try again', { details: { retry_after_ms: hit.retryAfterMs } })
}

/** Find the field the request names, from the stored form (or the designer's unsaved field). */
async function resolveField(ctx: ServiceContext, input: ControlReportInput): Promise<TaskFieldDef | undefined> {
  const key = String(input.field_key ?? '')
  if (input.task_id) {
    const db = await serviceRoleClient(ctx)
    const task = await loadLookupTask(ctx, db, input.task_id)
    const meta = isPlainObject(task.metadata) ? task.metadata : {}
    return normalizeTaskFields((meta as any).fields).find((f) => f.key === key)
  }
  if (input.form_id) {
    requirePerm(ctx, 'forms.submit')
    if (!UUID_RE.test(input.form_id)) throw ServiceError.notFound('Form not found')
    const db = await serviceRoleClient(ctx)
    const { data: form } = await (db as any).from('forms').select('id, fields').eq('id', input.form_id).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (!form) throw ServiceError.notFound('Form not found')
    return normalizeTaskFields(form.fields).find((f) => f.key === key)
  }
  if (input.field !== undefined) {
    if (!hasPerm(ctx, 'workflows.edit') && !hasPerm(ctx, 'forms.edit')) {
      throw ServiceError.forbidden("Forbidden: previewing a report control needs the 'workflows.edit' or 'forms.edit' permission")
    }
    return normalizeTaskFields([input.field])[0]
  }
  throw ServiceError.validation('task_id, form_id or field is required')
}

/** Run the saved report of a `reports` control for the signed-in person. */
export async function runControlReport(ctx: ServiceContext, input: ControlReportInput): Promise<ReportResult> {
  requirePerm(ctx, 'reports.view')
  if (!ctx.actorId) throw ServiceError.forbidden('Sign in to see this report')
  const field = await resolveField(ctx, input)
  const reportId = reportIdOfField(field)
  if (!reportId) throw ServiceError.notFound('This field has no report to show')
  await rateLimited(ctx)
  // The person's own client: RLS and the own-or-shared rule decide what they see.
  const db = getDb(ctx) as any
  const { data: report } = await db.from('reports')
    .select('id, name, description, config, is_shared, created_by')
    .eq('id', reportId)
    .or(`created_by.eq.${ctx.actorId},is_shared.eq.true`)
    .maybeSingle()
  if (!report) throw ServiceError.notFound('The report is not shared with you, or no longer exists')
  const { executeReportPreview } = await import('@/lib/mcp/tools/reports')
  const { normalizeReportConfig } = await import('@/lib/report-config')
  const config = normalizeReportConfig(report.config ?? {})
  let preview: { data: any[]; total: number; available_columns?: Array<{ key: string; label?: string; type?: string }> }
  try {
    preview = await executeReportPreview(db, ctx.tenantId, config, undefined, ctx.permissions ? [...ctx.permissions] : null) as any
  } catch (error) {
    throw ServiceError.validation(`The report could not run: ${String((error as Error)?.message ?? 'error').slice(0, 200)}`)
  }
  const limit = rowLimit(input.limit)
  const rows = Array.isArray(preview.data) ? preview.data : []
  const available = new Map((preview.available_columns ?? []).map((c) => [String(c.key), c]))
  const wanted = (Array.isArray(config.columns) && config.columns.length ? config.columns.map(String) : Object.keys(rows[0] ?? {}))
    .filter((key) => key && !key.startsWith('_')).slice(0, 50)
  const keys = new Set(wanted)
  for (const row of rows.slice(0, 1)) for (const key of Object.keys(row ?? {})) if (!keys.has(key) && !key.startsWith('_') && (config as any).group_by?.length) keys.add(key)
  const columns = [...keys].map((key) => ({ key, label: String(available.get(key)?.label ?? key), type: String(available.get(key)?.type ?? 'string') }))
  const out = rows.slice(0, limit).map((row: any) => Object.fromEntries(columns.map((c) => [c.key, row?.[c.key] ?? null])))
  return {
    report: { id: String(report.id), name: String(report.name ?? 'Report'), description: report.description ?? null, visualization: typeof config.visualization === 'string' ? config.visualization : null },
    columns,
    rows: out,
    total: typeof preview.total === 'number' ? preview.total : rows.length,
    truncated: rows.length > limit || (typeof preview.total === 'number' && preview.total > out.length),
  }
}
