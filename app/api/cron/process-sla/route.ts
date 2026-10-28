import { NextRequest, NextResponse } from "next/server"
import { requireServiceAuth } from "@/lib/cron-auth"
import { processWorkflowSlaTriggers } from "@/lib/workflow-sla"

export const maxDuration = 60

/**
 * Cron endpoint: evaluate workflow SLA warnings/breaches.
 *
 * SLA checks used to piggyback on /api/cron/process-workflows, which also
 * chains the (daily-only) retention pass — bundling that made it impossible
 * to run SLA at a useful frequency. This route exposes just the SLA sweep so
 * the scheduler (Supabase pg_cron) can run it every few minutes.
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  try {
    const result = await processWorkflowSlaTriggers()
    return NextResponse.json({ ok: true, workflow_slas: result })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? String(error) }, { status: 500 })
  }
}

export { POST as GET }
