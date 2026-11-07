import { NextRequest } from 'next/server'
import { prepareRoundTripBody } from '@/lib/api-schemas/registry'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import { normalizeReportConfig } from '@/lib/report-config'
import { reportShareDenied, scopeReportRead, scopeReportWrite } from '@/lib/reports-access'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'reports.view')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth
  const { id } = await params

  const { data, error } = await scopeReportRead((supabase as any)
    .from('reports')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId), auth.actingUserId)
    .single()

  if (error || !data) return err('Report not found', 404)
  return ok({ report: data })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'reports.edit_own')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth
  const { id } = await params

  // The GET response (`{ report: {...} }`) is accepted as the body too.
  const body = prepareRoundTripBody(undefined, { unwrap: 'report' }, await request.json()) as Record<string, any>
  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) updates.name = String(body.name ?? '').trim()
  if (body.description !== undefined) updates.description = String(body.description ?? '').trim() || null
  if (body.category !== undefined) updates.category = String(body.category ?? '').trim() || null
  if (body.is_shared !== undefined) updates.is_shared = body.is_shared === true
  if (body.config !== undefined) updates.config = normalizeReportConfig(body.config ?? {})
  const shareDenied = reportShareDenied(updates, auth.permissions)
  if (shareDenied) return err(shareDenied, 403)

  const { data, error } = await scopeReportWrite((supabase as any)
    .from('reports')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', tenantId), auth.actingUserId)
    .select('*')
    .single()

  if (error || !data) return err(error?.message ?? 'Report not found', error ? 500 : 404)
  return ok({ report: data })
}

/** PATCH is the same partial update as PUT. */
export const PATCH = PUT

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'reports.delete')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth
  const { id } = await params

  const { data: deleted, error } = await scopeReportWrite((supabase as any)
    .from('reports')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId), auth.actingUserId)
    .select('id')

  if (error) return err(error.message, 500)
  if (!deleted?.length) return err('Report not found', 404)
  return ok({ deleted: true, report_id: id })
}
