import { z } from 'zod'
import { defineEndpoint } from './registry'
import { idParams } from './common'

/**
 * Invite (read only): share a task with people, teams and roles
 * (lib/services/task-viewers.ts). Everyone an invite names can open the task
 * (and its subtasks when include_subtasks), its comments, attachments,
 * history and its run's process view, and comment — nothing else. The task
 * shows in their Task tracker → Following (shared_with_me) and in the
 * dependency picker.
 */

const tags = ['Tasks']
const MANAGERS = 'Invite and remove: the assignee or a collaborator, a member of the assigned team, the assigner, a manager of an assignee, a manager of the workflow, or tasks.complete_any (an invited viewer cannot invite others).'

const principal = z.object({
  type: z.enum(['user', 'team', 'role']).describe('Who: a person, a team or a role of the workspace'),
  id: z.string().describe('User, team or role id'),
})

export const taskViewerObject = z.looseObject({
  id: z.string().describe('Invite id'),
  task_id: z.string(),
  principal_type: z.enum(['user', 'team', 'role']),
  principal_id: z.string(),
  name: z.string().describe('Person / team / role name'),
  member_count: z.number().int().nullable().describe('Members of the team / holders of the role (null for a person)'),
  include_subtasks: z.boolean(),
  note: z.string().nullable(),
  invited_by: z.looseObject({ id: z.string(), name: z.string() }).nullable(),
  created_at: z.string(),
})

export const listTaskViewersEndpoint = defineEndpoint({
  method: 'GET', path: '/tasks/{id}/viewers', operationId: 'listTaskViewers', tags,
  summary: 'Who a task is shared with (read only invites)', permission: 'tasks.view_own',
  description: `The task's invites, oldest first, and can_manage (whether you may invite and remove). Anyone who can see the task reads them; anyone else gets 404. ${MANAGERS}`,
  params: idParams,
  response: z.looseObject({ task_id: z.string(), tenant_id: z.string(), viewers: z.array(taskViewerObject), can_manage: z.boolean() }),
  listKey: 'viewers',
  cli: { resource: 'tasks', verb: 'viewers', positional: ['id'] },
})

export const addTaskViewersEndpoint = defineEndpoint({
  method: 'POST', path: '/tasks/{id}/viewers', operationId: 'addTaskViewers', tags,
  summary: 'Invite people, teams or roles to view a task (read only)', permission: 'tasks.view_own',
  description: `Shares the task, read only: everyone the invite names (directly, as a member of the team or a holder of the role) can open it (and its subtasks unless include_subtasks is false), its comments, attachments, history and process view, and comment. People invited directly follow it (Task tracker → Following) and get a notification and an email; members of an invited team or role get a notification when it has at most 25 people. Already-invited ones are left as they are. Recorded in the task history and the audit log. ${MANAGERS}`,
  params: idParams,
  body: z.object({
    viewers: z.array(principal).min(1).max(50).describe('People, teams and roles to invite (at most 50)'),
    note: z.string().max(2000).optional().describe('A note for them (shown in the notification)'),
    include_subtasks: z.boolean().optional().describe('Also its subtasks (default true)'),
  }),
  successStatus: 201,
  response: z.looseObject({
    task_id: z.string(), added: z.array(taskViewerObject), existing: z.number().int(),
    notified: z.number().int(), skipped_group_notifications: z.number().int(), basis: z.string(),
  }),
  cli: { resource: 'tasks', verb: 'viewers-add', positional: ['id'] },
})

export const removeTaskViewerEndpoint = defineEndpoint({
  method: 'DELETE', path: '/tasks/{id}/viewers/{viewerId}', operationId: 'removeTaskViewer', tags,
  summary: 'Stop sharing a task with a person, team or role', permission: 'tasks.view_own',
  description: `Removes one invite (its id from GET /tasks/{id}/viewers): its people lose access unless something else lets them see the task, and the follow the invite created is removed. Recorded in the task history and the audit log. ${MANAGERS}`,
  params: z.object({ id: z.string().describe('Task id'), viewerId: z.string().describe('Invite id') }),
  response: z.looseObject({ task_id: z.string(), removed: taskViewerObject }),
  cli: { resource: 'tasks', verb: 'viewers-remove', positional: ['id', 'viewerId'] },
})

export const taskViewerEndpoints = [listTaskViewersEndpoint, addTaskViewersEndpoint, removeTaskViewerEndpoint]
