import { NextRequest, NextResponse } from "next/server"
import { processWorkflowQueueBatch } from "@/lib/workflow-queue-processor"
import { createServiceClient, requireServiceAuth } from "@/lib/cron-auth"
import { kickQueueProcessor } from "@/lib/process-queue"

// Jobs start within WORKFLOW_PROCESSOR_BUDGET_MS (default 50 s); running ones finish.
export const maxDuration = 60

/**
 * Queue processor endpoint.
 * Call this on a schedule (cron) or via pg_notify listener to process pending workflow jobs.
 *
 * POST /api/workflows/process
 * Body: { batch_size?: number, worker_id?: string }
 *
 * Runs up to batch_size jobs, WORKFLOW_CONCURRENCY (default 5) at a time,
 * claimed in batches; stops starting jobs when the queue is empty or the time
 * budget is spent, then kicks a fresh invocation if work was left behind.
 *
 * Can also be called by Supabase Edge Functions, Vercel Cron, or external scheduler.
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  let body: any = {}
  try {
    body = await request.json()
  } catch {
    // Empty body is OK
  }

  const result = await processWorkflowQueueBatch({
    batchSize: body.batch_size ?? 10,
    workerId: body.worker_id,
  })

  // Stopped with jobs left (time budget or batch_size): continue in a new
  // invocation (coalesced, via after()).
  if (result.more) kickQueueProcessor()

  return NextResponse.json(result)
}

/**
 * GET endpoint for health checks and queue stats
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  const supabase = createServiceClient()

  const { data: stats } = await supabase.rpc("get_queue_stats" as any).single()

  // Fallback if RPC doesn't exist
  if (!stats) {
    const { count: pending } = await supabase
      .from("workflow_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")

    const { count: processing } = await supabase
      .from("workflow_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "processing")

    const { count: failed } = await supabase
      .from("workflow_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "failed")

    const { count: dead } = await supabase
      .from("workflow_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "dead")

    return NextResponse.json({
      pending: pending ?? 0,
      processing: processing ?? 0,
      failed: failed ?? 0,
      dead: dead ?? 0,
    })
  }

  return NextResponse.json(stats)
}
