'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import * as home from '@/lib/services/home'

/*
 * Home (/home) writes: follow / unfollow a run, star / unstar a form, claim
 * a team task and the auto-follow preference. Thin wrappers over
 * lib/services/home (access checks live there).
 */

function run<T>(label: string, fallback: string, fn: (ctx: Awaited<ReturnType<typeof fromSession>>) => Promise<T>): Promise<ActionResult<T>> {
  return runAction(label, fallback, async () => fn(await fromSession()))
}

export async function setRunFollowed(runId: string, follow: boolean) {
  return run('setRunFollowed', follow ? 'Could not follow the run.' : 'Could not unfollow the run.', (ctx) => home.setRunFollowed(ctx, runId, follow))
}

export async function setFormFavorite(formId: string, favorite: boolean) {
  return run('setFormFavorite', 'Could not update your favourites.', (ctx) => home.setFormFavorite(ctx, formId, favorite))
}

export async function claimTask(taskId: string) {
  return run('claimTask', 'Could not claim the task.', (ctx) => home.claimTask(ctx, taskId))
}

export async function saveHomeLayout(layout: unknown) {
  return run('saveHomeLayout', 'Could not save your layout.', (ctx) => home.setHomeLayout(ctx, layout))
}

export async function resetHomeLayout() {
  return run('resetHomeLayout', 'Could not reset your layout.', (ctx) => home.resetHomeLayout(ctx))
}

export async function setHomePreferences(input: { auto_follow_runs?: boolean; auto_follow_acted_runs?: boolean }) {
  return run('setHomePreferences', 'Could not save the setting.', (ctx) => home.setHomePreferences(ctx, input))
}
