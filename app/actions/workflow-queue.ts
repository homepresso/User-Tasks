'use server'

import { fromSession, isServiceError, type ServiceContext } from '@/lib/services/context'
import { serviceRoleClient } from '@/lib/services/_shared'
import {
  actOnQueueJob,
  deleteQueueJob as deleteQueueJobService,
  type QueueJobAction,
  type QueueJobActionResult,
  type QueueJobDeleteResult,
} from '@/lib/services/workflow-queue'

/*
 * Queue view server actions. workflow_queue has no DELETE policy, so the
 * delete runs with the service-role client; lib/services/workflow-queue checks
 * workflows.activate in the caller's workspace, scopes every query to that
 * tenant and refuses jobs a worker is processing.
 */

type ActionError = { error: string }

async function sessionCtx(): Promise<ServiceContext> {
  const session = await fromSession()
  return { ...session, supabase: await serviceRoleClient(session) }
}

export async function deleteQueueJob(jobId: string): Promise<QueueJobDeleteResult | ActionError> {
  try {
    return await deleteQueueJobService(await sessionCtx(), jobId)
  } catch (error) {
    if (isServiceError(error)) return { error: error.message }
    console.error('[deleteQueueJob]', error)
    return { error: 'Could not delete the job.' }
  }
}

/**
 * Retry / cancel a queue job. For a `processing` job: allowed once its worker
 * was lost (lease expired); `force` cancels one whose worker is still alive
 * (the UI confirms first). Audited by the service.
 */
export async function actOnQueueJobAction(
  jobId: string,
  action: QueueJobAction,
  options: { force?: boolean } = {},
): Promise<QueueJobActionResult | ActionError> {
  try {
    return await actOnQueueJob(await sessionCtx(), jobId, action, { force: options.force === true })
  } catch (error) {
    if (isServiceError(error)) return { error: error.message }
    console.error('[actOnQueueJob]', error)
    return { error: 'Could not update the job.' }
  }
}
