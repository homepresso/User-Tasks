#!/usr/bin/env node
import { defaultIO, run } from './cli'

/**
 * usertasks-admin — server-side administration, run where the app runs
 * (same DATABASE_URL and provider environment). See ./cli.ts for the
 * commands: status, providers list, doctor, switch, rollback, history,
 * instance-admins and db migrate|status|repair.
 */

/**
 * ENCRYPTION_KEY=secret://…: read the key from the secret store first, as the
 * app and the worker do at startup, so encrypted settings can be read and
 * written. A failure is a warning: commands that need the key say so.
 */
async function loadEncryptionKey(): Promise<void> {
  if (!/^secret:\/\//.test(process.env.ENCRYPTION_KEY?.trim() ?? '')) return
  try {
    const { bootstrapEncryptionKey } = await import('@/lib/providers/secrets/bootstrap')
    await bootstrapEncryptionKey()
  } catch (error) {
    console.error(`warning: ENCRYPTION_KEY: ${error instanceof Error ? error.message : String(error)}`)
  }
}

loadEncryptionKey()
  .then(() => run(process.argv.slice(2), defaultIO))
  .then((code) => {
    process.exitCode = code
    // Provider SDK clients may keep sockets open: don't wait for them once output is flushed.
    setTimeout(() => process.exit(code), 100).unref()
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
