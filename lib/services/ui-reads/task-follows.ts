import { z } from 'zod'
import * as follows from '../task-follows'
import { defineRead, id, NO_ARGS } from './define'

/**
 * Task tracker → Following (lib/services/task-follows.ts has the rules:
 * the caller's own follows; visibility is re-checked on every read).
 */

const TASK_VIEW = ['tasks.view_own', 'tasks.view_all'] as const
const statusList = z.array(z.string().max(50)).max(20)

export const reads = {
  /** The Following tab: my followed tasks in the tracker's row shape. */
  'tasks.following': defineRead({
    args: z.object({
      search: z.string().max(200).optional(),
      status: statusList.optional(),
      priority: statusList.optional(),
      hideCompleted: z.boolean().optional(),
      /** Only tasks shared with me by an invite. */
      sharedOnly: z.boolean().optional(),
    }).optional(),
    perm: TASK_VIEW,
    // The app's Following tab: the tasks of runs I follow too (viaRuns).
    run: async (ctx, args) => follows.listFollowedTasks(ctx, {
      search: args?.search, status: args?.status, priority: args?.priority, hideCompleted: args?.hideCompleted, sharedOnly: args?.sharedOnly, viaRuns: true,
    }),
  }),
  /** The Following tab's badge: followed tasks I can see (total) and how many are open. */
  'tasks.followingCount': defineRead({ args: NO_ARGS, perm: TASK_VIEW, run: async (ctx) => follows.countFollowedTasks(ctx, { viaRuns: true }) }),
  /** Which of these tasks I follow (one read per page of tracker rows, for the bells). */
  'tasks.followedIds': defineRead({
    args: z.object({ ids: z.array(id).max(follows.MAX_FOLLOW_ID_BATCH) }),
    run: async (ctx, { ids }) => follows.followedTaskIds(ctx, ids),
  }),
}
