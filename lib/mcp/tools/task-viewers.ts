import type { McpContext, McpToolServer } from '../server'
import { mcpErr, mcpOk } from '../server'
import { z } from 'zod'
import { fromMcpContext } from '@/lib/services/context'
import { messageOf } from './_util'

/*
 * Invite (read only) for agents (lib/services/task-viewers.ts): who a task
 * is shared with, invite people / teams / roles, remove an invite. Registered
 * with the task tools.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const MANAGERS = 'Only the assignee / collaborators / members of the assigned team, the assigner, a manager of an assignee, a manager of the workflow or tasks.complete_any may invite or remove.'

export function registerTaskViewerTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)
  const load = () => import('@/lib/services/task-viewers')

  server.tool('tasks_viewers_list', 'Who a task is shared with, read only (invites: people, teams, roles — name, member_count, include_subtasks, note, invited_by) and can_manage for the caller. Anyone who can see the task.', {
    task_id: z.string().describe('The task'),
  }, async (args) => run(async () => (await load()).listTaskViewers(svc(), args.task_id)))

  server.tool('tasks_viewers_add', `Invite people, teams or roles to view a task, read only: they can open it (and its subtasks unless include_subtasks is false), its comments, attachments, history and process view, and comment — never complete it, fill in its form, add subtasks or reassign it. It shows in their Task tracker → Following. People invited directly are notified (and emailed); members of a team / role of at most 25 people are notified. ${MANAGERS}`, {
    task_id: z.string().describe('The task'),
    viewers: z.array(z.object({
      type: z.enum(['user', 'team', 'role']).describe('A person, a team or a role'),
      id: z.string().describe('User, team or role id'),
    })).describe('Who to invite (at most 50)'),
    note: z.string().optional().describe('A note for them'),
    include_subtasks: z.boolean().optional().describe('Also its subtasks (default true)'),
  }, async (args) => run(async () => (await load()).addTaskViewers(svc(), args.task_id, {
    principals: args.viewers, note: args.note ?? null, include_subtasks: args.include_subtasks, via: 'mcp',
  })))

  server.tool('tasks_viewers_remove', `Stop sharing a task with a person, team or role: give viewer_id (from tasks_viewers_list), or type and id. Its people lose access unless something else lets them see the task. ${MANAGERS}`, {
    task_id: z.string().describe('The task'),
    viewer_id: z.string().optional().describe('Invite id (tasks_viewers_list)'),
    type: z.enum(['user', 'team', 'role']).optional().describe('Instead of viewer_id: the invitee\'s type'),
    id: z.string().optional().describe('Instead of viewer_id: the user, team or role id'),
  }, async (args) => run(async () => {
    const viewers = await load()
    if (args.viewer_id) return viewers.removeTaskViewer(svc(), args.task_id, args.viewer_id, { via: 'mcp' })
    if (!args.type || !args.id) throw new Error('Give viewer_id, or type and id')
    return viewers.removeTaskViewerByPrincipal(svc(), args.task_id, { type: args.type, id: args.id }, { via: 'mcp' })
  }))
}
