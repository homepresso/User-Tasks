import { appUrlOrLocalhost, processorSecret } from '@/lib/config/bootstrap'
import { installPgCron, pgCronStatus, uninstallPgCron, type PgCronStatus } from '@/lib/providers/scheduler/pg-cron'
import { schedulerOption } from '@/lib/providers/scheduler/options'
import type { AreaSwitch, PreflightCheck } from './types'

/**
 * scheduler: pg_cron ⇄ worker ⇄ external.
 *  - to pg_cron: (re)install the usertasks-tick + housekeeping jobs and the
 *    Vault secrets they read (base URL, cron secret; --no-secrets keeps
 *    the existing ones);
 *  - away from pg_cron: unschedule them (Vault secrets are left in place,
 *    so rollback can re-install the jobs without asking for them again).
 * Rollback restores the pg_cron job set as it was before the switch.
 */

async function hasSchema(db: { query: (q: string, v?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }, name: string) {
  const { rows } = await db.query('SELECT to_regnamespace($1) IS NOT NULL AS ok', [name])
  return rows[0]?.ok === true
}

export const schedulerSwitch: AreaSwitch = {
  area: 'scheduler',
  writesProviderSetting: true,
  supports: () => null,
  async preflight(ctx) {
    const checks: PreflightCheck[] = []
    const status = await pgCronStatus(ctx.db)
    checks.push({ name: 'pg_cron', severity: 'ok', detail: status.jobs.length ? `scheduled now: ${status.jobs.map((j) => j.jobname).join(', ')}` : 'no usertasks jobs scheduled' })
    if (ctx.to === 'pg_cron') {
      if (!(await hasSchema(ctx.db, 'cron'))) checks.push({ name: 'extension', severity: 'error', detail: 'pg_cron is not installed in this database (CREATE EXTENSION pg_cron, or choose worker / external)' })
      if (!(await hasSchema(ctx.db, 'app_cron'))) checks.push({ name: 'app_cron', severity: 'error', detail: 'app_cron schema missing: apply the migrations first' })
      const noSecrets = ctx.options.flags['no-secrets'] === true
      if (!noSecrets) {
        if (!processorSecret()) checks.push({ name: 'secret', severity: 'error', detail: 'CRON_SECRET (or WORKFLOW_PROCESSOR_SECRET) must be set, or pass --no-secrets to keep the Vault secrets' })
        if (!(await hasSchema(ctx.db, 'vault'))) checks.push({ name: 'vault', severity: 'error', detail: 'Supabase Vault is not installed: pass --no-secrets only if app_cron.invoke_endpoint gets its URL and secret another way' })
      }
    } else if (ctx.to === 'external') {
      checks.push(processorSecret()
        ? { name: 'secret', severity: 'ok', detail: 'CRON_SECRET set (or configure OIDC / Entra callers)' }
        : { name: 'secret', severity: 'warn', detail: 'CRON_SECRET not set: the external scheduler must authenticate with OIDC / Entra tokens' })
    } else if (ctx.to === 'worker') {
      checks.push(ctx.config.bootstrap.databaseUrl || schedulerOption(ctx.targetConfig.providers.scheduler.options, 'database_url')
        ? { name: 'leader election', severity: 'ok', detail: 'advisory lock over DATABASE_URL / SCHEDULER_DATABASE_URL' }
        : { name: 'leader election', severity: 'warn', detail: 'no DATABASE_URL: replicas elect through the tick lease (fine for one replica)' })
    }
    return checks
  },
  async backup(ctx) {
    const status = await pgCronStatus(ctx.db)
    ctx.rollbackData.pgCron = { installed: status.installed, jobs: status.jobs.map((j) => j.jobname) }
    return []
  },
  steps(ctx) {
    if (ctx.to === 'pg_cron') {
      const noSecrets = ctx.options.flags['no-secrets'] === true
      const baseUrl = (typeof ctx.options.flags['base-url'] === 'string' && ctx.options.flags['base-url']) ||
        schedulerOption(ctx.targetConfig.providers.scheduler.options, 'pg_cron_base_url') || appUrlOrLocalhost()
      return [{
        id: 'install-pg-cron',
        title: 'Install the pg_cron jobs',
        plan: async () => `schedule usertasks-tick and housekeeping${noSecrets ? '' : `, Vault app_base_url=${baseUrl} and cron_secret`}`,
        async run() {
          const result = await installPgCron(ctx.db, noSecrets ? {} : { baseUrl, secret: processorSecret() })
          return `scheduled ${result.jobs.join(', ')}${Object.keys(result.vault).length ? `; Vault ${Object.entries(result.vault).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}`
        },
      }]
    }
    if (ctx.to === 'worker') {
      ctx.notes.push('The in-process worker starts when the app starts: restart the app (or run the worker on its own — `node worker.cjs` in the Docker image, `npm run worker` in a checkout — with SCHEDULER_IN_PROCESS=false on web replicas).')
    } else {
      ctx.notes.push(`Point the external scheduler at POST ${appUrlOrLocalhost().replace(/\/+$/, '')}/api/cron/tick every minute (Authorization: Bearer $CRON_SECRET, or OIDC / Entra tokens).`)
    }
    return [{
      id: 'uninstall-pg-cron',
      title: 'Unschedule the pg_cron jobs',
      plan: async () => {
        const status = await pgCronStatus(ctx.db)
        return status.jobs.length ? `unschedule ${status.jobs.map((j) => j.jobname).join(', ')}` : 'none scheduled'
      },
      async run() {
        const removed = await uninstallPgCron(ctx.db)
        return removed.length ? `unscheduled ${removed.join(', ')}` : 'none were scheduled'
      },
    }]
  },
  async rollback(ctx) {
    const before = (ctx.record.config_before?.rollback?.pgCron ?? null) as { installed: boolean; jobs: string[] } | null
    if (!before) return ['no pg_cron snapshot: jobs left as they are']
    const now: PgCronStatus = await pgCronStatus(ctx.db)
    if (before.installed && !now.installed) {
      if (ctx.dryRun) return [`would re-install pg_cron jobs ${before.jobs.join(', ')}`]
      const result = await installPgCron(ctx.db, {})
      return [`re-installed pg_cron jobs ${result.jobs.join(', ')} (existing Vault secrets kept)`]
    }
    if (!before.installed && now.installed) {
      if (ctx.dryRun) return [`would unschedule ${now.jobs.map((j) => j.jobname).join(', ')}`]
      return [`unscheduled ${(await uninstallPgCron(ctx.db)).join(', ')}`]
    }
    return ['pg_cron jobs already as before the switch']
  },
}
