import { z } from 'zod'
import { fromSession, getDb } from '../context'
import { defineRead, id, NO_ARGS } from './define'
import { PROFILE_AREAS } from '@/lib/assistants/profiles'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped task row */

/**
 * The Agent (lib/services/assistants.ts): the admin settings page and the
 * Agent panel's availability (booleans only, for the signed-in person).
 */

export const reads = {
  /** Settings → Agent: provider, model, the Agent switch / access / tool groups, limits, usage. Never the key (only "•••• last4"). */
  'assistants.settings': defineRead({
    args: NO_ARGS,
    perm: 'assistants.manage',
    run: async (ctx) => (await import('../assistants')).getAssistantSettings(ctx),
  }),
  /** Settings → Agent → Profiles, "Who gets what": the profile, model, thinking level, help groups and limits one member gets. */
  'assistants.modelPreview': defineRead({
    args: z.object({ userId: id }),
    perm: 'assistants.manage',
    run: async (ctx, args) => (await import('../assistants')).previewPersonModel(ctx, args.userId),
  }),
  /**
   * Whether the signed-in person may use the Agent here, and which help:
   * { agent, form_read, form, task, designer } booleans + an opaque
   * history_key (sha-256 of the person + their session workspace).
   * formId / taskId: on a form (its own setting) or a task (its form's
   * setting, in the task's workspace — a task the person can't see gets no
   * task / form help). area: the screen's area for the person's Agent
   * profile (lib/assistants/profiles.ts) — its panel name and starters come
   * back as `profile` (never its instructions).
   */
  'assistants.availability': defineRead({
    args: z.object({ formId: id.optional(), taskId: id.optional(), area: z.enum(PROFILE_AREAS).optional() }).optional(),
    run: async (ctx, args) => {
      const { getAssistantAvailability, agentHistoryKey } = await import('../assistants')
      // One conversation per person and session workspace, whatever screen (or task's workspace) is open.
      const history_key = ctx.actorId ? agentHistoryKey(ctx.actorId, ctx.tenantId) : null
      if (args?.taskId) {
        const base = await getAssistantAvailability(ctx, { area: 'tasks' })
        const { data: task } = await (getDb(ctx) as any).from('tasks').select('tenant_id').eq('id', args.taskId).maybeSingle()
        if (!task?.tenant_id) return { ...base, task: false, form: false, form_read: false, history_key }
        const taskCtx = String(task.tenant_id) === ctx.tenantId ? ctx : await fromSession({ tenantId: String(task.tenant_id) })
        const onTask = taskCtx === ctx ? await getAssistantAvailability(ctx, { taskId: args.taskId }) : await getAssistantAvailability(taskCtx, { taskId: args.taskId })
        // The button follows the session workspace; task / form help the task's workspace.
        return { ...onTask, agent: base.agent || onTask.agent, designer: base.designer, history_key }
      }
      return { ...(await getAssistantAvailability(ctx, { formId: args?.formId ?? null, area: args?.area ?? null })), history_key }
    },
  }),
}
