'use server'

import { fromSession, isServiceError, type ServiceContext } from '@/lib/services/context'
import { serviceRoleClient } from '@/lib/services/_shared'
import { deleteQueueJob as deleteQueueJobService, type QueueJobDeleteResult } from '@/lib/services/workflow-queue'

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
