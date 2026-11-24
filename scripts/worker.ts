/**
 * `usertasks worker`: the scheduler worker as its own process.
 *
 * Usage:
 *   npm run worker              tick every minute until stopped (SIGTERM/SIGINT)
 *   npm run worker -- --once    run the current minute's tick once and exit
 *                               (e.g. a Kubernetes CronJob without HTTP, or
 *                               EventBridge Scheduler running an ECS task)
 *   npm run worker -- --processor [args]
 *                               a processing worker: hands the process to the
 *                               licensed processing provider (an extension's
 *                               `processing.processor`, e.g. the separate
 *                               processing add-on), which claims and runs queued
 *                               work until SIGTERM / SIGINT, then drains. Exits 2
 *                               when no licensed provider is installed.
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

/** `--processor`: run the processing provider's processor loop on core's host (lib/processing/processor-host). */
async function runProcessor(): Promise<never> {
  const [{ resolveProcessingProvider, markProcessorProcess }, { createProcessorHost }, { registerProcessingProviderResolver }] = await Promise.all([
    import('../lib/processing/handoff'),
    import('../lib/processing/processor-host'),
    import('../lib/processing/provider-registry'),
  ])
  registerProcessingProviderResolver()
  markProcessorProcess(true)
  const resolved = await resolveProcessingProvider()
  if (!resolved?.provider.processor) {
    console.error('[processor] No licensed processing provider in this build: separate processing workers need the processing add-on (extension) and its licence. Run `node worker.cjs` (the scheduler) instead, or install the add-on.')
    process.exit(2)
  }
  const host = await createProcessorHost()
  const controller = new AbortController()
  const stop = (signal: string) => {
    if (controller.signal.aborted) return
    console.log(`[processor] ${signal}: draining (finishing running jobs, handing back unstarted claims)`)
    controller.abort()
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
  const args = process.argv.slice(process.argv.indexOf('--processor') + 1)
  console.log(`[processor] ${host.workerId} starting (${resolved.extensionId}, UserTasks ${host.version})`)
  let code = 0
  try {
    await resolved.provider.processor({ ctx: resolved.ctx, host, signal: controller.signal, args })
  } catch (error) {
    console.error(`[processor] stopped with an error: ${(error as Error).message}`)
    code = 1
  } finally {
    await host.close()
  }
  console.log('[processor] stopped')
  process.exit(code)
}

async function main() {
  const once = process.argv.includes('--once')
  await bootstrapEncryptionKey()
  await bootstrapKms()
  if (process.argv.includes('--processor')) await runProcessor()
  // The scheduler's tick also hands work off by the processing mode.
  const { registerProcessingProviderResolver } = await import('../lib/processing/provider-registry')
  registerProcessingProviderResolver()
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
