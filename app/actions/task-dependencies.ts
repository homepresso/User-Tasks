'use server'

import { createClient, getCachedUser } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/permissions-server'
import { writeLifecycleEvent } from '@/lib/lifecycle-events'
import { revalidatePath } from 'next/cache'

/**
 * Add a blocking link: `taskId` is blocked by `dependsOnTaskId`. Cycle
 * detection runs inside the add_task_dependency RPC under an advisory lock
 * (20260803_task_dependencies.sql); a cycle surfaces as 'dependency_cycle'.
 */
export async function addTaskDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
  await requirePermission('tasks.assign')
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await (supabase as any).rpc('add_task_dependency', {
    p_task: taskId,
    p_depends_on: dependsOnTaskId,
  })
  if (error) {
    if (String(error.message ?? '').includes('dependency_cycle')) {
      throw new Error('That link would create a circular dependency.')
    }
    if (String(error.message ?? '').includes('task_not_found')) {
      throw new Error('Task not found.')
    }
    throw new Error(error.message ?? 'Failed to add dependency')
  }

  const { data: profile } = await supabase
    .from('users')
    .select('current_tenant_id, tenant_id')
    .eq('id', user.id)
    .single()
  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id
  if (tenantId) {
    await writeLifecycleEvent({
      supabase, tenantId, taskId, eventType: 'blocked', actorId: user.id,
      metadata: { depends_on_task_id: dependsOnTaskId },
    })
  }
  revalidatePath(`/tasks/${taskId}`)
}

export async function removeTaskDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
  await requirePermission('tasks.assign')
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await (supabase as any)
    .from('task_dependencies')
    .delete()
    .eq('task_id', taskId)
    .eq('depends_on_task_id', dependsOnTaskId)
  if (error) throw new Error(error.message ?? 'Failed to remove dependency')

  const { data: profile } = await supabase
    .from('users')
    .select('current_tenant_id, tenant_id')
    .eq('id', user.id)
    .single()
  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id
  if (tenantId) {
    await writeLifecycleEvent({
      supabase, tenantId, taskId, eventType: 'unblocked', actorId: user.id,
      metadata: { depends_on_task_id: dependsOnTaskId },
    })
  }
  revalidatePath(`/tasks/${taskId}`)
}
