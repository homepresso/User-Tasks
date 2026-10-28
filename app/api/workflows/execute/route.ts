import { NextRequest, NextResponse } from "next/server"
import { executeWorkflow } from "@/lib/workflow-engine"
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
    const result = await executeWorkflow(authorized.workflow.id, authorized.taskId, isTest, variables ?? undefined, undefined, undefined, undefined, {
      initiator: { userId: authorized.ctx.actorId, via: isTest ? "test" : "ui" },
    })
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[workflow-execute]', error.message)
    return NextResponse.json(
      { error: 'Workflow execution failed' },
      { status: 500 }
    )
  }
}
