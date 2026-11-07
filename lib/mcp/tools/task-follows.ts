import type { McpContext, McpToolServer } from '../server'
import { mcpErr, mcpOk } from '../server'
import { z } from 'zod'
import { fromMcpContext } from '@/lib/services/context'
import { MCP_CORE_TOOL_DESCRIPTIONS } from '../descriptions'
import { messageOf } from './_util'

/*
 * Task tracker → Following for agents (lib/services/task-follows.ts): follow,
 * unfollow and list the acting person's followed tasks. Personal: they need
 * a key bound to a user. Registered with the task tools.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

export function registerTaskFollowTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)
  const load = () => import('@/lib/services/task-follows')

  server.tool('tasks_follow', MCP_CORE_TOOL_DESCRIPTIONS.tasks_follow, {
    task_id: z.string().describe('Task ID'),
  }, async (args) => run(async () => (await load()).setTaskFollowed(svc(), args.task_id, true)))

  server.tool('tasks_unfollow', 'Stop following a task (removes it from the acting person\'s Task tracker → Following tab). Idempotent.', {
    task_id: z.string().describe('Task ID'),
  }, async (args) => run(async () => (await load()).setTaskFollowed(svc(), args.task_id, false)))

  server.tool('tasks_following', MCP_CORE_TOOL_DESCRIPTIONS.tasks_following, {
    search: z.string().optional().describe('Task name, ID, workflow, people, team, status or priority contains'),
    status: z.array(z.string()).optional().describe('Task statuses (todo, in_progress, blocked, completed, cancelled)'),
    priority: z.array(z.string()).optional().describe('Priorities (critical, high, medium, low)'),
    hide_completed: z.boolean().optional().describe('true: leave out completed and cancelled tasks'),
    limit: z.number().optional().describe('Page size (1-100, default 25)'),
    offset: z.number().optional(),
  }, async (args) => run(async () => (await load()).pageFollowedTasks(svc(), {
    search: args.search, status: args.status, priority: args.priority, hideCompleted: args.hide_completed,
  }, { limit: Math.max(1, Math.min(args.limit ?? 25, 100)), offset: Math.max(0, args.offset ?? 0) })))
}
