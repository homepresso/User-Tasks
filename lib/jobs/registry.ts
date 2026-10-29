import type { SupabaseClient } from '@supabase/supabase-js'
import { processWorkflowQueueBatch } from '@/lib/workflow-queue-processor'
import { kickQueueProcessor } from '@/lib/process-queue'
import { processWorkflowSlaTriggers } from '@/lib/workflow-sla'
import { processDeletionQueueBatch } from '@/lib/deletion-queue'
import { enqueueScheduledSyncs, processAllPendingPushes, processSyncRuns } from '@/lib/github-sync/push'
import { processDeploymentQueue } from '@/lib/github-sync/deploy'
import { enqueueScheduledDirectorySyncs, processDirectorySyncRuns } from '@/lib/directory-sync/sync'
import { runShipper } from '@/lib/log-export/shipper'
import { processAgentQueueBatch } from '@/lib/jobs/agent-queue'
import { processScheduledWorkflows } from '@/lib/jobs/schedules'
import { processTaskReminders } from '@/lib/jobs/reminders'
import { processTaskEscalations } from '@/lib/jobs/escalations'
import { processRetentionPolicies } from '@/lib/jobs/retention'
import { cleanupExpiredLogs } from '@/lib/jobs/cleanup-logs'
import { refreshExpiringConnectorTokens } from '@/lib/jobs/oauth-refresh'
import { sweepCacheStore } from '@/lib/jobs/cache-sweep'
import { runHousekeepingJob } from '@/lib/jobs/housekeeping'
import { hasDueUserJobs, processUserJobs, purgeExpiredUserJobs } from '@/lib/user-jobs/runner'
import { runProviderSwitchesJob } from '@/lib/jobs/provider-switches'
import { purgeFormFiles } from '@/lib/services/form-files'
import { getProviderConfig } from '@/lib/config'

/**
 * The canonical list of scheduled background jobs.
 *
 * pg_cron runs ONE job, `usertasks-tick`, every minute
 * (supabase/migrations/20261103100000_cron_consolidation.sql). It calls
 * /api/cron/tick, which runs the jobs below that are due in that minute
 * in-process (lib/jobs/tick.ts). Each job also keeps its own HTTP endpoint
 * (`endpoint`) for external schedulers, in-app kicks and manual runs.
 *
 * Cadences are UTC and deterministic from the minute: `every: 5` is due when
 * minutes-since-epoch % 5 === 0 (:00, :05, …); `daily: '03:00'` is due at
 * 03:00, and is caught up later the same day (within DAILY_CATCH_UP_MS) if
 * that tick was missed.
 */

export type Cadence = { every: number } | { daily: string }

/** A boolean per feature from public.cron_tick_probe(); a missing key means "unknown". */
export type Probe = Record<string, boolean>

export type JobContext = {
  supabase: SupabaseClient
  /** The tick's minute (UTC, seconds zeroed). */
  minute: Date
  /** Epoch ms by which the job should stop starting new work. */
  deadline: number
  /** Feature probe, loaded once per tick; `{}` when unavailable. */
  probe: () => Promise<Probe>
}

export type JobDefinition = {
  name: string
  cadence: Cadence
  /** Endpoint that runs the same work on its own (backwards compatible). */
  endpoint: string
  /** Time budget in ms; the tick also caps it at what is left of its own budget. */
  budgetMs: number
  /** Cheap check: false skips the run (feature not configured, queue empty). */
  isEnabled: (ctx: JobContext) => Promise<boolean>
  run: (ctx: JobContext) => Promise<unknown>
}

/** A daily job whose slot was missed still runs if a tick sees it within this window. */
export const DAILY_CATCH_UP_MS = 6 * 60 * 60 * 1000

const always = async () => true

/**
 * isEnabled from a probe key. Unknown (probe RPC missing or failed, key
 * absent) counts as enabled, so a database without the consolidation
 * migration behaves like before: every due job runs.
 */
function probed(...keys: string[]) {
  return async (ctx: JobContext) => {
    const probe = await ctx.probe()
    return keys.some((key) => probe[key] !== false)
  }
}

/** ms left before the job's deadline, at least `min`. */
const remaining = (ctx: JobContext, min = 1000) => Math.max(min, ctx.deadline - Date.now())

export const JOBS: JobDefinition[] = [
  // ── Every minute ────────────────────────────────────────────────────────
  {
    name: 'process-schedules',
    cadence: { every: 1 },
    endpoint: '/api/cron/process-schedules',
    budgetMs: 20_000,
    isEnabled: probed('schedules'),
    run: (ctx) => processScheduledWorkflows({ supabase: ctx.supabase, now: new Date() }),
  },
  {
    name: 'process-workflows',
    cadence: { every: 1 },
    endpoint: '/api/workflows/process',
    budgetMs: 45_000,
    isEnabled: probed('workflow_queue'),
    run: async (ctx) => {
      const result = await processWorkflowQueueBatch({ batchSize: 20, budgetMs: remaining(ctx) })
      if (result.more) kickQueueProcessor()
      return { processed: result.processed, released: result.released, budget_exhausted: result.budget_exhausted, more: result.more }
    },
  },
  {
    name: 'process-agents',
    cadence: { every: 1 },
    endpoint: '/api/agents/process',
    budgetMs: 30_000,
    isEnabled: probed('agent_queue'),
    run: async (ctx) => {
      const result = await processAgentQueueBatch({ supabase: ctx.supabase, batchSize: 10, deadline: ctx.deadline })
      return { processed: result.processed }
    },
  },
  {
    name: 'github-sync-push',
    cadence: { every: 1 },
    endpoint: '/api/github-sync/push',
    budgetMs: 40_000,
    isEnabled: probed('github_sync'),
    run: async (ctx) => {
      // Enqueue due scheduled runs first so this same run executes them.
      const scheduled = await enqueueScheduledSyncs(ctx.supabase).catch(() => 0)
      const runs = await processSyncRuns(ctx.supabase, `push-worker-${crypto.randomUUID().slice(0, 8)}`)
      const result = await processAllPendingPushes(ctx.supabase)
      return { scheduled, runs, ...result }
    },
  },
  {
    name: 'github-sync-deploy',
    cadence: { every: 1 },
    endpoint: '/api/github-sync/deployments/process',
    budgetMs: 40_000,
    isEnabled: probed('github_deployments'),
    run: async (ctx) => ({ processed: await processDeploymentQueue(ctx.supabase, `deploy-${crypto.randomUUID().slice(0, 8)}`) }),
  },
  {
    name: 'ship-events',
    cadence: { every: 1 },
    endpoint: '/api/cron/ship-events',
    // Drains due destinations, re-polling for new events, for most of the minute.
    budgetMs: 45_000,
    isEnabled: probed('log_destinations'),
    run: async (ctx) => {
      const summary = await runShipper({ supabase: ctx.supabase, budgetMs: remaining(ctx) })
      return { claims: summary.claims, events_sent: summary.events_sent, failures: summary.failures }
    },
  },
  {
    // Provider switches queued from Settings → Infrastructure (and interrupted
    // ones): starts the background runner in this process (lib/jobs/provider-switches.ts).
    name: 'provider-switches',
    cadence: { every: 1 },
    endpoint: '/api/cron/provider-switches',
    // A chunk of a database switch on serverless; elsewhere it only starts the runner.
    budgetMs: 45_000,
    isEnabled: always,
    run: (ctx) => runProviderSwitchesJob({ supabase: ctx.supabase, deadline: ctx.deadline }),
  },

  {
    // Background jobs (exports, imports, bulk actions; lib/user-jobs/runner.ts)
    // whose in-request start was lost, retries that are due, the next chunk of
    // long jobs and jobs whose invocation died (expired lease).
    name: 'user-jobs',
    cadence: { every: 1 },
    endpoint: '/api/cron/user-jobs',
    budgetMs: 45_000,
    isEnabled: (ctx) => hasDueUserJobs(ctx.supabase),
    run: (ctx) => processUserJobs({ supabase: ctx.supabase, budgetMs: remaining(ctx) - 2_000 }),
  },

  // ── Every 5 minutes ─────────────────────────────────────────────────────
  {
    name: 'process-sla',
    cadence: { every: 5 },
    endpoint: '/api/cron/process-sla',
    budgetMs: 30_000,
    isEnabled: probed('sla'),
    run: (ctx) => processWorkflowSlaTriggers({ supabase: ctx.supabase }),
  },
  {
    name: 'process-reminders',
    cadence: { every: 5 },
    endpoint: '/api/cron/process-reminders',
    budgetMs: 30_000,
    isEnabled: probed('reminders'),
    run: (ctx) => processTaskReminders({ supabase: ctx.supabase }),
  },
  {
    name: 'process-escalations',
    cadence: { every: 5 },
    endpoint: '/api/cron/process-escalations',
    budgetMs: 30_000,
    isEnabled: probed('escalations'),
    run: (ctx) => processTaskEscalations({ supabase: ctx.supabase }),
  },

  // ── Every 10 minutes ────────────────────────────────────────────────────
  {
    name: 'process-deletions',
    cadence: { every: 10 },
    endpoint: '/api/deletions/process',
    budgetMs: 40_000,
    isEnabled: probed('deletions'),
    run: async () => {
      const result = await processDeletionQueueBatch({ batchSize: 10 })
      return { processed: result.processed }
    },
  },
  {
    name: 'directory-sync',
    cadence: { every: 10 },
    endpoint: '/api/directory-sync/process',
    budgetMs: 45_000,
    isEnabled: probed('directory_sync'),
    run: async (ctx) => {
      const scheduled = await enqueueScheduledDirectorySyncs(ctx.supabase).catch(() => 0)
      const runs = await processDirectorySyncRuns(ctx.supabase, `directory-worker-${crypto.randomUUID().slice(0, 8)}`)
      return { scheduled, runs }
    },
  },
  {
    name: 'oauth-refresh',
    cadence: { every: 10 },
    endpoint: '/api/connectors/oauth/refresh',
    budgetMs: 30_000,
    isEnabled: probed('oauth_connectors'),
    run: (ctx) => refreshExpiringConnectorTokens({ supabase: ctx.supabase }),
  },
  {
    // Expired rows of the postgres cache store (CACHE_PROVIDER=postgres only).
    name: 'cache-sweep',
    cadence: { every: 10 },
    endpoint: '/api/cron/cache-sweep',
    budgetMs: 20_000,
    isEnabled: always,
    run: async (ctx) => ((await getProviderConfig('cache')).id === 'postgres'
      ? sweepCacheStore({ supabase: ctx.supabase, deadline: ctx.deadline })
      : { skipped: 'cache provider is not postgres' }),
  },

  // ── Every 15 minutes ────────────────────────────────────────────────────
  {
    // Expired background-job results: the rows and their stored files.
    name: 'user-jobs-cleanup',
    cadence: { every: 15 },
    endpoint: '/api/cron/user-jobs-cleanup',
    budgetMs: 20_000,
    isEnabled: always,
    run: (ctx) => purgeExpiredUserJobs({ supabase: ctx.supabase, deadline: ctx.deadline }),
  },
  {
    // Form attachments: uploads never submitted (pending past
    // FORM_ATTACHMENT_PENDING_HOURS) and files whose task and submission are
    // gone — rows and stored objects (lib/services/form-files.ts).
    name: 'form-files-cleanup',
    cadence: { every: 15 },
    endpoint: '/api/cron/form-files-cleanup',
    budgetMs: 20_000,
    isEnabled: always,
    run: (ctx) => purgeFormFiles({ supabase: ctx.supabase, deadline: ctx.deadline }),
  },
  {
    // System-table purge (lib/jobs/housekeeping.ts). The database decides
    // whether the configured interval is due; with pg_cron it schedules
    // itself and this skips.
    name: 'housekeeping',
    cadence: { every: 15 },
    endpoint: '/api/cron/housekeeping',
    budgetMs: 30_000,
    isEnabled: always,
    run: (ctx) => runHousekeepingJob({ supabase: ctx.supabase, budgetMs: remaining(ctx) - 2_000 }),
  },

  // ── Daily (UTC) ─────────────────────────────────────────────────────────
  {
    name: 'process-retention',
    cadence: { daily: '03:00' },
    endpoint: '/api/cron/process-retention-policies',
    budgetMs: 45_000,
    isEnabled: always,
    run: (ctx) => processRetentionPolicies({ supabase: ctx.supabase }),
  },
  {
    name: 'cleanup-logs',
    cadence: { daily: '04:00' },
    endpoint: '/api/cron/cleanup-logs',
    budgetMs: 45_000,
    isEnabled: always,
    run: (ctx) => cleanupExpiredLogs({ supabase: ctx.supabase }),
  },
  {
    // The housekeeping pass with a larger budget, whatever the interval (catch-up).
    name: 'housekeeping-daily',
    cadence: { daily: '03:30' },
    endpoint: '/api/cron/housekeeping',
    budgetMs: 45_000,
    isEnabled: always,
    run: (ctx) => runHousekeepingJob({ supabase: ctx.supabase, daily: true, budgetMs: remaining(ctx) - 2_000 }),
  },
]

// ── Due calculation (pure) ──────────────────────────────────────────────────

const MINUTE_MS = 60_000

/** The minute containing `date` (UTC, seconds and ms zeroed). */
export function floorToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / MINUTE_MS) * MINUTE_MS)
}

function parseDaily(hhmm: string): { hours: number; minutes: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
  if (!match) throw new Error(`Invalid daily time "${hhmm}" (expected HH:MM, UTC)`)
  return { hours: Number(match[1]), minutes: Number(match[2]) }
}

/** The daily slot on the UTC day of `minute`. */
export function dailySlot(cadence: { daily: string }, minute: Date): Date {
  const { hours, minutes } = parseDaily(cadence.daily)
  return new Date(Date.UTC(minute.getUTCFullYear(), minute.getUTCMonth(), minute.getUTCDate(), hours, minutes))
}

/**
 * Whether a job with `cadence` is due in `minute`.
 *
 * - `{ every: n }` (n divides 60): due when minutes since the epoch are a
 *   multiple of n, i.e. at :00, :n, :2n … of every hour.
 * - `{ daily: 'HH:MM' }`: due at that minute. With run history
 *   (`lastStartedAt` is a Date or null = never), also due later the same UTC
 *   day, within DAILY_CATCH_UP_MS, when it has not started since the slot —
 *   so a tick skipped by the overlap lock or an outage does not lose a day.
 *   Without history (`undefined`) only the exact minute counts.
 */
export function isDue(cadence: Cadence, minute: Date, lastStartedAt?: Date | null): boolean {
  const m = floorToMinute(minute)
  if ('every' in cadence) {
    const n = cadence.every
    if (!Number.isInteger(n) || n < 1 || 60 % n !== 0) throw new Error(`Invalid cadence every ${n} (must divide 60)`)
    return Math.round(m.getTime() / MINUTE_MS) % n === 0
  }
  const slot = dailySlot(cadence, m)
  const sinceSlot = m.getTime() - slot.getTime()
  if (sinceSlot === 0) return true
  if (lastStartedAt === undefined || sinceSlot < 0 || sinceSlot >= DAILY_CATCH_UP_MS) return false
  return lastStartedAt === null || lastStartedAt.getTime() < slot.getTime()
}

/** Jobs due in `minute`, in registry order. `lastStarted` is undefined when run history is unavailable. */
export function dueJobs(
  minute: Date,
  lastStarted?: Map<string, Date | null>,
  jobs: JobDefinition[] = JOBS,
): JobDefinition[] {
  return jobs.filter((job) => isDue(job.cadence, minute, lastStarted ? (lastStarted.get(job.name) ?? null) : undefined))
}

/** Human-readable cadence ("every minute", "every 5 min", "daily 03:00 UTC"). */
export function describeCadence(cadence: Cadence): string {
  if ('every' in cadence) return cadence.every === 1 ? 'every minute' : `every ${cadence.every} min`
  return `daily ${cadence.daily} UTC`
}
