import { NextRequest, NextResponse } from "next/server"
import { requireServiceAuth } from '@/lib/cron-auth'
import { processAgentQueueBatch } from '@/lib/jobs/agent-queue'

export const maxDuration = 60

/**
 * Cron endpoint that drains the agent execution queue, for schedulers that
 * can only issue GETs (e.g. Vercel Cron). Same work as POST
 * /api/agents/process with batch_size 10; the scheduler tick
 * (/api/cron/tick) runs it every minute.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  try {
    const result = await processAgentQueueBatch({ batchSize: 10 })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 })
  }
}

// Allow POST too for flexibility
export { GET as POST }
