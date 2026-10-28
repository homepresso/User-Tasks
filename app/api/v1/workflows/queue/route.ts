import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err, parsePagination } from '@/lib/api-auth'
import { canAccessWorkflow, hasWorkflowScope } from '@/lib/api-key-permissions'

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'workflows.view_runs')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth

  const params = request.nextUrl.searchParams
  const { limit, offset } = parsePagination(params)
  const workflowId = params.get('workflow_id')
  const statuses = params.get('status')?.split(',').map(s => s.trim()).filter(Boolean)

  let query = supabase
    .from('workflow_queue')
    .select('*', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (workflowId) {
    if (!canAccessWorkflow(auth, workflowId)) return err('This API key is not allowed to access that workflow', 403)
    query = query.eq('workflow_id', workflowId)
  } else if (hasWorkflowScope(auth)) {
    query = query.in('workflow_id', auth.scopes.workflow_ids)
  }
  if (statuses?.length) query = query.in('status', statuses)
  if (offset > 0) query = query.range(offset, offset + (limit ?? 1000) - 1)
  else if (limit) query = query.limit(limit)

  const { data, count, error } = await query
  if (error) return err(error.message, 500)

  return ok({ jobs: data ?? [], total: count ?? 0 })
}
