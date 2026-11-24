import { NextRequest, NextResponse } from "next/server"
import { QueuedRunTimeoutError, startRun } from "@/lib/processing/dispatch"
import { authorizeWorkflowExecute, authzErrorResponse } from "@/lib/services/workflow-designer-runs"

/**
 * Run a workflow now as the signed-in user. The workflow (and task, when
 * given) must be in the caller's workspace; a test run needs workflows.edit,
 * a real run workflows.activate (lib/services/workflow-designer-runs).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const { workflow_id, task_id, test, variables } = (body ?? {}) as Record<string, any>
  const isTest = test === true

  let authorized: Awaited<ReturnType<typeof authorizeWorkflowExecute>>
  try {
    authorized = await authorizeWorkflowExecute({ workflowId: workflow_id, taskId: task_id, test: isTest })
  } catch (error) {
    const { status, body: errorBody } = authzErrorResponse(error)
    return NextResponse.json(errorBody, { status })
  }

  try {
    // The signed-in user starts the run (workflow_started_by).
    // Here, or on a processing worker while this request waits (lib/processing/dispatch).
    const result = await startRun({
      workflowId: authorized.workflow.id,
      tenantId: authorized.workflow.tenant_id,
      taskId: authorized.taskId ?? null,
      test: isTest,
      variables: variables ?? undefined,
      initiator: { userId: authorized.ctx.actorId, via: isTest ? "test" : "ui" },
    })
    return NextResponse.json(result)
  } catch (error: any) {
    if (error instanceof QueuedRunTimeoutError) return NextResponse.json({ error: error.message, job_id: error.jobId }, { status: 504 })
    console.error('[workflow-execute]', error.message)
    return NextResponse.json(
      { error: 'Workflow execution failed' },
      { status: 500 }
    )
  }
}
