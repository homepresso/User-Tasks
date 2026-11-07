import { NextResponse } from 'next/server'
import { fromSession, isServiceError, ServiceError, type ServiceContext } from './context'

/**
 * The signed-in caller of a task attachments request from the task screen
 * (app/api/internal/tasks/[id]/attachments/**), acting in the TASK'S
 * workspace: the unified "All organizations" view spans several, and RLS
 * shows only tasks of the user's workspaces.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const NO_STORE = { 'Cache-Control': 'no-store' }

export async function taskAttachmentSession(taskId: string): Promise<ServiceContext> {
  if (!UUID_RE.test(taskId)) throw ServiceError.notFound('Task not found')
  const session = await fromSession()
  const { data: task } = await session.supabase.from('tasks').select('tenant_id').eq('id', taskId).maybeSingle()
  if (!task) throw ServiceError.notFound('Task not found')
  return fromSession({ tenantId: String((task as { tenant_id: string }).tenant_id) })
}

export function attachmentRouteError(error: unknown, where: string) {
  if (isServiceError(error)) {
    return NextResponse.json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) }, { status: error.status, headers: NO_STORE })
  }
  console.error(`[task-attachments.${where}]`, error)
  return NextResponse.json({ error: 'Something went wrong — try again' }, { status: 500, headers: NO_STORE })
}
