import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err, parsePagination } from '@/lib/api-auth'
import { fromApiAuth, isServiceError } from '@/lib/services/context'
import { createAgent } from '@/lib/services/agents'

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'agents.view')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth

  const { limit, offset } = parsePagination(request.nextUrl.searchParams)
  const activeOnly = request.nextUrl.searchParams.get('active')

  let q = supabase.from('agents' as any).select('id, name, description, model, integration_id, is_active, tools, role, task, boundaries, output_config, temperature, max_tokens, max_iterations, version, created_at, updated_at', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })

  if (activeOnly === 'true') q = q.eq('is_active', true)
  if (limit) q = q.limit(limit)
  if (offset) q = q.range(offset, offset + (limit ?? 50) - 1)

  const { data, count, error } = await q
  if (error) return err(error.message, 500)
  return ok({ agents: data ?? [], total: count ?? 0 })
}

export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'agents.create')
  if (forbidden) return forbidden
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return err('A JSON body is required')
  if (!body.name) return err('name is required')
  try {
    const agent = await createAgent(fromApiAuth(auth), body)
    return ok({ agent }, 201)
  } catch (error) {
    if (isServiceError(error)) return err(error.message, error.status)
    return err((error as Error)?.message ?? 'Failed to create the agent', 500)
  }
}
