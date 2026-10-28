'use server'

import { after } from 'next/server'
import { fromSession } from '@/lib/services/context'
import { runAction } from '@/lib/actions/run-action'
import type { ActionResult } from '@/lib/action-result'
import * as jobs from '@/lib/services/user-jobs'
import { enqueueUserJob, runUserJob } from '@/lib/user-jobs/runner'
import { isUiJobKind } from '@/lib/user-jobs/kinds'
import type { UserJobView } from '@/lib/user-jobs/types'

/*
 * Background jobs from the UI (components/jobs): start one, list mine, cancel,
 * retry. A started job runs right after this action's response; if it
 * finishes within USER_JOB_INLINE_WAIT_MS the action returns it finished, so quick
 * actions complete as before while slow ones continue in the background.
 */

/** How long the action waits for a quick job (env USER_JOB_INLINE_WAIT_MS, default 1.5 s; 0 = always in the background). */
function inlineWaitMs(): number {
  const value = Number(process.env.USER_JOB_INLINE_WAIT_MS)
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 10_000) : 1_500
}

export interface StartJobInput {
  kind: string
  params: unknown
  /** Large input: text (JSON) or base64 bytes (an uploaded file). */
  input?: { text?: string; base64?: string }
  /** Run in another workspace the user belongs to (their roles there apply). */
  tenantId?: string | null
}

function decodeInput(input: StartJobInput['input']): Uint8Array | undefined {
  if (!input) return undefined
  if (typeof input.text === 'string') return new TextEncoder().encode(input.text)
  if (typeof input.base64 === 'string') return new Uint8Array(Buffer.from(input.base64.replace(/^data:[^,]*,/, ''), 'base64'))
  return undefined
}

export async function startJobAction(request: StartJobInput): Promise<ActionResult<UserJobView>> {
  return runAction('startJob', 'Could not start the job.', async () => {
    if (!isUiJobKind(request.kind)) throw new Error(`Unknown job kind "${request.kind}"`)
    const ctx = await fromSession(request.tenantId ? { tenantId: request.tenantId } : {})
    const job = await enqueueUserJob(ctx, request.kind, request.params, { input: decodeInput(request.input), start: false })
    const run = runUserJob(job.id).catch((error) => {
      console.error('[user-jobs] run failed:', error instanceof Error ? error.message : error)
      return null
    })
    // Keep the invocation alive until the job is done (or hands back).
    after(() => run)
    const wait = inlineWaitMs()
    if (wait > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([run, new Promise((resolve) => { timer = setTimeout(resolve, wait) })])
      clearTimeout(timer)
    }
    return jobs.getJob(ctx, job.id)
  })
}

export async function listMyJobsAction(filters: { active?: boolean; scope?: 'mine' | 'tenant'; limit?: number } = {}): Promise<ActionResult<UserJobView[]>> {
  return runAction('listMyJobs', 'Could not load your jobs.', async () =>
    (await jobs.listJobs(await fromSession(), { scope: filters.scope ?? 'mine', active: filters.active, limit: filters.limit ?? 30 })).jobs)
}

export async function getJobAction(id: string): Promise<ActionResult<UserJobView>> {
  return runAction('getJob', 'Could not load the job.', async () => jobs.getJob(await fromSession(), id))
}

export async function cancelJobAction(id: string): Promise<ActionResult<UserJobView>> {
  return runAction('cancelJob', 'Could not cancel the job.', async () => jobs.cancelJob(await fromSession(), id))
}

export async function retryJobAction(id: string): Promise<ActionResult<UserJobView>> {
  return runAction('retryJob', 'Could not retry the job.', async () => jobs.retryJob(await fromSession(), id))
}

export async function markJobSeenAction(id: string): Promise<ActionResult<{ updated: number }>> {
  return runAction('markJobSeen', 'Could not update notifications.', async () => jobs.markJobNotificationsRead(await fromSession(), id))
}

/** The JSON result of a finished job (dialogs that wait for theirs, e.g. an import's result). */
export async function getJobResultAction(id: string): Promise<ActionResult<unknown>> {
  return runAction('getJobResult', 'Could not load the result.', async () => jobs.getJobResult(await fromSession(), id))
}
