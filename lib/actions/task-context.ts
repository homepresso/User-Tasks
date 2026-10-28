import { getSessionDb } from '@/lib/providers/db/session'
import { fromSession, ServiceError, type ServiceContext } from '@/lib/services/context'

/**
 * Session context for acting on one task: the task's own workspace, which
 * may differ from the current one when it was opened from the unified view
 * ("All organizations"). The browser writes these actions replace were
 * allowed in any workspace the user belongs to (rls_member_tenant_ids);
 * fromSession({ tenantId }) checks that membership and loads the user's
 * permissions there. Not a server action itself.
 */
export async function fromSessionForTask(taskId: string): Promise<ServiceContext> {
  if (typeof taskId !== 'string' || !taskId) throw ServiceError.validation('taskId is required')
  const db = await getSessionDb()
  const { data, error } = await db.from('tasks').select('tenant_id').eq('id', taskId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.tenant_id) throw ServiceError.notFound('Task not found')
  return fromSession({ tenantId: String(data.tenant_id) })
}
