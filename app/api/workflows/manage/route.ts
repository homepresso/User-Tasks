import { NextRequest, NextResponse } from "next/server"
import { fromSession, isServiceError } from "@/lib/services/context"
import { serviceRoleClient } from "@/lib/services/_shared"
import { actOnWorkflowRun, type WorkflowRunAction } from "@/lib/services/workflow-runs"

/**
 * Pause / resume / cancel / go-to workflow runs from the queue UI — the
 * shared lib/services/workflow-runs implementation (also behind
 * /api/v1/workflows/runs/{id}/action and MCP workflows_run_action).
 *
 * Requires a signed-in user with `workflows.activate`; the run is looked up
 * in the caller's current tenant (by run_id, or event_id for resume). The
 * service-role client is used so the run's open tasks can be closed whoever
 * they are assigned to; every query is tenant-filtered.
 */
export async function POST(request: NextRequest) {
  let ctx
  try {
    const session = await fromSession()
    ctx = { ...session, supabase: await serviceRoleClient(session) }
  } catch (error) {
    if (isServiceError(error)) {
      return NextResponse.json({ error: error.code === "unauthorized" ? "Unauthorized" : "No tenant" }, { status: error.status })
    }
    throw error
  }

  const body = await request.json().catch(() => ({}))
  const { action, run_id, event_id, goto_node_id } = (body ?? {}) as Record<string, string | undefined>

  if (action !== "pause" && action !== "resume" && action !== "cancel") {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }
  // Pause and cancel act on an explicit run; resume may name the event instead.
  if (action !== "resume" && !run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 })
  if (!run_id && !event_id) return NextResponse.json({ error: "event_id or run_id required" }, { status: 400 })

  try {
    const result = await actOnWorkflowRun(
      ctx,
      { runId: run_id ?? null, eventId: run_id ? null : event_id ?? null },
      { action: action as WorkflowRunAction, gotoNodeId: goto_node_id ?? null },
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 500 })
  }
}
