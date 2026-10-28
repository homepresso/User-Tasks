import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err, parsePagination } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'agents.view')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth

  const { limit, offset } = parsePagination(request.nextUrl.searchParams)
  const status = request.nextUrl.searchParams.get('status')
  const agentId = request.nextUrl.searchParams.get('agent_id')

  let q = (supabase as any).from('agent_queue')
    .select('id, agent_id, status, input_message, priority, attempts, error, result, run_id, created_at, started_at, completed_at', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (status) q = q.eq('status', status)
  if (agentId) q = q.eq('agent_id', agentId)
  if (limit) q = q.limit(limit)
  if (offset) q = q.range(offset, offset + (limit ?? 50) - 1)

  const { data, count, error } = await q
  if (error) return err(error.message, 500)
  return ok({ jobs: data ?? [], total: count ?? 0 })
}
