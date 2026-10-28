import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err, parsePagination } from '@/lib/api-auth'
import { normalizeReportConfig } from '@/lib/report-config'

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'reports.view')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth

  const params = request.nextUrl.searchParams
  const { limit, offset } = parsePagination(params)
  const shared = params.get('shared')
  const category = params.get('category')

  let query = (supabase as any)
    .from('reports')
    .select('id, name, description, category, is_shared, config, created_at, updated_at', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })

  if (shared === 'true') query = query.eq('is_shared', true)
  if (shared === 'false') query = query.or('is_shared.is.null,is_shared.eq.false')
  if (category) query = query.eq('category', category)
  if (offset > 0) query = query.range(offset, offset + (limit ?? 1000) - 1)
  else if (limit) query = query.limit(limit)

  const { data, count, error } = await query
  if (error) return err(error.message, 500)

  return ok({ reports: data ?? [], total: count ?? 0 })
}

export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'reports.create')
  if (forbidden) return forbidden
  const { tenantId, supabase, actingUserId } = auth

  const body = await request.json()
  const name = String(body.name ?? '').trim()
  if (!name) return err('name is required')

  const config = normalizeReportConfig(body.config ?? {})

  const { data, error } = await (supabase as any)
    .from('reports')
    .insert({
      tenant_id: tenantId,
      created_by: actingUserId ?? null,
      name,
      description: String(body.description ?? '').trim() || null,
      category: String(body.category ?? '').trim() || null,
      is_shared: body.is_shared === true,
      config,
    })
    .select('*')
    .single()

  if (error) return err(error.message, 500)
  return ok({ report: data }, 201)
}
