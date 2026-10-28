import { Client } from 'pg'
import { getProviderConfig } from '@/lib/config'
import { databaseUrl } from '@/lib/config/bootstrap'
import { createServiceClient } from '@/lib/cron-auth'
import { runTick, type TickSummary } from '@/lib/jobs/tick'
import { pgCronStatus } from '@/lib/providers/scheduler/pg-cron'
import { schedulerBoolOption, schedulerOption, type SchedulerOptions } from '@/lib/providers/scheduler/options'
import { AdvisoryLockElector, LeaseElector, type LeaderElector } from './leader'
import { SchedulerWorker, type TickRequest } from './worker'
import { pgConnectionConfig } from '@/lib/providers/db/pg-auth'

/**
 * Wiring for the worker scheduler: builds a SchedulerWorker from the instance
 * config and starts it once per process — from instrumentation.ts (inside the
 * Next.js server) or from scripts/worker.ts (`usertasks worker`).
 */

const globalRef = globalThis as typeof globalThis & { __usertasksScheduler?: SchedulerWorker }

/** Session connection for leader election: scheduler.database_url, else DATABASE_URL. */
export function electionDatabaseUrl(options: SchedulerOptions): string | undefined {
  return schedulerOption(options, 'database_url') ?? databaseUrl()
}

export function createElector(options: SchedulerOptions): LeaderElector {
  const url = electionDatabaseUrl(options)
  return url ? new AdvisoryLockElector({ connectionString: url }) : new LeaseElector()
}

function describeSummary(summary: TickSummary): string {
  if (summary.skipped) return `skipped (${summary.skipped})`
  const ran = summary.jobs.filter((job) => job.status !== 'disabled')
  const failed = ran.filter((job) => job.status === 'error' || job.status === 'timeout')
  return `${ran.length} job(s) ran${failed.length ? `, ${failed.map((job) => `${job.name}: ${job.status}`).join(', ')}` : ''} in ${summary.duration_ms} ms`
}

export async function runWorkerTick(request: TickRequest): Promise<TickSummary> {
  const summary = await runTick({
    supabase: createServiceClient(),
    minute: request.minute,
    budgetMs: request.budgetMs,
    keepLock: request.keepLock,
    lockTtlSeconds: request.lockTtlSeconds,
    holder: `worker-${process.pid}-${request.minute.toISOString()}`,
  })
  if (summary.due.length || summary.skipped) console.log(`[scheduler] tick ${summary.minute}: ${describeSummary(summary)}`)
  return summary
}

export function createSchedulerWorker(options: SchedulerOptions): SchedulerWorker {
  return new SchedulerWorker({ elector: createElector(options), tick: runWorkerTick })
}

/**
 * Logs a warning when pg_cron still schedules the tick while another
 * scheduler provider is active (both would call the tick; the lease keeps
 * them from double-running a minute, but pg_cron should be removed).
 * Needs a direct database connection; silently does nothing without one.
 */
export async function warnIfPgCronStillScheduled(providerId: string, options: SchedulerOptions): Promise<boolean> {
  if (providerId === 'pg_cron') return false
  const url = electionDatabaseUrl(options)
  if (!url) return false
  const client = new Client(pgConnectionConfig(url, { application_name: 'usertasks-scheduler', connectionTimeoutMillis: 10_000 }))
  client.on('error', () => undefined)
  try {
    await client.connect()
    const status = await pgCronStatus(client)
    if (status.installed) {
      console.warn(
        `[scheduler] SCHEDULER_PROVIDER=${providerId} but pg_cron still schedules ${status.jobs.map((job) => job.jobname).join(', ')}. ` +
          'Remove them with `npm run scheduler -- uninstall-pg-cron` (or the admin CLI).',
      )
      return true
    }
    return false
  } catch {
    return false
  } finally {
    await client.end().catch(() => undefined)
  }
}

/**
 * Starts the in-process worker when SCHEDULER_PROVIDER=worker and
 * scheduler.in_process isn't false. Idempotent per process. Returns the
 * worker, or null when this process shouldn't run one.
 */
export async function startSchedulerWorker({ force = false }: { force?: boolean } = {}): Promise<SchedulerWorker | null> {
  if (globalRef.__usertasksScheduler?.started) return globalRef.__usertasksScheduler
  const config = await getProviderConfig('scheduler')
  if (config.id !== 'worker' && !force) {
    void warnIfPgCronStillScheduled(config.id, config.options)
    return null
  }
  if (!force && !schedulerBoolOption(config.options, 'in_process', true)) return null
  const worker = createSchedulerWorker(config.options)
  globalRef.__usertasksScheduler = worker
  worker.start()
  const mode = electionDatabaseUrl(config.options) ? 'advisory lock' : 'tick lease'
  console.log(`[scheduler] worker started (leader election: ${mode})`)
  void warnIfPgCronStillScheduled('worker', config.options)
  return worker
}

export async function stopSchedulerWorker(): Promise<void> {
  const worker = globalRef.__usertasksScheduler
  globalRef.__usertasksScheduler = undefined
  await worker?.stop()
}
