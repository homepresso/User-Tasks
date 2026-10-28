import path from 'node:path'
import type { InstanceConfig } from '@/lib/config'
import { databaseUrl, readEnv } from '@/lib/config/bootstrap'
import { invalidateInstanceSettingsCache } from '@/lib/config/instance-settings'
import { resolveSecretRef } from '@/lib/config/secret-refs'
import { rateLimit } from '@/lib/rate-limit'
import { clearInfrastructureHealthCache, viewerCanSeeInfrastructure } from '../infrastructure'
import { NoDatabaseError, backgroundRuntime, type InfrastructureSwitchDeps } from '../infrastructure-switching'
import { CHUNKED_AREAS } from '../switch-runtime'
import { connect, type SqlClient } from '../ops/instance-db'
import { uiSwitchingGateFor } from './gate'
import { runQueuedSwitches } from './jobs'
import { SWITCH_PLANS } from './plans'

/**
 * The app process's side of switching from Settings → Infrastructure: a
 * direct connection per call (DATABASE_URL), the feature gate, the
 * in-process background runner, and the deps the server actions bind.
 */

/** BACKUP_DIR, else ./backups/switches (mount a volume there in containers). */
export function appBackupRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ readEnv('BACKUP_DIR') || 'backups/switches')
}

async function withDb<T>(fn: (db: SqlClient, dbUrl: string) => Promise<T>): Promise<T> {
  const url = databaseUrl()
  if (!url) throw new NoDatabaseError()
  const client = await connect(url, 'usertasks-infrastructure')
  try {
    return await fn(client, url)
  } finally {
    await client.end().catch(() => undefined)
  }
}

const globalRef = globalThis as typeof globalThis & { __usertasksSwitchRunner?: Promise<void> | null; __usertasksSwitchRunnerAgain?: boolean }

/** Seconds one chunk of a chunked (serverless) switch may run: INFRA_UI_CHUNK_SECONDS, default 40. */
export function chunkBudgetMs(): number {
  const n = Number(readEnv('INFRA_UI_CHUNK_SECONDS'))
  return (Number.isFinite(n) && n >= 5 ? n : 40) * 1000
}

/**
 * One time-boxed chunk of the queued chunkable switch (the database copy)
 * on serverless: runs until `deadline`, saves its progress and pauses; the
 * next chunk (the tick's provider-switches job, or the next kick) continues.
 */
export async function runSwitchChunk(deadline: number): Promise<number> {
  const url = databaseUrl()
  if (!url) return 0
  const db = await connect(url, 'usertasks-switch-chunk')
  try {
    const ran = await runQueuedSwitches(db, {
      dbUrl: url, plans: SWITCH_PLANS, backupRoot: appBackupRoot(), deadline, areas: [...CHUNKED_AREAS], limit: 1,
      io: { log: (line) => console.log(`[switch] ${line}`), warn: (line) => console.warn(`[switch] ${line}`) },
    })
    if (ran.some((r) => r.result.code === 0)) {
      invalidateInstanceSettingsCache()
      clearInfrastructureHealthCache()
    }
    return ran.length
  } finally {
    await db.end().catch(() => undefined)
  }
}

/**
 * Run queued switches in this process, in the background (never awaited by
 * the request). One runner per process; a kick while it runs makes it look
 * again when it finishes. On serverless, one chunk of a chunkable switch
 * runs after the response instead (next/server after()), within the
 * function's time limit; the tick continues it.
 */
export function kickSwitchRunner(): void {
  if (!backgroundRuntime().available) {
    void import('next/server').then(({ after }) => {
      after(() => runSwitchChunk(Date.now() + chunkBudgetMs()).catch((error: Error) => console.error(`[switch] chunk failed: ${error.message}`)))
    }).catch(() => undefined)
    return
  }
  if (globalRef.__usertasksSwitchRunner) { globalRef.__usertasksSwitchRunnerAgain = true; return }
  const url = databaseUrl()
  if (!url) return
  globalRef.__usertasksSwitchRunner = (async () => {
    do {
      globalRef.__usertasksSwitchRunnerAgain = false
      const db = await connect(url, 'usertasks-switch-runner')
      try {
        const ran = await runQueuedSwitches(db, {
          dbUrl: url, plans: SWITCH_PLANS, backupRoot: appBackupRoot(),
          io: { log: (line) => console.log(`[switch] ${line}`), warn: (line) => console.warn(`[switch] ${line}`) },
        })
        if (ran.length) {
          invalidateInstanceSettingsCache()
          clearInfrastructureHealthCache()
        }
      } finally {
        await db.end().catch(() => undefined)
      }
    } while (globalRef.__usertasksSwitchRunnerAgain)
  })()
    .catch((error: Error) => console.error(`[switch] background runner failed: ${error.message}`))
    .finally(() => { globalRef.__usertasksSwitchRunner = null })
}

async function checkSecretRef(config: InstanceConfig, ref: string): Promise<{ ok: boolean; detail: string }> {
  const secrets = config.providers.secrets
  try {
    const { secretStoreFor } = await import('@/lib/providers/secrets')
    const store = secretStoreFor(secrets.id, secrets.options)
    await resolveSecretRef(ref, store, { ttlMs: 0 })
    return { ok: true, detail: `found in the ${secrets.id} secret store` }
  } catch (error) {
    return { ok: false, detail: (error as Error).message }
  }
}

export const appSwitchDeps: InfrastructureSwitchDeps = {
  canView: viewerCanSeeInfrastructure,
  withDb,
  rateLimit: async (key, max) => (await rateLimit(key, { max, windowMs: 60_000 })).ok,
  gate: uiSwitchingGateFor,
  runtime: () => backgroundRuntime(),
  kick: kickSwitchRunner,
  plans: SWITCH_PLANS,
  get backupRoot() { return appBackupRoot() },
  invalidate: () => {
    invalidateInstanceSettingsCache()
    clearInfrastructureHealthCache()
  },
  checkSecretRef,
}
