import type { McpContext, McpToolServer } from '../server'
import { mcpErr, mcpOk } from '../server'
import { z } from 'zod'
import { fromMcpContext } from '@/lib/services/context'
import { messageOf } from './_util'

/*
 * Unread tasks for agents (lib/services/task-reads.ts): mark a task read or
 * unread, mark all read, count. tasks_list / tasks_get / tasks_following
 * rows carry `unread`. Personal: they need a key bound to a user.
 * Registered with the task tools.
 */

const RULE = 'A task is unread while it is open, the person holds it (assignee, collaborator or claim candidate, or a member of the assigned team of an unassigned team task) and they have not opened it since it became theirs (assigned, reassigned, claimed, reopened or sent back).'

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

export function registerTaskReadTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)
  const load = () => import('@/lib/services/task-reads')

  server.tool('tasks_mark_read', `Mark a task as read for the acting person (what opening it in the app does). Only a task they can see. Idempotent. ${RULE}`, {
    task_id: z.string().describe('Task ID'),
  }, async (args) => run(async () => (await load()).markTaskRead(svc(), args.task_id)))

  server.tool('tasks_mark_unread', 'Mark a task as unread for the acting person (it shows the unread dot again). Returns the resulting state: a task they don\'t hold, or a closed one, stays read. Idempotent.', {
    task_id: z.string().describe('Task ID'),
  }, async (args) => run(async () => (await load()).markTaskUnread(svc(), args.task_id)))

  server.tool('tasks_mark_all_read', 'Mark every task that is unread for the acting person in this workspace as read. Returns { marked }.', {},
    async () => run(async () => (await load()).markAllTasksRead(svc())))

  server.tool('tasks_unread_count', `How many top-level tasks are unread for the acting person in this workspace (the count next to My tasks). ${RULE}`, {},
    async () => run(async () => (await load()).countUnreadTasks(svc())))
}
