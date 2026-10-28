import { NextRequest, NextResponse } from "next/server"
import { createClient as createServerClient, getCachedUser } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/cron-auth"
import { getCurrentTenantId } from "@/lib/integrations/auth"
import { getUserPermissions } from "@/lib/permissions-server"
import { cancelTestRun, cancelWaitingTestRuns, isDesignerTestRun } from "@/lib/workflow-test-runs"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WAITING = new Set(["waiting_for_event", "paused"])

/**
 * Test-run cleanup for the designer's Test runner and the queue:
 *  - `{ run_id }`: delete a run and its logs — the Test runner clearing its
 *    test runs (workflows.edit) and the queue's delete (workflows.activate).
 *    A waiting run that is not the caller's own test run is a live
 *    production instance: deleting it needs workflows.activate. A waiting
 *    test run is cancelled first (its open tasks too).
 *  - `{ workflow_id }`: cancel the caller's own waiting test runs of that
 *    workflow (the Test runner on close and on open: runs it lost track of,
 *    e.g. after a reload). Production runs are never touched.
 * Runs of the caller's tenant only.
 */
export async function POST(request: NextRequest) {
  // Verify user is authenticated and resolve their tenant
  const serverClient = await createServerClient()
  const user = await getCachedUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let tenantId: string
  try {
    tenantId = await getCurrentTenantId(serverClient, user.id)
  } catch {
    return NextResponse.json({ error: "No tenant" }, { status: 403 })
  }

  const permissions = await getUserPermissions()
  const canActivate = permissions.has("workflows.activate")
  if (!permissions.has("workflows.edit") && !canActivate) {
    return NextResponse.json({ error: "Forbidden: you lack the 'workflows.edit' permission" }, { status: 403 })
  }

  const { run_id, workflow_id } = await request.json().catch(() => ({}))
  const supabase = createServiceClient()

  if (!run_id && workflow_id) {
    if (typeof workflow_id !== "string" || !UUID.test(workflow_id)) return NextResponse.json({ error: "Workflow not found" }, { status: 404 })
    if (!permissions.has("workflows.edit")) {
      return NextResponse.json({ error: "Forbidden: you lack the 'workflows.edit' permission" }, { status: 403 })
    }
    const result = await cancelWaitingTestRuns(supabase, { tenantId, workflowId: workflow_id, startedBy: user.id })
    return NextResponse.json({ ok: true, cancelled_runs: result.runs, cancelled_tasks: result.tasks })
  }
  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 })

  // Service role bypasses RLS, so verify the run belongs to the caller's tenant
  // before deleting anything.
  const { data: run } = await supabase
    .from('workflow_runs')
    .select('id, tenant_id, status, event_id, pause_variables')
    .eq('id', run_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 })

  if (WAITING.has(String(run.status))) {
    const vars = (run.pause_variables ?? {}) as Record<string, unknown>
    const ownTestRun = isDesignerTestRun(run) && vars.workflow_started_by === user.id
    if (!ownTestRun && !canActivate) {
      return NextResponse.json({ error: "Forbidden: deleting a waiting run that is not your own test run needs the 'workflows.activate' permission" }, { status: 403 })
    }
    // A waiting test run: cancel it (and its open tasks) before it goes.
    if (isDesignerTestRun(run)) await cancelTestRun(supabase, run as any)
  }

  await supabase.from('workflow_logs').delete().eq('run_id', run.id)
  await supabase.from('workflow_runs').delete().eq('id', run.id).eq('tenant_id', tenantId)

  return NextResponse.json({ ok: true })
}
