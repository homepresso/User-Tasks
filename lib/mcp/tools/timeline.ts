import type { McpContext, McpToolServer } from '../server'
import { mcpErr, mcpOk } from '../server'
import { z } from 'zod'
import { fromMcpContext } from '@/lib/services/context'
import { messageOf } from './_util'

/*
 * Timeline for agents (lib/services/run-timeline.ts): "what has happened on
 * this request?" — the same service as GET /workflows/runs/{id}/timeline and
 * GET /tasks/{id}/timeline. Registered with the task tools.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const SHAPE = 'Returns { timeline: { kind, detail (full / progress / task), header { workflow, title, reference, status_label, started_by, started_how, duration_ms, current }, events [{ kind, category, at, actor, on_behalf_of, via, title, step, body, note, badge, fields, children, since_previous_ms }] oldest first, ending with how it ended or where it is now, live } }. Only what the caller may see: comments and notes for tasks they can open or are invited to view.'

export function registerTimelineTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)
  const load = () => import('@/lib/services/run-timeline')

  server.tool('workflows_run_timeline', `A workflow run as a readable timeline: when it started and by whom, who each step went to, accepts / holds, reassignments, comments, approvals (outcome, by whom, on whose behalf, notes), notable automatic steps (emails, data writes, decisions, waits, sub-workflows, errors — routine steps collapsed into "N automatic steps"), how it ended and where it is now. For runs in the caller's run scope or whose progress they may follow; not found otherwise. ${SHAPE}`, {
    run_id: z.string().describe('Workflow run ID'),
  }, async (args) => run(async () => ({ timeline: await (await load()).getRunTimeline(svc(), args.run_id) })))

  server.tool('tasks_timeline', `A task's timeline: its workflow run's timeline (focus_task_id set) when the caller may see the run, else the task's own history (created, assigned, accepted, comments, subtasks, attachments, invites, completed). Anyone who can view the task, invited viewers included. ${SHAPE}`, {
    task_id: z.string().describe('The task'),
  }, async (args) => run(async () => ({ timeline: await (await load()).getTaskTimeline(svc(), args.task_id) })))
}
