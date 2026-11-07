import type { McpToolServer } from '../server'
import type { McpContext } from '../server'
import { mcpErr, mcpOk } from '../server'
import { z } from 'zod'
import { fromMcpContext } from '@/lib/services/context'
import * as home from '@/lib/services/home'
import { getHomeActivityStats } from '@/lib/services/home-stats'
import { messageOf } from './_util'
import { HOME_WIDGET_IDS } from '@/lib/home/layout'

/*
 * Home tools: the acting person's metrics, tasks, queue (claim), followed
 * runs, submissions with their runs' progress, the submitter-safe run
 * progress, favourite forms and the auto-follow preference. Thin wrappers
 * over lib/services/home (access rules live there). Personal: they need a
 * key bound to a user.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const page = (limit?: number, offset?: number) => ({ limit: Math.max(1, Math.min(limit ?? 25, 100)), offset: Math.max(0, offset ?? 0) })
const status = z.enum(['all', 'active', 'completed', 'failed']).optional().describe('all (default), active, completed, failed')
const STAGES = 'Each has status, status_label ("Waiting on Manager approval"), stages [{ name, assignees, team, since, due_date }] and people.'

export function registerHomeTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('home_metrics', 'The acting person\'s Home cards: tasks { open, overdue, sla_breached, completed_30d, queue }, submissions { in_progress, completed_30d, submitted_30d }, following { active, updated_today, total }.', {},
    async () => run(() => home.getHomeMetrics(svc())))

  server.tool('home_stats', 'The acting person\'s activity over 7, 30 or 90 days (Home → My activity): tasks completed per day / week, decisions with approval rate (approve ÷ decisions), time to complete and to pick up (median, p90, seconds), on time vs late (due date, else the run SLA), top processes, and their form submissions by process status with the median end-to-end time.', {
    period: z.enum(['7d', '30d', '90d']).optional().describe('7d, 30d (default) or 90d'),
    timezone: z.string().optional().describe('IANA time zone for day / week buckets (default: profile, else UTC)'),
  }, async (args) => run(() => getHomeActivityStats(svc(), { period: args.period, timezone: args.timezone })))

  server.tool('home_tasks', 'The acting person\'s open tasks with process name, stage (step name), due date, overdue, SLA and priority.', {
    search: z.string().optional().describe('Title contains'),
    sort: z.enum(['due', 'priority', 'newest']).optional().describe('due (default), priority, newest'),
    limit: z.number().optional(), offset: z.number().optional(),
  }, async (args) => run(() => home.listMyTasks(svc(), { search: args.search, sort: args.sort }, page(args.limit, args.offset))))

  server.tool('home_queue', 'Tasks the acting person can take: waiting for their acceptance (action accept → tasks_respond) or unassigned in their teams (action claim → tasks_claim).', {
    search: z.string().optional().describe('Title contains'),
    limit: z.number().optional(), offset: z.number().optional(),
  }, async (args) => run(() => home.listQueueTasks(svc(), { search: args.search }, page(args.limit, args.offset))))

  server.tool('tasks_claim', 'Claim an unassigned team task: a member of its team becomes its assignee (409 if someone claimed it first).', {
    task_id: z.string().describe('Task ID'),
  }, async (args) => run(() => home.claimTask(svc(), args.task_id)))

  server.tool('home_submissions', `Forms the acting person submitted, newest first, with the process each started and where it is now. ${STAGES}`, {
    search: z.string().optional().describe('Form or process name contains'),
    status, limit: z.number().optional(), offset: z.number().optional(),
  }, async (args) => run(() => home.listMySubmissions(svc(), { search: args.search, status: args.status }, page(args.limit, args.offset))))

  server.tool('home_following', `Workflow runs the acting person follows (active first). ${STAGES}`, {
    search: z.string().optional().describe('Process name or run title contains'),
    status, limit: z.number().optional(), offset: z.number().optional(),
  }, async (args) => run(() => home.listFollowedRuns(svc(), { search: args.search, status: args.status }, page(args.limit, args.offset))))

  server.tool('home_follow', 'Follow (follow: true) or unfollow (false) a workflow run. Following needs a run you started, your form submission started, you have a task in, or workflows.view_runs.', {
    run_id: z.string().describe('Run ID'),
    follow: z.boolean().optional().describe('true (default) to follow, false to unfollow'),
  }, async (args) => run(() => home.setRunFollowed(svc(), args.run_id, args.follow !== false)))

  server.tool('home_run_progress', 'A run\'s progress as its submitter sees it: step names, per-step status, current stages, assignees and dates. Never configs, outputs, variables or form values.', {
    run_id: z.string().describe('Run ID'),
  }, async (args) => run(async () => ({ progress: await home.getRunProgress(svc(), args.run_id) })))

  server.tool('home_favorite_forms', 'The acting person\'s favourite forms they can still open, alphabetical.', {},
    async () => run(async () => ({ forms: await home.listFavoriteForms(svc()) })))

  server.tool('home_favorite_form', 'Star (favorite: true) or unstar (false) a form. Only forms you can open.', {
    form_id: z.string().describe('Form ID'),
    favorite: z.boolean().optional().describe('true (default) to star, false to unstar'),
  }, async (args) => run(() => home.setFormFavorite(svc(), args.form_id, args.favorite !== false)))

  server.tool('home_preferences', 'Read or change the acting person\'s Home preferences. auto_follow_runs (default true): follow the runs they start, form submissions included.', {
    auto_follow_runs: z.boolean().optional().describe('Set auto-follow; omit to read'),
  }, async (args) => run(async () => ({
    preferences: typeof args.auto_follow_runs === 'boolean'
      ? await home.setHomePreferences(svc(), { auto_follow_runs: args.auto_follow_runs })
      : await home.getHomePreferences(svc()),
  })))

  server.tool('home_layout', `Read, save or reset the acting person's Home layout in this workspace: layout { items [{ id, w, h }] (visible widgets in reading order; w = columns of the 12-column grid, h = rows), hidden [ids] }, customised, widgets (ids, titles, min / max sizes). Widget ids: ${HOME_WIDGET_IDS.join(', ')}. Omit layout and reset to read.`, {
    layout: z.object({
      items: z.array(z.object({ id: z.string(), w: z.number(), h: z.number() })).describe('Visible widgets in reading order'),
      hidden: z.array(z.string()).optional().describe('Widgets to hide'),
    }).optional().describe('The layout to save (replaces the current one)'),
    reset: z.boolean().optional().describe('true: back to the default layout'),
  }, async (args) => run(() => (args.reset
    ? home.resetHomeLayout(svc())
    : args.layout ? home.setHomeLayout(svc(), args.layout) : home.getHomeLayout(svc()))))
}
