import type { McpContext, McpToolServer } from '../server'
import { mcpErr, mcpOk } from '../server'
import { z } from 'zod'
import { fromMcpContext } from '@/lib/services/context'
import { MCP_CORE_TOOL_DESCRIPTIONS } from '../descriptions'
import { messageOf } from './_util'
import {
  SUBTASK_DESCRIPTION_MAX, SUBTASK_EFFORT_MAX_MINUTES, SUBTASK_SUBTITLE_MAX, SUBTASK_TAG_MAX, SUBTASK_TAGS_MAX, SUBTASK_TITLE_MAX,
} from '@/lib/tasks/subtask-input'

/*
 * Subtasks for agents (lib/services/tasks addSubtask / updateSubtask /
 * listSubtasks) — the same rules as the task page and REST
 * /tasks/{id}/subtasks. Registered with the task tools.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const fields = {
  subtitle: z.string().max(SUBTASK_SUBTITLE_MAX).nullable().optional().describe('Short summary shown under the title'),
  description: z.string().max(SUBTASK_DESCRIPTION_MAX).nullable().optional().describe('Plain text or HTML (sanitised)'),
  estimated_effort_minutes: z.number().int().min(0).max(SUBTASK_EFFORT_MAX_MINUTES).nullable().optional().describe('Estimate in whole minutes (90 = 1.5h); 0 / null = none'),
  due_date: z.string().nullable().optional().describe('Due date (ISO 8601)'),
  priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).optional().describe('Default: the parent task\'s priority'),
  tags: z.array(z.string().max(SUBTASK_TAG_MAX)).max(SUBTASK_TAGS_MAX).nullable().optional(),
}

export function registerTaskSubtaskTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)
  const load = () => import('@/lib/services/tasks')

  server.tool('tasks_subtasks_list', 'A task\'s direct subtasks in order (title, subtitle, description, status, priority, due date, tags, estimate and logged effort in minutes, their own subtask counts), with total / completed and can_add (whether the acting person may add subtasks here).', {
    task_id: z.string().describe('Parent task ID'),
  }, async (args) => run(async () => (await load()).listSubtasks(svc(), args.task_id)))

  server.tool('tasks_add_subtask', MCP_CORE_TOOL_DESCRIPTIONS.tasks_add_subtask, {
    task_id: z.string().describe('Parent task ID'),
    title: z.string().min(1).max(SUBTASK_TITLE_MAX).describe('Subtask title'),
    ...fields,
  }, async ({ task_id, ...input }) => run(async () => ({ created: true, subtask: await (await load()).addSubtask(svc(), task_id, input) })))

  server.tool('tasks_update_subtask', 'Edit a subtask\'s title, subtitle, description, estimate (minutes), due date, priority or tags — only the fields given change. Same people as tasks_add_subtask. Tick / complete it with tasks_update (status) or tasks_complete.', {
    task_id: z.string().describe('Parent task ID'),
    subtask_id: z.string().describe('Subtask ID'),
    title: z.string().min(1).max(SUBTASK_TITLE_MAX).optional(),
    ...fields,
  }, async ({ task_id, subtask_id, ...input }) => run(async () => ({ updated: true, subtask: await (await load()).updateSubtask(svc(), subtask_id, input, { parentTaskId: task_id }) })))
}
