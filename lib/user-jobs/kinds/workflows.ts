import { z } from 'zod'
import { getDb, isServiceError, requirePerm, ServiceError } from '@/lib/services/context'
import { dbError } from '@/lib/services/_shared'
import { actOnWorkflowRun, migrateInstances, planInstanceMigration, type MigrationResult } from '@/lib/services/workflow-runs'
import { deleteQueueJob } from '@/lib/services/workflow-queue'
import { defineJobKind } from '../define'

/*
 * Workflow run actions on many items: live-instance migration (Migrate N
 * instances) and the queue's Pause All / Resume All / Delete. The browser
 * used to loop over the selection one request at a time; the job loops on
 * the server, in chunks that resume where they stopped.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows */

const uuid = z.string().uuid()
/** Runs migrated per call before checking the time left. */
const MIGRATE_CHUNK = 10

const migrationParams = z.object({
  workflowId: uuid,
  toVersionId: uuid,
  runIds: z.array(uuid).max(500).nullish(),
  fromVersionId: uuid.nullish(),
  allActive: z.boolean().nullish(),
  nodeMap: z.record(z.string(), z.string()).nullish(),
  defaultTargetNodeId: z.string().max(200).nullish(),
})

interface MigrationCheckpoint { pending: string[]; results: MigrationResult[]; skipped: MigrationResult[]; total: number }

export const instancesMigrateJob = defineJobKind({
  kind: 'workflow_instances.migrate',
  effect: 'change',
  // Resumable: the checkpoint is saved after every chunk, and a run migrated
  // twice is refused by migrate_workflow_instance (expected event id).
  maxAttempts: 2,
  params: migrationParams,
  title: (p) => `Migrate ${p.runIds?.length ? `${p.runIds.length} ` : ''}live instance${p.runIds?.length === 1 ? '' : 's'}`,
  authorize: (ctx) => requirePerm(ctx, 'workflows.manage_runs'),
  async run({ ctx, params, checkpoint, progress, saveCheckpoint, timeLeft }) {
    let state = checkpoint as MigrationCheckpoint | null
    if (!state) {
      // Fix the run list once (the plan resolves allActive / fromVersionId).
      const plan = await planInstanceMigration(ctx, params)
      const pending = plan.items.filter((item) => item.ok).map((item) => item.run_id)
      const skipped = plan.items.filter((item) => !item.ok).map((item) => ({ run_id: item.run_id, ok: false, error: item.blocked_reason ?? 'Not migratable' }))
      state = { pending, results: [], skipped, total: plan.items.length }
      await saveCheckpoint(state)
    }
    while (state.pending.length) {
      if (timeLeft() < 15_000) {
        return { continue: state, progress: ((state.total - state.pending.length) / Math.max(1, state.total)) * 100, message: `${state.results.length} of ${state.total} migrated` }
      }
      const chunk = state.pending.slice(0, MIGRATE_CHUNK)
      const outcome = await migrateInstances(ctx, { ...params, runIds: chunk, allActive: null, fromVersionId: null, dryRun: false })
      state = { ...state, pending: state.pending.slice(chunk.length), results: [...state.results, ...outcome.results] }
      // Persist after each chunk: a crashed invocation must not migrate a run twice.
      await saveCheckpoint(state)
      await progress(((state.total - state.pending.length) / Math.max(1, state.total)) * 100, `${state.results.filter((r) => r.ok).length} of ${state.total} migrated`)
    }
    const results = [...state.results, ...state.skipped]
    const migrated = results.filter((r) => r.ok).length
    const failed = state.results.filter((r) => !r.ok).length
    return {
      data: { dry_run: false, plan: null, results, summary: { migrated, skipped: state.skipped.length, failed } },
      counts: { migrated, skipped: state.skipped.length, failed },
      summary: `${migrated} migrated${state.skipped.length ? `, ${state.skipped.length} skipped` : ''}${failed ? `, ${failed} failed` : ''}`,
    }
  },
})

const queueItem = z.object({ job_id: z.string().max(100), run_id: uuid.nullish() })

/** Delete a run and its logs (the queue's Delete), tenant-pinned. */
async function deleteRun(ctx: Parameters<typeof deleteQueueJob>[0], runId: string): Promise<void> {
  const db = getDb(ctx) as any
  const { data: run, error } = await db.from('workflow_runs').select('id').eq('id', runId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!run) return // already gone
  const { error: logsError } = await db.from('workflow_logs').delete().eq('run_id', run.id).eq('tenant_id', ctx.tenantId)
  if (logsError) throw dbError(logsError)
  const { error: runError } = await db.from('workflow_runs').delete().eq('id', run.id).eq('tenant_id', ctx.tenantId)
  if (runError) throw dbError(runError)
}

export const queueBulkJob = defineJobKind({
  kind: 'workflow_queue.bulk',
  effect: 'change',
  maxAttempts: 2,
  params: z.object({ action: z.enum(['pause', 'resume', 'delete']), items: z.array(queueItem).min(1).max(1000) }),
  title: (p) => `${p.action === 'pause' ? 'Pause' : p.action === 'resume' ? 'Resume' : 'Delete'} ${p.items.length} queue item${p.items.length === 1 ? '' : 's'}`,
  authorize: (ctx) => requirePerm(ctx, 'workflows.activate'),
  async run({ ctx, params, checkpoint, progress, timeLeft }) {
    const state = (checkpoint as { index: number; failures: string[] } | null) ?? { index: 0, failures: [] }
    const total = params.items.length
    for (let i = state.index; i < total; i++) {
      if (timeLeft() < 8_000) return { continue: { index: i, failures: state.failures }, progress: (i / total) * 100 }
      const item = params.items[i]
      try {
        if (params.action === 'delete') {
          if (!item.job_id.startsWith('run:')) await deleteQueueJob(ctx, item.job_id)
          if (item.run_id) await deleteRun(ctx, item.run_id)
        } else if (item.run_id) {
          await actOnWorkflowRun(ctx, { runId: item.run_id, eventId: null }, { action: params.action, gotoNodeId: null })
        }
      } catch (error) {
        if (!isServiceError(error) && !(error instanceof Error)) throw error
        state.failures.push(error instanceof Error ? error.message : String(error))
      }
      await progress(((i + 1) / total) * 100, `${i + 1} of ${total}`)
    }
    const failed = state.failures.length
    const done = total - failed
    const verb = params.action === 'pause' ? 'paused' : params.action === 'resume' ? 'resumed' : 'deleted'
    if (failed === total) throw new ServiceError('conflict', `None could be ${verb}: ${[...new Set(state.failures)].slice(0, 3).join(' ')}`)
    return {
      counts: { done, failed },
      data: { failures: [...new Set(state.failures)].slice(0, 20) },
      summary: `${done} ${verb}${failed ? `, ${failed} failed (${[...new Set(state.failures)].slice(0, 2).join(' ')})` : ''}`,
    }
  },
})
