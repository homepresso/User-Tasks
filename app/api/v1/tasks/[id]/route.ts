import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import { canAccessTaskAsUser } from '@/lib/api-key-permissions'
import { apiRoute } from '@/lib/api/route'
import { updateTaskEndpoint } from '@/lib/api-schemas/tasks'
import { updateTask } from '@/lib/services/tasks'
import { wantsStrippedHtml, withDescriptionText } from '@/lib/task-description-format'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'tasks.view_all')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth
  const { id } = await params

  if (auth.actingUserId && !(await canAccessTaskAsUser(supabase, tenantId, auth.actingUserId, id))) {
    return err('This user-context API key cannot access that task', 403)
  }

  const { data: task, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .single()

  if (error || !task) return err('Task not found', 404)

  return ok({ task: withDescriptionText(task, wantsStrippedHtml(request.nextUrl.searchParams.get('strip_html'))) })
}

/** PATCH /api/v1/tasks/:id — allowlisted fields + User Task field values (as the task UI). */
export const PATCH = apiRoute(updateTaskEndpoint, async ({ ctx, params, body }) =>
  ({ task: await updateTask(ctx, params.id, body) }))
