import { z } from 'zod'
import { defineEndpoint } from './registry'
import { booleanFlag, csvFilter, idParams, listResponse, paginationQuery } from './common'

/*
 * Task tracker → Following: tasks the calling person follows. Personal, so
 * these need a user-bound credential (a tenant-wide key gets 403).
 */

const tags = ['Tasks']
const PERSONAL = 'Personal: needs a credential bound to a user (tenant-wide keys get 403).'
const VISIBLE = 'You can follow a task you can see: assignee, collaborator, member of the assigned team (unassigned team tasks), a manager of an assignee, the assigner, or tasks.view_all / tasks.manage_queue in its workspace (404 otherwise).'
const followResponse = z.looseObject({ task_id: z.string(), following: z.boolean() })

export const listFollowedTasksEndpoint = defineEndpoint({
  method: 'GET', path: '/tasks/following', operationId: 'listFollowedTasks', tags,
  summary: 'Tasks I follow (the Task tracker\'s Following tab)', permission: 'tasks.view_own',
  description: `Rows as the Task tracker shows them (assignee, assigner, team, workflow, subtasks, recent_activity, collaborators, assignee_rank, progress_pct) plus followed_at, sorted by due date (none last), then most recently followed. Completed tasks stay until you unfollow them (hide_completed=true leaves them out); deleted tasks and tasks you can no longer see drop out. ${PERSONAL}`,
  query: paginationQuery.extend({
    search: z.string().max(200).optional().describe('Task name, ID, workflow, people, team, status or priority contains'),
    status: csvFilter('Task statuses'),
    priority: csvFilter('Priorities'),
    hide_completed: booleanFlag('true: leave out completed and cancelled tasks'),
  }),
  response: listResponse('tasks'), listKey: 'tasks',
  cli: { resource: 'tasks', verb: 'following' },
})

export const followTaskEndpoint = defineEndpoint({
  method: 'PUT', path: '/tasks/{id}/follow', operationId: 'followTask', tags,
  summary: 'Follow a task', permission: 'tasks.view_own',
  description: `${VISIBLE} Idempotent. ${PERSONAL}`,
  params: idParams, response: followResponse,
  cli: { resource: 'tasks', verb: 'follow', positional: ['id'] },
})

export const unfollowTaskEndpoint = defineEndpoint({
  method: 'DELETE', path: '/tasks/{id}/follow', operationId: 'unfollowTask', tags,
  summary: 'Stop following a task', permission: 'tasks.view_own',
  description: `Idempotent. ${PERSONAL}`,
  params: idParams, response: followResponse,
  cli: { resource: 'tasks', verb: 'unfollow', positional: ['id'] },
})

export const taskFollowEndpoints = [listFollowedTasksEndpoint, followTaskEndpoint, unfollowTaskEndpoint]
