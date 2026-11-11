import { z } from 'zod'
import { getDb, type ServiceContext } from '../context'
import { defineRead, id } from './define'

/**
 * Invite (read only): the Invite dialog's list and the "Shared with N" chip
 * (lib/services/task-viewers.ts has the rules: anyone who can see the task
 * reads its invites; can_manage says whether they may change them).
 */

const TASK_VIEW = ['tasks.view_own', 'tasks.view_all'] as const

/** The task's own workspace (the unified view opens tasks of every member workspace); null when not visible. */
async function inTaskWorkspace(ctx: ServiceContext, taskId: string): Promise<ServiceContext | null> {
  const { data } = await (getDb(ctx) as any).from('tasks').select('tenant_id').eq('id', taskId).is('deleted_at', null).maybeSingle() // eslint-disable-line @typescript-eslint/no-explicit-any -- untyped row
  return data?.tenant_id ? { ...ctx, tenantId: String(data.tenant_id) } : null
}

export const reads = {
  /** The task's invites (people, teams, roles) and whether the signed-in person may manage them. */
  'tasks.viewers': defineRead({
    args: z.object({ taskId: id }),
    perm: TASK_VIEW,
    run: async (ctx, { taskId }) => {
      const scoped = await inTaskWorkspace(ctx, taskId)
      if (!scoped) return null
      const { listTaskViewers } = await import('../task-viewers')
      try {
        return await listTaskViewers(scoped, taskId)
      } catch (error) {
        if ((error as { code?: string })?.code === 'not_found') return null
        throw error
      }
    },
  }),
}
