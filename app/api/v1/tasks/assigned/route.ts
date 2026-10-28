import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err, parsePagination } from '@/lib/api-auth'
import { getAccessibleTaskIdsForUser } from '@/lib/api-key-permissions'
import { wantsStrippedHtml, withDescriptionTexts } from '@/lib/task-description-format'

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'tasks.view_all')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth

  const params = request.nextUrl.searchParams
  const { limit, offset } = parsePagination(params)
  const assigneeId = params.get('assignee_id')
  const teamId = params.get('team_id')
  const status = params.get('status')?.split(',').map(s => s.trim()).filter(Boolean) ?? ['todo', 'in_progress']
  const acceptanceStatus = params.get('acceptance_status')?.split(',').map(s => s.trim()).filter(Boolean)

  let query = supabase
    .from('tasks')
    .select('id, title, description, status, priority, assignee_id, assigned_team_id, acceptance_status, due_date, outcome, available_outcomes, event_id, created_at, updated_at, allow_reassign, allow_escalate, allow_delegate, metadata', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .eq('is_workflow_task', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

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
  if (teamId) query = query.eq('assigned_team_id', teamId)
  if (status.length) query = query.in('status', status)
  if (acceptanceStatus?.length) query = query.in('acceptance_status', acceptanceStatus)
  if (offset > 0) query = query.range(offset, offset + (limit ?? 1000) - 1)
  else if (limit) query = query.limit(limit)

  const { data, count, error } = await query
  if (error) return err(error.message, 500)

  return ok({ tasks: withDescriptionTexts(data, wantsStrippedHtml(params.get('strip_html'))), total: count ?? 0 })
}
