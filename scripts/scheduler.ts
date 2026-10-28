/**
 * Scheduler operations (until the admin CLI's `switch scheduler` lands).
 *
 * Usage:
 *   npm run scheduler -- status
 *   npm run scheduler -- install-pg-cron [--base-url https://app.example.com] [--no-secrets]
 *   npm run scheduler -- uninstall-pg-cron
 *
 * install-pg-cron (re)creates the usertasks-tick and housekeeping pg_cron
 * jobs and stores the base URL (--base-url, else SCHEDULER_PG_CRON_BASE_URL,
 * else APP_URL) and the cron secret (CRON_SECRET / WORKFLOW_PROCESSOR_SECRET)
 * in Supabase Vault, where app_cron.invoke_endpoint reads them. Idempotent.
 * uninstall-pg-cron removes the jobs (do this after switching to the worker
 * or an external scheduler).
 *
 * Needs a direct database connection with a role that may use cron.* and
 * vault.*: SCHEDULER_DATABASE_URL or DATABASE_URL (postgres on Supabase).
 */
import { Client } from 'pg'
import { getProviderConfig } from '../lib/config'
import { appUrlOrLocalhost, processorSecret } from '../lib/config/bootstrap'
import { installPgCron, pgCronStatus, uninstallPgCron } from '../lib/providers/scheduler/pg-cron'
import { schedulerOption } from '../lib/providers/scheduler/options'
import { electionDatabaseUrl } from '../lib/scheduler/runtime'
import { pgConnectionConfig } from '../lib/providers/db/pg-auth'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : ''
}

async function main() {
  const command = process.argv[2]
  const config = await getProviderConfig('scheduler')
  const url = electionDatabaseUrl(config.options)
  if (!['status', 'install-pg-cron', 'uninstall-pg-cron'].includes(command ?? '')) {
    console.error('Usage: npm run scheduler -- status | install-pg-cron [--base-url URL] [--no-secrets] | uninstall-pg-cron')
    process.exit(2)
  }
  console.log(`Scheduler provider: ${config.id} (${config.source})`)
  if (!url) {
    console.error('Set DATABASE_URL (or SCHEDULER_DATABASE_URL) to a direct connection to the database')
    process.exit(command === 'status' ? 0 : 1)
  }
  const client = new Client(pgConnectionConfig(url, { application_name: 'usertasks-scheduler-admin' }))
  await client.connect()
  try {
    if (command === 'install-pg-cron') {
      const noSecrets = process.argv.includes('--no-secrets')
      const baseUrl = arg('base-url') || schedulerOption(config.options, 'pg_cron_base_url') || appUrlOrLocalhost()
      const secret = processorSecret()
      if (!noSecrets && !secret) throw new Error('Set CRON_SECRET (or WORKFLOW_PROCESSOR_SECRET), or pass --no-secrets to keep the Vault secrets as they are')
      const result = await installPgCron(client, noSecrets ? {} : { baseUrl, secret })
      console.log(`Installed ${result.jobs.join(', ')}`)
      for (const [name, action] of Object.entries(result.vault)) console.log(`Vault secret ${name}: ${action}`)
      if (config.id !== 'pg_cron') console.warn(`Note: the active provider is ${config.id}; set SCHEDULER_PROVIDER=pg_cron (or unset it)`)
    } else if (command === 'uninstall-pg-cron') {
      const removed = await uninstallPgCron(client)
      console.log(removed.length ? `Unscheduled ${removed.join(', ')}` : 'No usertasks pg_cron jobs were scheduled')
    }
    const status = await pgCronStatus(client)
    console.log(status.jobs.length ? 'pg_cron jobs:' : 'pg_cron jobs: none')
    for (const job of status.jobs) console.log(`  ${job.jobname}  ${job.schedule}  ${job.active ? 'active' : 'inactive'}`)
    if (status.vault) console.log(`Vault: app_base_url ${status.vault.app_base_url ? 'set' : 'missing'}, cron_secret ${status.vault.cron_secret ? 'set' : 'missing'}`)
    if (config.id !== 'pg_cron' && status.installed) console.warn(`Warning: pg_cron still schedules the tick while the provider is ${config.id}`)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error((error as Error).message)
  process.exit(1)
})
