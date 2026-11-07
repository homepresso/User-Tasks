import { z } from 'zod'
import { defineEndpoint } from './registry'
import { idParams, itemResponse, listResponse, looseObject, paginationQuery } from './common'
import { DESKTOP_COLS, HOME_WIDGET_IDS, MAX_LAYOUT_BYTES, ROW_PX, homeLayoutInputSchema } from '@/lib/home/layout'

/*
 * Home: the calling person's metrics, submissions (with the progress of the
 * runs they started), followed runs, favourite forms and claimable tasks.
 * Everything is the caller's own, so these need a user-bound credential
 * (a tenant-wide key gets 403).
 */

const tags = ['Home']
const PERSONAL = 'Personal: needs a credential bound to a user (tenant-wide keys get 403).'
const progressStatus = z.enum(['all', 'active', 'completed', 'failed']).optional().describe('all (default), active (running, waiting or starting), completed, failed (failed or cancelled)')
const STAGE_NOTE = 'Each item has status (queued, running, waiting, completed, failed, cancelled, none), status_label ("Waiting on Manager approval"), stages [{ node_id, name, assignees [{ id, name }], team, since, due_date }] (where the run is and who has it) and people (names).'

export const getHomeMetricsEndpoint = defineEndpoint({
  method: 'GET', path: '/home/metrics', operationId: 'getHomeMetrics', tags,
  summary: 'The Home cards: my tasks, my submissions in progress, runs I follow', permission: null,
  description: `tasks { open, overdue, sla_breached, completed_30d, queue } (null without tasks.view_own), submissions { in_progress, completed_30d, submitted_30d } (null without forms.submit), following { active, updated_today, total }. ${PERSONAL}`,
  response: z.looseObject({ tasks: looseObject.nullable(), submissions: looseObject.nullable(), following: looseObject }),
  cli: { resource: 'home', verb: 'metrics' },
})

export const getHomeStatsEndpoint = defineEndpoint({
  method: 'GET', path: '/home/stats', operationId: 'getHomeStats', tags,
  summary: 'My activity over 7, 30 or 90 days: tasks completed, decisions, durations, on time, submissions', permission: null,
  description: `The Home "My activity" charts, computed on the server for the calling person only. period (default 30d) and timezone (day / week buckets; default your profile's time zone, else UTC; 90d uses ISO weeks starting Monday). tasks (null without tasks.view_own): period { days, unit, timezone, start, end }, completed { total, buckets [{ start, count, median_s, p90_s }] }, decisions { total, approved, rejected, returned, approval_rate (approve ÷ decisions; null when none), non_decision, groups [{ kind, label, count }], non_decision_labels }, durations { count, median_s, p90_s, pickup { count, median_s, p90_s } } (assigned → completed / accepted, seconds), on_time { with_deadline, on_time, late, no_deadline, rate } (due date, else the run's SLA), top_processes [{ workflow_id, name, count }]. submissions (null without forms.submit): { total, completed, in_progress, failed, cancelled, no_process, median_s, p90_s } (submitted → process completed). Outcome kinds: approve, reject, return, other (a choice between two or more outcomes), completion (not a decision). ${PERSONAL}`,
  query: z.object({
    period: z.enum(['7d', '30d', '90d']).optional().describe('7d, 30d (default) or 90d'),
    timezone: z.string().max(64).optional().describe('IANA time zone for day / week buckets, e.g. Pacific/Auckland'),
  }),
  response: z.looseObject({ period: z.number(), timezone: z.string(), tasks: looseObject.nullable(), submissions: looseObject.nullable() }),
  cli: { resource: 'home', verb: 'stats' },
})

export const listMySubmissionsEndpoint = defineEndpoint({
  method: 'GET', path: '/home/submissions', operationId: 'listMySubmissions', tags,
  summary: 'Forms I submitted, with the process each one started and where it is now', permission: 'forms.submit',
  description: `Newest first. Task-form submissions are task completions and are not listed. Each carries \`submission\`, the metadata workflows see as {{submission.*}} (reference, submitted_at, submitted_by, form { id, name, version }, source). ${STAGE_NOTE} ${PERSONAL}`,
  query: paginationQuery.extend({ search: z.string().max(200).optional().describe('Form or process name contains'), status: progressStatus }),
  response: listResponse('submissions'), listKey: 'submissions',
  cli: { resource: 'home', verb: 'submissions' },
})

export const listFollowedRunsEndpoint = defineEndpoint({
  method: 'GET', path: '/home/following', operationId: 'listFollowedRuns', tags,
  summary: 'Workflow runs I follow, with where they are and who has them', permission: null,
  description: `Active runs first, then by last update. Runs I start (form submissions included) are followed automatically unless auto_follow_runs is off (PATCH /home/preferences). ${STAGE_NOTE} ${PERSONAL}`,
  query: paginationQuery.extend({ search: z.string().max(200).optional().describe('Process name or run title contains'), status: progressStatus }),
  response: listResponse('runs'), listKey: 'runs',
  cli: { resource: 'home', verb: 'following' },
})

export const followRunEndpoint = defineEndpoint({
  method: 'PUT', path: '/home/following/{id}', operationId: 'followRun', tags,
  summary: 'Follow a workflow run', permission: null,
  description: `You can follow a run you started, one your form submission started, one you have a task in, or any run with workflows.view_runs (404 otherwise). Idempotent. ${PERSONAL}`,
  params: idParams, response: z.looseObject({ run_id: z.string(), following: z.boolean() }),
  cli: { resource: 'home', verb: 'follow', positional: ['id'] },
})

export const unfollowRunEndpoint = defineEndpoint({
  method: 'DELETE', path: '/home/following/{id}', operationId: 'unfollowRun', tags,
  summary: 'Stop following a workflow run', permission: null, description: `Idempotent. ${PERSONAL}`,
  params: idParams, response: z.looseObject({ run_id: z.string(), following: z.boolean() }),
  cli: { resource: 'home', verb: 'unfollow', positional: ['id'] },
})

export const getRunProgressEndpoint = defineEndpoint({
  method: 'GET', path: '/home/runs/{id}/progress', operationId: 'getRunProgress', tags,
  summary: 'A run\'s progress (the submitter-safe flow view)', permission: null,
  description: `For a run you can see (as for following): run { status, status_label, started_at, completed_at, updated_at }, process { name }, flow { nodes (id, type, label, position — no configs), edges, sections, overlay (per-step status) }, stages (where it is now), steps (its tasks: name, status, assignees, team, dates), tasks (its User Tasks with people, history and your per-task can_open / can_act — see GET /workflows/runs/{id}) and submission (when it was your form). Never step configs, outputs, errors, variables or form values. ${PERSONAL}`,
  params: idParams, response: itemResponse('progress'),
  cli: { resource: 'home', verb: 'progress', positional: ['id'] },
})

export const listFavoriteFormsEndpoint = defineEndpoint({
  method: 'GET', path: '/home/favorite-forms', operationId: 'listFavoriteForms', tags,
  summary: 'My favourite forms (that I can still open), alphabetical', permission: null,
  description: `A favourite is hidden while you cannot open the form (no forms.submit). ${PERSONAL}`,
  response: listResponse('forms'), listKey: 'forms',
  cli: { resource: 'home', verb: 'favorites' },
})

export const favoriteFormEndpoint = defineEndpoint({
  method: 'PUT', path: '/home/favorite-forms/{id}', operationId: 'favoriteForm', tags,
  summary: 'Star a form', permission: 'forms.submit', description: `Only forms you can open (404 otherwise). Idempotent. ${PERSONAL}`,
  params: idParams, response: z.looseObject({ form_id: z.string(), favorite: z.boolean() }),
  cli: { resource: 'home', verb: 'favorite', positional: ['id'] },
})

export const unfavoriteFormEndpoint = defineEndpoint({
  method: 'DELETE', path: '/home/favorite-forms/{id}', operationId: 'unfavoriteForm', tags,
  summary: 'Unstar a form', permission: null, description: `Idempotent. ${PERSONAL}`,
  params: idParams, response: z.looseObject({ form_id: z.string(), favorite: z.boolean() }),
  cli: { resource: 'home', verb: 'unfavorite', positional: ['id'] },
})

const preferences = z.looseObject({ auto_follow_runs: z.boolean() })

export const getHomePreferencesEndpoint = defineEndpoint({
  method: 'GET', path: '/home/preferences', operationId: 'getHomePreferences', tags,
  summary: 'My Home preferences (auto-follow)', permission: null, description: PERSONAL,
  response: itemResponse('preferences', preferences),
  cli: { resource: 'home', verb: 'preferences' },
})

export const updateHomePreferencesEndpoint = defineEndpoint({
  method: 'PATCH', path: '/home/preferences', operationId: 'updateHomePreferences', tags,
  summary: 'Change my Home preferences', permission: null,
  description: `auto_follow_runs (default true): follow the runs you start, form submissions included. Runs already followed stay followed. ${PERSONAL}`,
  body: z.object({ auto_follow_runs: z.boolean().optional() }),
  response: itemResponse('preferences', preferences),
  cli: { resource: 'home', verb: 'set-preferences' },
})

const LAYOUT_NOTE = `layout { items [{ id, w, h }] (visible widgets in reading order; w = columns of the ${DESKTOP_COLS}-column desktop grid, h = rows of ${ROW_PX}px), hidden [ids] }, customised (false = the default layout), updated_at, grid { columns, row_px, gap_px } and widgets [{ id, title, group, available, default, min, max }]. Widget ids: ${HOME_WIDGET_IDS.join(', ')}. Stored per person and per workspace; tablets derive their widths from these and phones stack the same order.`
const layoutResponse = z.looseObject({ layout: z.looseObject({ items: z.array(z.looseObject({ id: z.string(), w: z.number(), h: z.number() })), hidden: z.array(z.string()) }), customised: z.boolean(), updated_at: z.string().nullable(), grid: looseObject, widgets: z.array(looseObject) })

export const getHomeLayoutEndpoint = defineEndpoint({
  method: 'GET', path: '/home/layout', operationId: 'getHomeLayout', tags,
  summary: 'My Home layout in this workspace: widget order, sizes and hidden widgets', permission: null,
  description: `${LAYOUT_NOTE} ${PERSONAL}`,
  response: layoutResponse,
  cli: { resource: 'home', verb: 'layout' },
})

export const updateHomeLayoutEndpoint = defineEndpoint({
  method: 'PUT', path: '/home/layout', operationId: 'updateHomeLayout', tags,
  summary: 'Save my Home layout in this workspace', permission: null,
  description: `Replaces the layout. Known widget ids only, each at most once; sizes are clamped to each widget's min / max; widgets you leave out of both items and hidden are put back in their default spot. At most ${MAX_LAYOUT_BYTES} bytes. Returns the saved layout (as GET). ${PERSONAL}`,
  body: homeLayoutInputSchema,
  response: layoutResponse,
  cli: { resource: 'home', verb: 'set-layout' },
})

export const resetHomeLayoutEndpoint = defineEndpoint({
  method: 'DELETE', path: '/home/layout', operationId: 'resetHomeLayout', tags,
  summary: 'Reset my Home layout in this workspace to the default', permission: null,
  description: `Other workspaces keep their layouts. Idempotent. Returns the default layout (as GET). ${PERSONAL}`,
  response: layoutResponse,
  cli: { resource: 'home', verb: 'reset-layout' },
})

export const listMyHomeTasksEndpoint = defineEndpoint({
  method: 'GET', path: '/home/tasks', operationId: 'listMyHomeTasks', tags,
  summary: 'My open tasks with their process and stage', permission: 'tasks.view_own',
  description: `Open tasks assigned to me that I have accepted or that were added straight to my list (not those still Queued, waiting for my acceptance — see /home/queue). Each has process { workflow_id, name }, stage (the step's name), due_date, overdue, sla_status, priority and assigned_at. ${PERSONAL}`,
  query: paginationQuery.extend({ search: z.string().max(200).optional().describe('Title contains'), sort: z.enum(['due', 'priority', 'newest']).optional().describe('due (default, soonest first), priority, newest') }),
  response: listResponse('tasks'), listKey: 'tasks',
  cli: { resource: 'home', verb: 'tasks' },
})

export const listQueueTasksEndpoint = defineEndpoint({
  method: 'GET', path: '/home/queue', operationId: 'listHomeQueue', tags,
  summary: 'Tasks I can take: waiting for my acceptance, or unassigned in my teams', permission: 'tasks.view_own',
  description: `The tasks the app's My tasks list shows with status Queued (whether a new task is queued follows the assignee's queue rules). Each has action: accept (POST /tasks/{id}/action with accept) or claim (POST /tasks/{id}/claim). ${PERSONAL}`,
  query: paginationQuery.extend({ search: z.string().max(200).optional().describe('Title contains') }),
  response: listResponse('tasks'), listKey: 'tasks',
  cli: { resource: 'home', verb: 'queue' },
})

export const claimTaskEndpoint = defineEndpoint({
  method: 'POST', path: '/tasks/{id}/claim', operationId: 'claimTask', tags: ['Tasks'],
  summary: 'Claim an unassigned team task (a member of its team becomes its assignee)', permission: 'tasks.complete',
  description: `Atomic: if someone claimed it first, 409. ${PERSONAL}`,
  params: idParams, response: z.looseObject({ claimed: z.literal(true), task_id: z.string() }),
  cli: { resource: 'tasks', verb: 'claim', positional: ['id'] },
})

export const homeEndpoints = [
  getHomeMetricsEndpoint, getHomeStatsEndpoint, listMyHomeTasksEndpoint, listQueueTasksEndpoint, listMySubmissionsEndpoint, getRunProgressEndpoint,
  listFollowedRunsEndpoint, followRunEndpoint, unfollowRunEndpoint,
  listFavoriteFormsEndpoint, favoriteFormEndpoint, unfavoriteFormEndpoint,
  getHomePreferencesEndpoint, updateHomePreferencesEndpoint,
  getHomeLayoutEndpoint, updateHomeLayoutEndpoint, resetHomeLayoutEndpoint, claimTaskEndpoint,
]

