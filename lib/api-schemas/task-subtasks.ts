import { z } from 'zod'
import { defineEndpoint } from './registry'
import { idParams } from './common'
import {
  SUBTASK_DESCRIPTION_MAX, SUBTASK_EFFORT_MAX_MINUTES, SUBTASK_MAX_DEPTH, SUBTASK_SUBTITLE_MAX, SUBTASK_TAG_MAX, SUBTASK_TAGS_MAX, SUBTASK_TITLE_MAX,
} from '@/lib/tasks/subtask-input'

/**
 * Subtasks (lib/services/tasks addSubtask / updateSubtask / listSubtasks):
 * personal checklist-style work items under a task — standard or workflow
 * task. Subtasks never change a workflow's flow: the workflow task still
 * completes only through its step.
 */

const tags = ['Tasks']

const WHO = `Anyone who can work on the task: tasks.complete and the task within reach — assignee, collaborator, member of its team, the assignee's manager (on their behalf), its assigner / creator, or tasks.view_all (e.g. an admin). Viewers and people who can't reach the task get 403 / 404. Needs a user-bound credential.`

const descriptionField = 'Plain text or HTML. HTML is sanitised to an allowlist (formatting, lists, headings, links, tables, https images).'

const subtaskFields = {
  subtitle: z.string().max(SUBTASK_SUBTITLE_MAX).nullable().optional().describe('A short summary shown under the title'),
  description: z.string().max(SUBTASK_DESCRIPTION_MAX).nullable().optional().describe(descriptionField),
  estimated_effort_minutes: z.number().int().min(0).max(SUBTASK_EFFORT_MAX_MINUTES).nullable().optional()
    .describe('Estimate in whole minutes (the unit of actual_effort); stored as the creator\'s estimate. 0 or null = none'),
  due_date: z.string().nullable().optional().describe('ISO 8601 date or date-time (years 2000–2100)'),
  priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).optional().describe('Default: the parent\'s priority'),
  tags: z.array(z.string().max(SUBTASK_TAG_MAX)).max(SUBTASK_TAGS_MAX).nullable().optional(),
}

export const subtaskCreateBody = z.object({
  title: z.string().min(1).max(SUBTASK_TITLE_MAX),
  ...subtaskFields,
})

export const subtaskUpdateBody = z.object({
  title: z.string().min(1).max(SUBTASK_TITLE_MAX).optional(),
  ...subtaskFields,
})

export const subtaskObject = z.looseObject({
  id: z.string(),
  parent_task_id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  description: z.string().nullable(),
  status: z.string(),
  priority: z.string(),
  due_date: z.string().nullable(),
  sequence: z.number(),
  tags: z.array(z.string()),
  assignee_id: z.string().nullable().describe('The parent\'s assignee, else the person who added it'),
  estimated_effort_minutes: z.number().nullable().describe('The working estimate (the assignee\'s, else the creator\'s)'),
  actual_effort_minutes: z.number(),
  child_count: z.number().describe('Its own subtasks'),
  completed_child_count: z.number(),
  created_at: z.string().nullable(),
})

const subtaskParams = z.object({
  id: z.string().describe('Parent task id'),
  subtaskId: z.string().describe('Subtask id'),
})

export const listSubtasksEndpoint = defineEndpoint({
  method: 'GET', path: '/tasks/{id}/subtasks', operationId: 'listSubtasks', tags,
  summary: 'List a task\'s subtasks', permission: 'tasks.view_own',
  description: 'Direct subtasks in order, with `total`, `completed` and `can_add` (whether you may add subtasks here). Visible to anyone who can reach the task (404 otherwise).',
  params: idParams,
  response: z.looseObject({ task_id: z.string(), subtasks: z.array(subtaskObject), total: z.number().int(), completed: z.number().int(), can_add: z.boolean() }),
  listKey: 'subtasks',
  cli: { resource: 'tasks', verb: 'subtasks', positional: ['id'] },
})

export const addSubtaskEndpoint = defineEndpoint({
  method: 'POST', path: '/tasks/{id}/subtasks', operationId: 'addSubtask', tags,
  summary: 'Add a subtask', permission: 'tasks.complete',
  description: `Title plus optional subtitle, description, estimate, due date, priority and tags. ${WHO} Workflow tasks included (the subtask is not a workflow task and never completes or resumes the workflow). The subtask goes to the parent's assignee (else you), already accepted, at the end of the list; the parent's progress counts it. 409 when the task is closed; subtasks go at most ${SUBTASK_MAX_DEPTH} levels deep.`,
  params: idParams, body: subtaskCreateBody, successStatus: 201,
  response: z.looseObject({ subtask: subtaskObject }),
  cli: { resource: 'tasks', verb: 'add-subtask', positional: ['id'] },
})

export const updateSubtaskEndpoint = defineEndpoint({
  method: 'PATCH', path: '/tasks/{id}/subtasks/{subtaskId}', operationId: 'updateSubtask', tags,
  summary: 'Edit a subtask', permission: 'tasks.complete',
  description: `Any of the create fields (only those sent change). ${WHO} Tick / untick a subtask with PATCH /tasks/{subtaskId} (status) or complete it through POST /tasks/{subtaskId}/action.`,
  params: subtaskParams, body: subtaskUpdateBody,
  response: z.looseObject({ subtask: subtaskObject }),
  cli: { resource: 'tasks', verb: 'update-subtask', positional: ['id', 'subtaskId'] },
})

export const taskSubtaskEndpoints = [listSubtasksEndpoint, addSubtaskEndpoint, updateSubtaskEndpoint]
