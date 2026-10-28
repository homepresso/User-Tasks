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
  const versionId = params.get('version_id')
  const statuses = params.get('status')?.split(',').map(s => s.trim()).filter(Boolean)

  let query = supabase
    .from('workflow_runs')
    .select('id, workflow_id, version_id, migrated_from_run_id, migrated_to_run_id, status, title, started_at, completed_at, error, task_id, event_id, paused_node_id, sla_label, sla_due_at, sla_warning_at, sla_status, sla_warning_triggered_at, sla_breached_triggered_at', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('started_at', { ascending: false })

  if (workflowId) {
    if (!canAccessWorkflow(auth, workflowId)) return err('This API key is not allowed to access that workflow', 403)
    query = query.eq('workflow_id', workflowId)
  } else if (hasWorkflowScope(auth)) {
    query = query.in('workflow_id', auth.scopes.workflow_ids)
  }
  if (versionId) query = query.eq('version_id', versionId)
  if (statuses?.length) query = query.in('status', statuses)
  if (offset > 0) query = query.range(offset, offset + (limit ?? 1000) - 1)
  else if (limit) query = query.limit(limit)

  const { data, count, error } = await query
  if (error) return err(error.message, 500)

  return ok({ runs: data ?? [], total: count ?? 0 })
}
