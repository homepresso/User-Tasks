import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err, parsePagination } from '@/lib/api-auth'
import { getAccessibleTaskIdsForUser } from '@/lib/api-key-permissions'
import { wantsStrippedHtml, withDescriptionTexts } from '@/lib/task-description-format'
import { fromApiAuth, isServiceError } from '@/lib/services/context'
import type { ApiKeySuccessResult } from '@/lib/api-auth'

async function listReportsScope(auth: ApiKeySuccessResult, params: URLSearchParams) {
  if (!auth.permissions.includes('tasks.view_own') && !auth.permissions.includes('tasks.view_all')) {
    return err("Forbidden: this credential lacks the 'tasks.view_own' permission", 403)
  }
  const { listReportTasks } = await import('@/lib/services/manager-tasks')
  const csv = (key: string) => params.get(key)?.split(',').map((v) => v.trim()).filter(Boolean)
  try {
    const result = await listReportTasks(fromApiAuth(auth), {
      indirect: params.get('indirect') === 'true',
      person: params.get('assignee_id'),
      status: csv('status') ?? null,
      priority: csv('priority') ?? null,
      workflow_id: params.get('workflow_id'),
      overdue: params.get('overdue') === 'true',
      sla_breached: params.get('sla_breached') === 'true',
      limit: params.get('limit') ? Number(params.get('limit')) : null,
    })
    return ok({ ...result, total: result.tasks.length })
  } catch (error) {
    if (isServiceError(error)) return err(error.message, error.status)
    throw error
  }
}

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const params = request.nextUrl.searchParams
  // The manager view: open tasks of the caller's reports.
  if (params.get('scope') === 'reports') return listReportsScope(auth, params)
  if (params.get('scope') && params.get('scope') !== 'all') return err('scope must be all or reports')

  const forbidden = requireApiPermission(auth, 'tasks.view_all')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth

  const { limit, offset } = parsePagination(params)
  const status = params.get('status')?.split(',').map(s => s.trim()).filter(Boolean)
  const assigneeId = params.get('assignee_id')
  const isWorkflowTask = params.get('is_workflow_task')
  const priority = params.get('priority')?.split(',').map(s => s.trim()).filter(Boolean)
  const parentTaskId = params.get('parent_task_id')

  let query = supabase
    .from('tasks')
    .select('id, title, description, status, priority, assignee_id, assigned_team_id, acceptance_status, due_date, outcome, is_workflow_task, event_id, created_at, updated_at, completed_at, parent_task_id, tags, allow_reassign, allow_escalate, allow_delegate, metadata', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (status?.length) query = query.in('status', status)
  if (auth.actingUserId && assigneeId && assigneeId !== auth.actingUserId) {
    return err('User-context API keys can only query tasks for their own user context', 403)
  }
  if (assigneeId) query = query.eq('assignee_id', assigneeId)
  else if (auth.actingUserId) {
    const collaborativeTaskIds = await getAccessibleTaskIdsForUser(supabase, tenantId, auth.actingUserId)
    if (collaborativeTaskIds.length > 0) {
      query = query.or(`assignee_id.eq.${auth.actingUserId},id.in.(${collaborativeTaskIds.join(',')})`)
    } else {
      query = query.eq('assignee_id', auth.actingUserId)
    }
  }
  if (isWorkflowTask === 'true') query = query.eq('is_workflow_task', true)
  if (isWorkflowTask === 'false') query = query.eq('is_workflow_task', false)
  if (priority?.length) query = query.in('priority', priority)
  if (parentTaskId) query = query.eq('parent_task_id', parentTaskId)
  if (offset > 0) query = query.range(offset, offset + (limit ?? 1000) - 1)
  else if (limit) query = query.limit(limit)

  const { data, count, error } = await query
  if (error) return err(error.message, 500)

  return ok({ tasks: withDescriptionTexts(data, wantsStrippedHtml(params.get('strip_html'))), total: count ?? 0 })
}
