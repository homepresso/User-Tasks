'use server'

import { fromSession, isServiceError } from '@/lib/services/context'
import { getWorkflowInputs, queuedRunId, startWorkflow, type StartWorkflowResult } from '@/lib/services/workflow-start'
import type { WorkflowInputError, WorkflowInputSchema } from '@/lib/workflow-inputs'

/*
 * Run dialog server actions: thin wrappers over lib/services/workflow-start
 * (the same service as POST /api/v1/workflows/start and MCP workflows_start).
 * Reading the inputs needs workflows.view, starting workflows.activate.
 */

type ActionError = { error: string; fieldErrors?: WorkflowInputError[] }

function failure(error: unknown, fallback: string, label: string): ActionError {
  if (isServiceError(error)) {
    const details = Array.isArray(error.details) ? (error.details as Array<{ field?: string; message?: string }>) : []
    const fieldErrors = details.filter((d) => d.field).map((d) => ({ field: String(d.field), message: String(d.message ?? '') }))
    return { error: error.message, ...(fieldErrors.length ? { fieldErrors } : {}) }
  }
  console.error(`[${label}]`, error)
  return { error: fallback }
}

export async function getWorkflowRunInputs(workflowId: string): Promise<WorkflowInputSchema | ActionError> {
  try {
    return await getWorkflowInputs(await fromSession(), workflowId)
  } catch (error) {
    return failure(error, 'Could not load the workflow inputs.', 'getWorkflowRunInputs')
  }
}

export interface RunWorkflowInput {
  workflowId: string
  variables: Record<string, unknown>
  /** Queue in the background (default) or wait for the result. */
  async: boolean
  priority?: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function runWorkflowNow(input: RunWorkflowInput): Promise<StartWorkflowResult | ActionError> {
  try {
    const ctx = await fromSession()
    const result = await startWorkflow(ctx, {
      workflow_id: input.workflowId,
      variables: input.variables,
      async: input.async,
      priority: input.priority ?? 50,
    })
    if (result.mode !== 'async') return result
    // The queue usually picks the job up within a moment: wait briefly so the
    // dialog can link straight to the run (else it links to the queue).
    for (let i = 0; i < 10; i++) {
      await sleep(300)
      const job = await queuedRunId(ctx, result.job_id).catch(() => null)
      if (job?.run_id) return { ...result, run_id: job.run_id }
      if (job && ['failed', 'dead', 'cancelled'].includes(job.status)) break
    }
    return result
  } catch (error) {
    return failure(error, 'Could not start the workflow.', 'runWorkflowNow')
  }
}
