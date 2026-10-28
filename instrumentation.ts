/**
 * Runs once when a Next.js server instance starts (Node.js runtime only).
 *
 * 1. Sources ENCRYPTION_KEY from the secret store when it isn't a plain env
 *    value (lib/providers/secrets/bootstrap.ts). Awaited: requests must not
 *    be served before stored secrets can be decrypted; a failure is fatal.
 * 2. Loads the KMS-wrapped data keys (lib/providers/kms/bootstrap.ts), also
 *    awaited: with KMS_PROVIDER=env and no data keys (the default) this is
 *    one lookup and nothing else; any other KMS provider fails closed.
 * 3. Starts the in-process scheduler worker when SCHEDULER_PROVIDER=worker
 *    (lib/scheduler/runtime.ts), in the background. Never on Vercel:
 *    serverless functions don't stay up between requests, so Vercel
 *    deployments use pg_cron or Vercel Cron (external) instead.
 *
 * Neither runs during `next build`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  const { bootstrapEncryptionKey } = await import('./lib/providers/secrets/bootstrap')
  await bootstrapEncryptionKey()
  const { bootstrapKms } = await import('./lib/providers/kms/bootstrap')
  await bootstrapKms()
  if (process.env.VERCEL) return
  const { startSchedulerWorker } = await import('./lib/scheduler/runtime')
  void startSchedulerWorker().catch((error: Error) => console.error(`[scheduler] worker failed to start: ${error.message}`))
}
