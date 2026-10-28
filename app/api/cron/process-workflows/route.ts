import { NextRequest, NextResponse } from "next/server"
import { requireServiceAuth } from '@/lib/cron-auth'
import { processWorkflowQueueBatch } from "@/lib/workflow-queue-processor"
import { kickQueueProcessor } from "@/lib/process-queue"

export const maxDuration = 60

/**
 * Cron endpoint for processing the workflow queue (for schedulers that can
 * only issue GETs, e.g. Vercel Cron). pg_cron calls /api/workflows/process
 * directly.
 *
 * Only drains the queue: the retention pass runs on its own daily job
 * (/api/cron/process-retention-policies) and SLA checks on the 5-minute job
 * (/api/cron/process-sla) — both used to run here on every call.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  try {
    const result = await processWorkflowQueueBatch({ batchSize: 20 })
    if (result.more) kickQueueProcessor()
    return NextResponse.json({ ok: true, ...result })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
}

// Allow POST too for flexibility
export { GET as POST }
