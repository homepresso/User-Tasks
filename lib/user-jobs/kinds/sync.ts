import { z } from 'zod'
import { getDb, requirePerm, ServiceError, type ServiceContext } from '@/lib/services/context'
import { dbError } from '@/lib/services/_shared'
import { startDirectorySyncRun } from '@/lib/services/directory-sync'
import { defineJobKind, type JobRun } from '../define'

/*
 * GitHub sync pushes / deployments and directory syncs already run in their
 * own workers (github_sync_runs, github_deployments, directory_sync_runs).
 * These jobs follow such a run until it finishes, so the user gets the same
 * progress, completion popup and bell notification as for any other job:
 *
 *   sync.watch            a run started by the page (Push everything, Commit,
 *                         template / selection sync, Deploy from GitHub)
 *   directory_sync.run    starts a directory sync, then follows it
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows */

const SOURCES = {
  github_sync: { table: 'github_sync_runs', noun: 'GitHub sync' },
  github_deploy: { table: 'github_deployments', noun: 'GitHub deployment' },
  directory_sync: { table: 'directory_sync_runs', noun: 'Directory sync' },
} as const
type Source = keyof typeof SOURCES

const POLL_MS = 2_000

function percentOf(progress: unknown): number | null {
  if (typeof progress === 'number') return progress
  if (progress && typeof progress === 'object') {
    const p = progress as Record<string, unknown>
    if (typeof p.percent === 'number') return p.percent
    const done = Number(p.done ?? p.processed ?? p.completed)
    const total = Number(p.total)
    if (Number.isFinite(done) && Number.isFinite(total) && total > 0) return (done / total) * 100
  }
  return null
}

function summarize(source: Source, row: any): string {
  if (source === 'github_sync') {
    const files = Number(row.files_changed ?? 0)
    return row.commit_sha ? `${files} file${files === 1 ? '' : 's'} committed (${String(row.commit_sha).slice(0, 7)})` : (row.message || 'Nothing to commit')
  }
  const stats = row.stats && typeof row.stats === 'object' ? row.stats as Record<string, unknown> : {}
  const parts = Object.entries(stats).filter(([, v]) => typeof v === 'number').slice(0, 4).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`)
  return parts.length ? parts.join(', ') : 'Completed'
}

/** Poll the run until it finishes or this invocation's time is up. */
async function follow(run: JobRun<unknown>, ctx: ServiceContext, source: Source, runId: string, label: string) {
  const def = SOURCES[source]
  const db = getDb(ctx) as any
  for (;;) {
    const { data: row, error } = await db.from(def.table).select('*').eq('id', runId).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (error) throw dbError(error)
    if (!row) throw ServiceError.notFound(`${def.noun} run not found`)
    if (row.status === 'completed') {
      return { data: { run_id: runId, status: row.status, stats: row.stats ?? null, commit_sha: row.commit_sha ?? null, files_changed: row.files_changed ?? null }, summary: summarize(source, row) }
    }
    if (row.status === 'failed') throw new ServiceError('internal', `${label} failed: ${row.error ?? 'unknown error'}`)
    const pct = percentOf(row.progress)
    await run.progress(pct ?? (row.status === 'running' ? 10 : 2), row.status === 'pending' ? 'Waiting for the worker' : (typeof row.message === 'string' && row.message) || 'Running')
    if (run.timeLeft() < POLL_MS + 3_000) return { continue: { run_id: runId } }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

export const syncWatchJob = defineJobKind({
  kind: 'sync.watch',
  effect: 'change',
  maxAttempts: 3,
  params: z.object({ source: z.enum(['github_sync', 'github_deploy', 'directory_sync']), run_id: z.string().uuid(), label: z.string().max(200).optional() }),
  title: (p) => p.label || SOURCES[p.source].noun,
  authorize: (ctx) => requirePerm(ctx, 'settings.edit'),
  run: (run) => follow(run as JobRun<unknown>, run.ctx, run.params.source, run.params.run_id, run.params.label || SOURCES[run.params.source].noun),
})

export const directorySyncJob = defineJobKind({
  kind: 'directory_sync.run',
  effect: 'change',
  params: z.object({ provider: z.string().min(1).max(40), full: z.boolean().default(false), label: z.string().max(200).optional() }),
  title: (p) => p.label || `${p.full ? 'Full directory' : 'Directory'} sync`,
  authorize: (ctx) => requirePerm(ctx, 'settings.edit'),
  async run(run) {
    const started = (run.checkpoint as { run_id: string } | null) ?? null
    let runId = started?.run_id
    if (!runId) {
      runId = (await startDirectorySyncRun(run.ctx, run.params.provider, { full: run.params.full })).run_id
      await run.saveCheckpoint({ run_id: runId })
    }
    return follow(run as JobRun<unknown>, run.ctx, 'directory_sync', runId, run.params.label || 'Directory sync')
  },
})
