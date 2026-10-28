/**
 * `usertasks worker`: the scheduler worker as its own process.
 *
 * Usage:
 *   npm run worker              tick every minute until stopped (SIGTERM/SIGINT)
 *   npm run worker -- --once    run the current minute's tick once and exit
 *                               (e.g. a Kubernetes CronJob without HTTP, or
 *                               EventBridge Scheduler running an ECS task)
 *
 * In the Docker image: `node worker.mjs [--once]` (bundled by
 * scripts/build-worker.mjs). Uses the same environment as the app
 * (Supabase URL + service-role key or DATABASE_URL with DB_PROVIDER=postgres,
 * ENCRYPTION_KEY, …), loaded from the shell (`set -a; . ./.env.local; set +a`).
 * Runs regardless of SCHEDULER_PROVIDER — starting it is the opt-in — but
 * warns when the provider isn't `worker`. Any number of worker processes
 * (and in-process workers in app replicas) can run: one leader ticks per
 * minute (lib/scheduler/leader.ts).
 */
import { getProviderConfig } from '../lib/config'
import { bootstrapEncryptionKey } from '../lib/providers/secrets/bootstrap'
import { bootstrapKms } from '../lib/providers/kms/bootstrap'
import { createSchedulerWorker, warnIfPgCronStillScheduled } from '../lib/scheduler/runtime'

async function main() {
  const once = process.argv.includes('--once')
  await bootstrapEncryptionKey()
  await bootstrapKms()
  const config = await getProviderConfig('scheduler')
  // --once under SCHEDULER_PROVIDER=external is an outside scheduler running the tick as a task.
  if (config.id !== 'worker' && !(once && config.id === 'external')) {
    console.warn(`[scheduler] SCHEDULER_PROVIDER is ${config.id}, not worker; running the worker anyway`)
  }
  await warnIfPgCronStillScheduled('worker', config.options)
  const worker = createSchedulerWorker(config.options)

  if (once) {
    const outcome = await worker.runMinute(new Date())
    await worker.stop()
    console.log(`[scheduler] ${outcome}`)
    process.exit(outcome === 'error' ? 1 : 0)
  }

  worker.start()
  console.log('[scheduler] worker running; Ctrl+C to stop')
  // The loop's timers don't hold the process open on their own.
  const keepAlive = setInterval(() => undefined, 60_000)
  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    console.log(`[scheduler] ${signal}: waiting for the running tick, then exiting`)
    await worker.stop()
    clearInterval(keepAlive)
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((error) => {
  console.error(`[scheduler] ${(error as Error).message}`)
  process.exit(1)
})
