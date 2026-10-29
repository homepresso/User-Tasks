import { fromSession, ServiceError, type ServiceContext } from './context'
import type { UploadContext } from './form-files'

/**
 * The signed-in caller and upload context of an upload request (the upload,
 * init and complete routes): a task acts in the task's own workspace (the
 * unified view spans several; RLS shows only tasks the user can see), a form
 * page or test run in the current workspace.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function uploadSession(ids: { task_id?: string; form_id?: string; workflow_id?: string; start_workflow_id?: string }): Promise<{ ctx: ServiceContext; context: UploadContext }> {
  if (ids.task_id) {
    if (!UUID_RE.test(ids.task_id)) throw ServiceError.notFound('Task not found')
    const session = await fromSession()
    const { data: task } = await session.supabase.from('tasks').select('tenant_id').eq('id', ids.task_id).maybeSingle()
    if (!task) throw ServiceError.notFound('Task not found')
    return { ctx: await fromSession({ tenantId: String((task as { tenant_id: string }).tenant_id) }), context: { kind: 'task', taskId: ids.task_id } }
  }
  if (ids.form_id) return { ctx: await fromSession(), context: { kind: 'form', formId: ids.form_id } }
  if (ids.start_workflow_id) return { ctx: await fromSession(), context: { kind: 'start', workflowId: ids.start_workflow_id } }
  if (ids.workflow_id) return { ctx: await fromSession(), context: { kind: 'test', workflowId: ids.workflow_id } }
  throw ServiceError.validation('task_id, form_id, start_workflow_id or workflow_id is required')
}
