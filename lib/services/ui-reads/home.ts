import { z } from 'zod'
import { resolvePage } from '../_shared'
import * as home from '../home'
import { getHomeActivityStats } from '../home-stats'
import { defineRead, id, NO_ARGS } from './define'

/**
 * Home (/home) reads. Each card and each tab is its own read so they load
 * independently (lib/services/home.ts has the rules: everything is the
 * caller's own; runs follow can_view_run_progress, forms can_open_form).
 */

const listArgs = z.object({
  search: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(100_000).optional(),
})
const progressFilter = z.enum(['all', 'active', 'completed', 'failed']).optional()

export const reads = {
  'home.taskMetrics': defineRead({ args: NO_ARGS, perm: 'tasks.view_own', run: async (ctx) => home.getTaskMetrics(ctx) }),
  'home.submissionMetrics': defineRead({ args: NO_ARGS, perm: 'forms.submit', run: async (ctx) => home.getSubmissionMetrics(ctx) }),
  'home.followMetrics': defineRead({ args: NO_ARGS, run: async (ctx) => home.getFollowMetrics(ctx) }),
  /** The side menu's badges (My tasks, Task queue, Task tracker) in one read. */
  'home.navCounts': defineRead({ args: NO_ARGS, run: async (ctx) => home.getNavCounts(ctx) }),

  'home.myTasks': defineRead({
    // includeQueued: the unified list (queued tasks with their action); queuedOnly: just those.
    // columnSort: the list's header sort; includeClosed: "Show completed".
    args: listArgs.extend({
      sort: z.enum(['due', 'priority', 'newest']).optional(), includeQueued: z.boolean().optional(), queuedOnly: z.boolean().optional(),
      columnSort: z.object({ key: z.enum(['title', 'status', 'priority', 'due', 'assigned']), dir: z.enum(['asc', 'desc']) }).nullish(),
      includeClosed: z.boolean().optional(),
    }),
    perm: 'tasks.view_own',
    run: async (ctx, args) => home.listMyTasks(ctx, {
      search: args.search, sort: args.sort, include_queued: args.includeQueued, queued_only: args.queuedOnly,
      column_sort: args.columnSort ?? null, include_closed: args.includeClosed,
    }, resolvePage({ limit: args.limit ?? 25, offset: args.offset })),
  }),
  /** @deprecated The app's My tasks (home.myTasks with includeQueued) shows these; kept for existing callers. */
  'home.queue': defineRead({
    args: listArgs,
    perm: 'tasks.view_own',
    run: async (ctx, args) => home.listQueueTasks(ctx, { search: args.search }, resolvePage({ limit: args.limit ?? 25, offset: args.offset })),
  }),
  /** An expanded My tasks / Task queue row: description, key fields, subtasks (loaded on expand). */
  'home.taskDetails': defineRead({
    args: z.object({ id }),
    perm: 'tasks.view_own',
    run: async (ctx, { id: taskId }) => home.getTaskDetails(ctx, taskId),
  }),
  'home.following': defineRead({
    args: listArgs.extend({ status: progressFilter }),
    run: async (ctx, args) => home.listFollowedRuns(ctx, { search: args.search, status: args.status }, resolvePage({ limit: args.limit ?? 25, offset: args.offset })),
  }),
  'home.submissions': defineRead({
    args: listArgs.extend({ status: progressFilter }),
    perm: 'forms.submit',
    run: async (ctx, args) => home.listMySubmissions(ctx, { search: args.search, status: args.status }, resolvePage({ limit: args.limit ?? 25, offset: args.offset })),
  }),
  'home.runProgress': defineRead({ args: z.object({ id }), run: async (ctx, { id: runId }) => home.getRunProgress(ctx, runId) }),
  'home.followedRunIds': defineRead({
    args: z.object({ ids: z.array(id).max(200) }),
    run: async (ctx, { ids }) => home.followedRunIds(ctx, ids),
  }),
  'home.favoriteForms': defineRead({ args: NO_ARGS, run: async (ctx) => home.listFavoriteForms(ctx) }),
  /** My saved form drafts (Home → Favourite forms' Drafts list). */
  'home.formDrafts': defineRead({ args: NO_ARGS, run: async (ctx) => (await import('../form-drafts')).listMyFormDrafts(ctx) }),
  'home.preferences': defineRead({ args: NO_ARGS, run: async (ctx) => home.getHomePreferences(ctx) }),
  /** My Home grid in this workspace (order, sizes, hidden widgets). */
  'home.layout': defineRead({ args: NO_ARGS, run: async (ctx) => home.getHomeLayout(ctx) }),
  'home.activityStats': defineRead({
    args: z.object({ period: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(), timezone: z.string().max(64).optional() }),
    perm: ['tasks.view_own', 'forms.submit'],
    run: async (ctx, args) => getHomeActivityStats(ctx, { period: args.period, timezone: args.timezone }),
  }),
}
