import { z } from 'zod'
import { INVITABLE_ROLES } from '@/lib/invitation-roles'
import { defineEndpoint } from './registry'
import { booleanFlag, csvFilter, idParams, itemResponse, listResponse, paginationQuery } from './common'

export const taskActionBody = z.object({
  action: z.enum(['accept', 'hold', 'reject', 'complete', 'escalate', 'redirect']),
  outcome: z.string().optional(),
  outcome_notes: z.string().optional(),
  target_user_id: z.string().uuid().optional(),
  target_user_ids: z.array(z.string().uuid()).optional(),
  target_email: z.string().email().optional(),
  target_emails: z.array(z.string().email()).optional(),
  invite_if_needed: z.boolean().optional(),
  invite_role: z.enum(INVITABLE_ROLES).optional(),
  comment: z.string().optional(),
  values: z.record(z.string(), z.unknown()).optional(),
  on_behalf: z.boolean().optional().describe('Act for the assignee of a workflow task: their manager (anyone in their manager chain), or a holder of tasks.complete_any. Requires on_behalf_note'),
  on_behalf_note: z.string().max(2000).optional().describe('Why you are acting on behalf (required with on_behalf; shown to the assignee and recorded in the task history)'),
})

const descriptionField = 'Plain text or HTML. HTML is sanitised to an allowlist (formatting, lists, headings, links, tables, https images); scripts, styles, event handlers and unsafe URLs are removed.'

/** `?strip_html=true` on task reads: `description` comes back as plain text. */
const stripHtml = booleanFlag('Return `description` as plain text (HTML stripped). `description_text` is always included.')

export const taskIngestSubtaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().describe(descriptionField),
  assignee_email: z.string().email().optional(),
  estimated_effort: z.number().optional(),
  sequence: z.number().optional(),
})

export const taskIngestBody = z.object({
  title: z.string().min(1),
  description: z.string().optional().describe(descriptionField),
  priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).default('medium'),
  due_date: z.string().optional(),
  assignee_email: z.string().email().optional(),
  estimated_effort: z.number().optional(),
  subtasks: z.array(taskIngestSubtaskSchema).optional().default([]),
  workflow: z.object({
    engine_type: z.string().optional(),
    instance_id: z.string().optional(),
    callback_url: z.string().url().optional(),
    step_id: z.string().optional(),
    position: z.string().optional(),
  }).optional(),
  idempotency_key: z.string().optional(),
})

export const taskUpdateBody = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().nullable().optional().describe(descriptionField),
  status: z.enum(['draft', 'todo', 'in_progress', 'blocked', 'cancelled']).optional().describe('Complete through POST /tasks/{id}/action instead'),
  priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).optional(),
  due_date: z.string().nullable().optional().describe('ISO 8601'),
  progress_pct: z.number().min(0).max(100).nullable().optional(),
  estimated_completion: z.string().nullable().optional().describe('ISO 8601'),
  tags: z.array(z.string()).nullable().optional(),
  values: z.record(z.string(), z.unknown()).optional().describe('User Task field values (validated against the task\'s fields; saved as a draft, required fields are checked on completion)'),
  on_behalf: z.boolean().optional().describe('Save a workflow task\'s values for its assignee (their manager, or tasks.complete_any)'),
  on_behalf_note: z.string().max(2000).optional(),
})

const tags = ['Tasks']

export const updateTaskEndpoint = defineEndpoint({
  method: 'PATCH', path: '/tasks/{id}', operationId: 'updateTask', tags,
  summary: 'Update task fields and User Task field values', permission: 'tasks.complete',
  description: 'Same field allowlist as the task UI. User-bound credentials only reach their own tasks (and their reports\'). Field values of a workflow task are saved by its assignee, or by their manager with on_behalf=true (403 otherwise). Field values of closed tasks cannot change (409).',
  params: idParams, body: taskUpdateBody,
  response: itemResponse('task'),
  roundTrip: { unwrap: 'task' },
  cli: { resource: 'tasks', verb: 'update', positional: ['id'] },
})

export const taskLookupBody = z.object({
  field_key: z.string().min(1).max(64).describe('Key of an Autocomplete / lookup field of the task\'s form'),
  query: z.string().max(500).optional().describe('The typed text (matched against the configured search columns / passed to the reference as {{search}})'),
  values: z.record(z.string(), z.unknown()).optional().describe('The form\'s current values, for {{task_data.<key>}} placeholders in the lookup\'s filters or reference inputs'),
})

const lookupItem = z.object({
  value: z.string().describe('Stored as task_data.<key> when selected'),
  label: z.string(),
  description: z.string().optional().describe('Secondary display text'),
  fields: z.record(z.string(), z.unknown()).describe('The configured display / value / fill fields of the item (task_data.<key>_item once saved)'),
})

export const lookupTaskEndpoint = defineEndpoint({
  method: 'POST', path: '/tasks/{id}/lookup', operationId: 'lookupTaskField', tags,
  summary: 'Suggestions for an Autocomplete / lookup field of an open task', permission: 'tasks.complete',
  description: 'Runs the lookup configured on the task\'s stored form (data table or API reference) — never a config from the request. The caller must be able to act on the task (user-bound credentials: assignee, collaborator, team member or queue manager). Only the configured columns / fields are returned. Rate limited per user (429).',
  params: idParams, body: taskLookupBody,
  response: z.object({
    items: z.array(lookupItem),
    truncated: z.boolean().optional().describe('More matches than max results'),
    cached: z.boolean().optional().describe('Reference response served from the cache'),
    too_short: z.boolean().optional().describe('Fewer characters than the field\'s minimum: nothing was queried'),
  }),
  cli: { resource: 'tasks', verb: 'lookup', positional: ['id'] },
})

export const taskEndpoints = [
  defineEndpoint({
    method: 'GET', path: '/tasks', operationId: 'listTasks', tags,
    summary: 'List tasks', permission: 'tasks.view_all',
    description: 'User-bound credentials only see tasks assigned to (or shared with) their user. `scope=reports` lists the open tasks of the caller\'s reports instead (the manager view; needs a user and only tasks.view_own), with per-person workload counts in `reports`.',
    query: paginationQuery.extend({
      scope: z.enum(['all', 'reports']).optional().describe('reports: open tasks of your direct reports (add indirect=true for all levels)'),
      indirect: booleanFlag('scope=reports: include indirect reports (reports of reports, up to 10 levels)'),
      overdue: booleanFlag('scope=reports: only overdue tasks'),
      sla_breached: booleanFlag('scope=reports: only tasks whose run SLA is breached or whose escalation fired'),
      workflow_id: z.string().optional().describe('scope=reports: tasks of one workflow'),
      status: csvFilter('Task statuses'),
      priority: csvFilter('Priorities'),
      assignee_id: z.string().optional(),
      is_workflow_task: booleanFlag('Filter workflow-generated tasks'),
      parent_task_id: z.string().optional(),
      strip_html: stripHtml,
    }),
    response: listResponse('tasks'), listKey: 'tasks',
    cli: { resource: 'tasks', verb: 'list' },
  }),
  defineEndpoint({
    method: 'GET', path: '/tasks/assigned', operationId: 'listAssignedTasks', tags,
    summary: 'List open tasks assigned to a user or team', permission: 'tasks.view_all',
    query: paginationQuery.extend({
      assignee_id: z.string().optional(),
      team_id: z.string().optional(),
      status: csvFilter('Task statuses (default todo,in_progress)'),
      acceptance_status: csvFilter('Acceptance statuses'),
      strip_html: stripHtml,
    }),
    response: listResponse('tasks'), listKey: 'tasks',
    cli: { resource: 'tasks', verb: 'assigned' },
  }),
  defineEndpoint({
    method: 'GET', path: '/tasks/{id}', operationId: 'getTask', tags,
    summary: 'Get a task', permission: 'tasks.view_all',
    description: 'Task responses include `description` (as stored: sanitised HTML or plain text) and `description_text` (plain text).',
    params: idParams,
    query: z.object({ strip_html: stripHtml }),
    response: itemResponse('task'),
    cli: { resource: 'tasks', verb: 'get', positional: ['id'] },
  }),
  updateTaskEndpoint,
  defineEndpoint({
    method: 'POST', path: '/tasks/{id}/action', operationId: 'actOnTask', tags,
    summary: 'Accept, hold, reject, complete, escalate or redirect a task', permission: 'tasks.complete',
    description: 'Workflow tasks are actioned by their assignee only (a member of the assigned team for a team task). Their manager — anyone in the assignee\'s manager chain in this workspace — may act on behalf with on_behalf=true and an on_behalf_note; the task records actioned_by (the manager) and actioned_on_behalf_of (the assignee) and the assignee is notified. tasks.complete_any (Owner only by default) is the audited break-glass for anyone else, and is required for credentials with no user. 403 otherwise, 404 for another workspace\'s task, 409 once the task is closed.',
    params: idParams, body: taskActionBody,
    response: z.looseObject({
      action: z.string(),
      workflow_resumed: z.boolean().optional()
        .describe('complete on a workflow task: whether the paused run was queued to resume'),
      workflow_status: z.string().optional()
        .describe("'queued' — the rest of the workflow runs on the queue; poll the run by run_id"),
      run_id: z.string().optional().describe('The resumed workflow run'),
      resumed: z.literal('queued').optional(),
      workflow_error: z.string().optional(),
      acted_as: z.enum(['assignee', 'on_behalf', 'break_glass', 'credential']).optional().describe('How the caller was allowed to act'),
      on_behalf_of: z.string().nullable().optional().describe('The assignee acted for (on_behalf / break_glass)'),
    }),
    cli: { resource: 'tasks', verb: 'action', positional: ['id'] },
  }),
  lookupTaskEndpoint,
  defineEndpoint({
    method: 'POST', path: '/tasks/ingest', operationId: 'ingestTask', tags,
    summary: 'Create a task (with optional subtasks) from an external system', permission: 'tasks.create',
    body: taskIngestBody, successStatus: 201, envelope: false,
    response: z.looseObject({ task_id: z.string(), tenant_id: z.string().optional(), subtask_count: z.number().int().optional(), deduplicated: z.boolean().optional() }),
    cli: { resource: 'tasks', verb: 'ingest' },
  }),
]
