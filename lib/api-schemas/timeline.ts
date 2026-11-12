import { defineEndpoint } from './registry'
import { idParams, itemResponse } from './common'

/*
 * Timeline (lib/services/run-timeline.ts): a run — or a task — told as a
 * readable list of events. Any authenticated caller; the service shows only
 * what the caller may see and answers 404 otherwise.
 */

const tags = ['Timeline']

export const TIMELINE_DESCRIPTION = 'timeline { kind (run / task), run_id, task_id, focus_task_id, detail (full: the run is in your run scope — every step, error text and resolved values; progress: you may follow its progress — people and steps only, the submitter named only to the submitter; task: one task\'s own history), header { workflow, title, reference, status, status_label, started_at, ended_at, duration_ms, started_by, started_how, current, version, sla_due_at }, events [{ id, kind (started, task_created, accepted, held, declined, reassigned, redirected, escalated, took_ownership, comment, outcome, task_closed, attachment, subtask, shared, form_saved, effort, system, system_group, subworkflow, error, run_paused, run_resumed, run_cancelled, ended, now), category (decisions / comments / people / system), at, actor { id, name, avatar_url }, on_behalf_of, via, icon, tone, title, step, body, note, badge { label, tone }, fields [{ label, value, list? { config, rows } (a List field: its config and up to 50 rows) }], links [{ kind, label, href }], task_id, node_id, due_date, since_previous_ms, children (a collapsed group of automatic steps or a sub-workflow\'s steps), highlight }] oldest first, ending with the result (ended) or where it is now (now), live, links { process, timeline, task } }. Comments, notes, form values and reassignment lines appear only for tasks you can open or are invited to view.'

export const getRunTimelineEndpoint = defineEndpoint({
  method: 'GET', path: '/workflows/runs/{id}/timeline', operationId: 'getRunTimeline', tags,
  summary: 'A run\'s timeline: who did what and when, in plain words', permission: null,
  description: `For a run you can see: in your run scope (workflows.view_runs, or workflows.view_queue and involved / an explicit workflow View grant), or one whose progress you may follow (you started it, your form submission started it, you have a task in it, or you are invited to view one of its tasks). Not found otherwise; API-key workflow allowlists apply. Returns ${TIMELINE_DESCRIPTION}`,
  params: idParams, response: itemResponse('timeline'),
  cli: { resource: 'runs', verb: 'timeline', positional: ['id'] },
})

export const getTaskTimelineEndpoint = defineEndpoint({
  method: 'GET', path: '/tasks/{id}/timeline', operationId: 'getTaskTimeline', tags,
  summary: 'A task\'s timeline: its run\'s story, or the task\'s own history', permission: null,
  description: `A workflow task opens its run's timeline (focus_task_id set) when you may see the run; otherwise — and for a standalone task — the task's own history (created, assigned, accepted, comments, subtasks, attachments, invites, completed) when you can view the task (its people, their managers, a workflow manager, the assigner, tasks.view_all or an invited viewer). Not found otherwise. Returns ${TIMELINE_DESCRIPTION}`,
  params: idParams, response: itemResponse('timeline'),
  cli: { resource: 'tasks', verb: 'timeline', positional: ['id'] },
})

export const timelineEndpoints = [getRunTimelineEndpoint, getTaskTimelineEndpoint]
