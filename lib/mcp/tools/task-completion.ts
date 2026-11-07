import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import * as completion from '@/lib/services/task-completion-screen'
import { messageOf } from './_util'

/*
 * The Task completed screen: the workspace's default wording (read by any
 * member; changing it needs settings.edit and is audited in the service)
 * and "what happens next" after a task is actioned. Thin wrappers over
 * lib/services/task-completion-screen.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const PLACEHOLDERS = 'Templates take {{task.title}}, {{outcome}}, {{next.step}}, {{next.assignee}}, {{user.name}} and {{process.name}}; one that renders empty uses the built-in default. A task form can override these in its layout (layout.task_completed, per-outcome headings under .outcomes).'

export function registerTaskCompletionTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('task_completion_settings_get', `Get the workspace's Task completed screen settings: whether it shows, heading / subheading templates, the "what happens next" lines, button labels and which buttons show, and where Back goes. ${PLACEHOLDERS}`, {},
    async () => run(async () => ({ settings: await completion.getTaskCompletionSettings(svc()) })))

  server.tool('task_completion_settings_update', `Change the Task completed screen settings (settings.edit). Send only what changes. ${PLACEHOLDERS} Audited.`, {
    enabled: z.boolean().optional().describe('Show the screen after a task is actioned'),
    heading: z.string().max(300).optional().describe('Heading template, e.g. "{{outcome}}: {{task.title}}"'),
    subheading: z.string().max(300).optional().describe('Subheading template'),
    next_assigned: z.string().max(300).optional().describe('When the process moved on to someone, e.g. "Now with {{next.assignee}}"'),
    next_complete: z.string().max(300).optional().describe('When the process finished, e.g. "Process complete"'),
    next_waiting: z.string().max(300).optional().describe('On a timer, event or unassigned step, e.g. "Waiting on {{next.step}}"'),
    show_next_task: z.boolean().optional(),
    next_task_label: z.string().max(60).optional(),
    show_back: z.boolean().optional(),
    back_label: z.string().max(60).optional().describe('Blank: "Back to my tasks" / "Back to Home" by back_target'),
    back_target: z.enum(['tasks', 'home']).optional(),
    show_view_flow: z.boolean().optional(),
    view_flow_label: z.string().max(60).optional(),
  }, async (args) => run(async () => ({ settings: await completion.setTaskCompletionSettings(svc(), args) })))

  server.tool('tasks_next_step', 'What happens next after a task was actioned: where its workflow run is now (assigned: the step and who it is with; waiting: a timer or event; complete; processing: the queue is still resuming the run, ask again shortly; stopped; none: not a workflow task; unknown: you may not see the run). Names and step labels only. tasks_complete_workflow returns the same summary as `next`.', {
    task_id: z.string().describe('Task ID'),
  }, async (args) => run(async () => ({ next: await completion.getTaskNextStep(svc(), args.task_id) })))
}
