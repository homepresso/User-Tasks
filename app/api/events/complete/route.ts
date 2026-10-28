import { NextRequest, NextResponse } from "next/server"
import { RunNotResumableError } from "@/lib/workflow-run-errors"
import { enqueueResume } from "@/lib/workflow-resume-queue"
import { createServiceClient, isAuthorizedServiceCall } from "@/lib/cron-auth"
import { createClient, getCachedUser } from "@/lib/supabase/server"
import { getCurrentTenantId } from "@/lib/integrations/auth"
import { getUserPermissions } from "@/lib/permissions-server"
import { findOpenWorkflowTaskForEvent, USER_TASK_EVENT_MESSAGE } from "@/lib/task-authz"

/**
 * Completes a workflow event and resumes the paused run waiting on it.
 *
 * Authorization (must be one of):
 *  - An authorized service call (processor secret) — used by server actions and
 *    trusted external integrations; may resume any tenant's run.
 *  - An authenticated user session with workflows.activate (as POST
 *    /api/v1/workflows/events/{id}/complete needs) — the run is scoped to the
 *    caller's tenant, so a user can only resume events of their own tenant.
 *    Users answering their own tasks go through task completion instead.
 *
 * Previously this endpoint was fully unauthenticated and looked up runs by a
 * guessable `event_id` across all tenants, allowing cross-tenant hijack.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { event_id, ...returnVariables } = body

  if (!event_id) {
    return NextResponse.json({ error: "event_id is required" }, { status: 400 })
  }

  // Determine authorization and the tenant scope to enforce.
  let tenantScope: string | null = null
  if (!isAuthorizedServiceCall(request)) {
    const authClient = await createClient()
    const user = await getCachedUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    try {
      tenantScope = await getCurrentTenantId(authClient, user.id)
    } catch {
      return NextResponse.json({ error: "No tenant" }, { status: 403 })
    }
    if (!(await getUserPermissions()).has("workflows.activate")) {
      return NextResponse.json({ error: "Forbidden: you lack the 'workflows.activate' permission" }, { status: 403 })
    }
  }

  const supabase = createServiceClient()

  // A user task's event completes through the task (assignee rule).
  if (tenantScope) {
    const userTaskId = await findOpenWorkflowTaskForEvent(supabase, tenantScope, String(event_id))
    if (userTaskId) return NextResponse.json({ error: USER_TASK_EVENT_MESSAGE, task_id: userTaskId }, { status: 409 })
  }

  // Find the paused/waiting run for this event, scoped to the caller's tenant
  // unless this is a trusted service call.
  const findRun = (status: string) => {
    let q = supabase
      .from("workflow_runs")
      .select("id, workflow_id, tenant_id, status")
      .eq("event_id", event_id)
      .eq("status", status)
    if (tenantScope) q = q.eq("tenant_id", tenantScope)
    return q.maybeSingle()
  }

  const { data: waitingRun } = await findRun("waiting_for_event")
  const run = waitingRun ?? (await findRun("paused")).data

  if (!run) {
    return NextResponse.json(
      { error: "No waiting workflow found for this event_id. It may have already been completed or cancelled." },
      { status: 404 },
    )
  }

  try {
    // The rest of the workflow runs on the queue (kicked now); poll by run_id.
    const queued = await enqueueResume({
      supabase,
      tenantId: run.tenant_id,
      eventId: event_id,
      variables: returnVariables,
    })
    return NextResponse.json({
      success: true,
      run_id: queued.run_id,
      workflow_id: run.workflow_id,
      status: "queued",
      resumed: queued.resumed,
      variables_received: Object.keys(returnVariables),
    })
  } catch (error: any) {
    if (error instanceof RunNotResumableError) {
      return NextResponse.json(
        { error: "No waiting workflow found for this event_id. It may have already been completed or cancelled." },
        { status: 404 },
      )
    }
    return NextResponse.json(
      { error: "Failed to resume workflow", details: error.message },
      { status: 500 },
    )
  }
}
