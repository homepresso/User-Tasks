import { z } from 'zod'
import { defineEndpoint } from './registry'
import { idParams } from './common'

/*
 * Unread tasks (lib/services/task-reads.ts): per-person read state. Task
 * list and get responses carry `unread` for the credential's person; these
 * mark one task read or unread, mark all read, and count. Personal, so they
 * need a user-bound credential (a tenant-wide key gets 403).
 */

const tags = ['Tasks']
const PERSONAL = 'Personal: needs a credential bound to a user (tenant-wide keys get 403).'
export const UNREAD_RULE = 'A task is unread for you while it is open (todo, in progress or blocked), you hold it (assignee, collaborator or claim candidate, or a member of the assigned team of an unassigned team task) and you have not opened it since it became yours (assigned, reassigned, claimed, or reopened / sent back). Completed, cancelled and draft tasks are never unread.'
const readState = z.looseObject({ task_id: z.string(), unread: z.boolean() })

export const markTaskReadEndpoint = defineEndpoint({
  method: 'PUT', path: '/tasks/{id}/read', operationId: 'markTaskRead', tags,
  summary: 'Mark a task as read', permission: 'tasks.view_own',
  description: `What opening the task does in the app. A task you can see; 404 otherwise. Idempotent. ${UNREAD_RULE} ${PERSONAL}`,
  params: idParams, response: readState,
  cli: { resource: 'tasks', verb: 'mark-read', positional: ['id'] },
})

export const markTaskUnreadEndpoint = defineEndpoint({
  method: 'DELETE', path: '/tasks/{id}/read', operationId: 'markTaskUnread', tags,
  summary: 'Mark a task as unread', permission: 'tasks.view_own',
  description: `Forgets that you opened it. \`unread\` in the response is the state the rule then gives: a task you don't hold, or a closed one, stays read. A task you can see; 404 otherwise. Idempotent. ${PERSONAL}`,
  params: idParams, response: readState,
  cli: { resource: 'tasks', verb: 'mark-unread', positional: ['id'] },
})

export const markAllTasksReadEndpoint = defineEndpoint({
  method: 'POST', path: '/tasks/read-all', operationId: 'markAllTasksRead', tags,
  summary: 'Mark all my tasks as read', permission: 'tasks.view_own',
  description: `Marks every task that is unread for you in the credential's workspace as read; \`marked\` is how many. ${PERSONAL}`,
  response: z.looseObject({ marked: z.number().int() }),
  cli: { resource: 'tasks', verb: 'mark-all-read' },
})

export const countUnreadTasksEndpoint = defineEndpoint({
  method: 'GET', path: '/tasks/unread-count', operationId: 'countUnreadTasks', tags,
  summary: 'How many of my tasks are unread', permission: 'tasks.view_own',
  description: `Top-level tasks that are unread for you in the credential's workspace (the count next to My tasks in the app). ${UNREAD_RULE} ${PERSONAL}`,
  response: z.looseObject({ unread: z.number().int() }),
  cli: { resource: 'tasks', verb: 'unread-count' },
})

export const taskReadEndpoints = [markTaskReadEndpoint, markTaskUnreadEndpoint, markAllTasksReadEndpoint, countUnreadTasksEndpoint]
