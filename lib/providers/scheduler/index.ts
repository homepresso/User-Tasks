import { getProviderConfig } from '@/lib/config'
import { DEFAULT_PROVIDERS, type ProviderId } from '@/lib/config/schema'
import { pickProvider } from '../registry'

/**
 * SchedulerProvider: what triggers the recurring jobs (queue processors,
 * retention, SLA, log shipping, …). Whatever the provider, the work is the
 * same: once a minute, run the jobs from lib/jobs/registry.ts that are due
 * (lib/jobs/tick.ts). The providers only differ in who calls it:
 *
 *  - pg_cron (default)  pg_cron + pg_net in the database POST /api/cron/tick
 *                       every minute with the cron secret from Vault
 *                       (./pg-cron installs the job).
 *  - worker             an in-process loop (Next.js instrumentation, or the
 *                       `usertasks worker` command) calls the registry
 *                       directly; replicas elect one leader (lib/scheduler).
 *  - external           something outside calls POST /api/cron/tick: OS cron,
 *                       systemd timer, Kubernetes CronJob, Vercel Cron, Azure
 *                       Container Apps Jobs / Functions timer, Google Cloud
 *                       Scheduler (OIDC) … (lib/scheduler/tick-auth.ts).
 *
 * Vault is only needed by pg_cron.
 */
export interface SchedulerProvider {
  readonly id: ProviderId<'scheduler'>
  /** Runs fully on-premises / air-gapped (plan: provider catalogue). */
  readonly onPrem: boolean
  /** Where schedules live: the database (pg_cron), this process, or an outside cron. */
  readonly runsIn: 'database' | 'process' | 'external'
}

export const pgCronSchedulerProvider: SchedulerProvider = {
  id: 'pg_cron',
  // pg_cron on a self-managed Postgres needs no outside service.
  onPrem: true,
  runsIn: 'database',
}

export const workerSchedulerProvider: SchedulerProvider = {
  id: 'worker',
  onPrem: true,
  runsIn: 'process',
}

export const externalSchedulerProvider: SchedulerProvider = {
  id: 'external',
  // OS cron / systemd / Kubernetes CronJob are on-prem; cloud schedulers are options too.
  onPrem: true,
  runsIn: 'external',
}

export function resolveSchedulerProvider(id: ProviderId<'scheduler'> = DEFAULT_PROVIDERS.scheduler): SchedulerProvider {
  return pickProvider('scheduler', id, {
    pg_cron: () => pgCronSchedulerProvider,
    worker: () => workerSchedulerProvider,
    external: () => externalSchedulerProvider,
  })
}

export async function getSchedulerProvider(): Promise<SchedulerProvider> {
  return resolveSchedulerProvider((await getProviderConfig('scheduler')).id)
}
