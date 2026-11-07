/**
 * Home → My activity: the signed-in person's own stats over 7 / 30 / 90 days
 * (tasks completed per day or week, decisions and approval rate, time to
 * complete and to pick up, on time vs late, top processes, and the status of
 * their form submissions). One read, two SQL aggregates
 * (public.home_task_stats, public.home_submission_stats — migration
 * 20261220000000_home_activity_stats.sql); the definitions are in
 * lib/home/activity.ts.
 *
 * Access: personal (ctx.actorId) and in the caller's current workspace only.
 * The task part needs tasks.view_own, the submission part forms.submit; a
 * part the caller has no permission for is null. Reads use the service-role
 * client with explicit tenant / user arguments (the SQL also refuses a
 * signed-in caller asking about someone else).
 */

import { dbError, serviceRoleClient } from './_shared'
import { hasPerm, ServiceError, type ServiceContext } from './context'
import {
  normaliseSubmissionStats, normaliseTaskStats, parseStatsPeriod,
  type HomeActivityStats, type HomeStatsPeriod,
} from '@/lib/home/activity'

/** A time zone name the browser can send ("Pacific/Auckland"); the SQL validates it. */
const TZ_RE = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/

export interface HomeStatsArgs {
  period?: HomeStatsPeriod | string | number
  /** IANA zone for day / week buckets; else the profile's, else UTC. */
  timezone?: string | null
}

export async function getHomeActivityStats(ctx: ServiceContext, args: HomeStatsArgs = {}): Promise<HomeActivityStats> {
  if (!ctx.actorId) throw ServiceError.forbidden('Home is personal: use a credential bound to a user')
  if (!ctx.tenantId) throw ServiceError.validation('Choose a workspace first')
  const period = parseStatsPeriod(args.period)
  const tz = args.timezone && TZ_RE.test(args.timezone) ? args.timezone : null
  const db = await serviceRoleClient(ctx)
  const params = { p_tenant_id: ctx.tenantId, p_user_id: ctx.actorId, p_days: period, p_tz: tz }
  /* eslint-disable @typescript-eslint/no-explicit-any -- untyped RPCs */
  const call = async (fn: string) => {
    const { data, error } = await (db as any).rpc(fn, params)
    if (error) throw dbError(error)
    return data
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const [tasksRaw, subsRaw] = await Promise.all([
    hasPerm(ctx, 'tasks.view_own') ? call('home_task_stats') : Promise.resolve(null),
    hasPerm(ctx, 'forms.submit') ? call('home_submission_stats') : Promise.resolve(null),
  ])
  const tasks = tasksRaw ? normaliseTaskStats(tasksRaw) : null
  const submissions = subsRaw ? normaliseSubmissionStats(subsRaw) : null
  return { period, timezone: tasks?.period.timezone ?? submissions?.timezone ?? tz ?? 'UTC', tasks, submissions }
}
