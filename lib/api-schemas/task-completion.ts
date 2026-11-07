import { z } from 'zod'
import { defineEndpoint } from './registry'
import { idParams } from './common'

/**
 * The Task completed screen (lib/tasks/completion-screen.ts): the
 * workspace's default wording (tenants.settings.tasks.completion_screen)
 * and "what happens next" after a task is actioned.
 */

const PLACEHOLDERS = 'Templates take {{task.title}}, {{outcome}}, {{next.step}}, {{next.assignee}}, {{user.name}} and {{process.name}}; a placeholder with no value renders empty and a template that renders empty uses the built-in default. A task form can override any of these in its layout (layout.task_completed, with per-outcome headings under layout.task_completed.outcomes).'

const template = (what: string) => z.string().max(300).describe(what)
const label = (what: string) => z.string().max(60).describe(what)

export const taskCompletionSettingsSchema = z.object({
  enabled: z.boolean().describe('Show the Task completed screen after a task is actioned (default true)'),
  heading: template('Heading template (default "{{outcome}}: {{task.title}}")'),
  subheading: template('Subheading template (default "Thanks, {{user.name}}. Your response is recorded.")'),
  next_assigned: template('What happens next when the process moved on to someone (default "Now with {{next.assignee}}")'),
  next_complete: template('What happens next when the process finished (default "Process complete")'),
  next_waiting: template('What happens next on a timer, an event or an unassigned step (default "Waiting on {{next.step}}")'),
  show_next_task: z.boolean().describe('Show the Next task button (hidden anyway when there is no next task)'),
  next_task_label: label('Next task button label'),
  show_back: z.boolean().describe('Show the Back button'),
  back_label: label('Back button label; blank: "Back to my tasks" or "Back to Home" by back_target'),
  back_target: z.enum(['tasks', 'home']).describe('Where Back (and Esc) goes'),
  show_view_flow: z.boolean().describe('Show Process view (workflow tasks only; opens the run view the person may see)'),
  view_flow_label: label('Process view button label'),
})

export const taskNextStepSchema = z.object({
  state: z.enum(['assigned', 'waiting', 'complete', 'processing', 'stopped', 'none', 'unknown'])
    .describe('assigned: open task(s) with someone; waiting: a timer, event or unassigned step; complete: the run finished; processing: the resume is still queued (ask again shortly); stopped: the run failed or was cancelled; none: not a workflow task; unknown: you may not see the run'),
  run_id: z.string().nullable(),
  steps: z.array(z.object({
    name: z.string().describe('The step label'),
    assignees: z.array(z.string()).describe('Names of the people it is with'),
    team: z.string().nullable().describe('The team it is with'),
  })).describe('Where the run is now: names and step labels only, never data'),
  process: z.object({ name: z.string() }).nullable(),
  run_view: z.enum(['full', 'progress']).nullable().describe('The run view you may open: full (/automations/runs/<id>) or progress (/home/runs/<id>)'),
})

const tags = ['Task completion']

export const getTaskCompletionSettingsEndpoint = defineEndpoint({
  method: 'GET', path: '/workspace/task-completion', operationId: 'getTaskCompletionSettings', tags,
  summary: 'Get the Task completed screen settings (any member)', description: PLACEHOLDERS, permission: null,
  response: taskCompletionSettingsSchema,
  cli: { resource: 'task-completion', verb: 'get' },
})

export const updateTaskCompletionSettingsEndpoint = defineEndpoint({
  method: 'PATCH', path: '/workspace/task-completion', operationId: 'updateTaskCompletionSettings', tags,
  summary: 'Change the Task completed screen settings',
  description: `Send only the settings to change; the rest are kept. ${PLACEHOLDERS} Audited.`,
  permission: 'settings.edit',
  body: taskCompletionSettingsSchema.partial(),
  response: taskCompletionSettingsSchema,
  cli: { resource: 'task-completion', verb: 'update' },
})

export const getTaskNextStepEndpoint = defineEndpoint({
  method: 'GET', path: '/tasks/{id}/next', operationId: 'getTaskNextStep', tags,
  summary: 'What happens next after a task was actioned',
  description: 'Where the task\'s workflow run is now: the next step and who it is with, waiting on a timer or event, or complete. For people involved in the task (assignee, collaborator, whoever actioned it) or tasks.view_all; the run follows the Home run-progress rules. `processing` while the queue is still resuming the run: ask again shortly. POST /tasks/{id}/action (complete) returns the same summary as `next`.',
  permission: 'tasks.view_own',
  params: idParams,
  response: z.object({ next: taskNextStepSchema }),
  cli: { resource: 'tasks', verb: 'next', positional: ['id'] },
})

export const taskCompletionEndpoints = [getTaskCompletionSettingsEndpoint, updateTaskCompletionSettingsEndpoint, getTaskNextStepEndpoint]
