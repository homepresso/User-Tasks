import { NextRequest, NextResponse } from 'next/server'
import { requireServiceAuth } from '@/lib/cron-auth'
import { processAgentQueueBatch } from '@/lib/jobs/agent-queue'

// Vercel's default function timeout (10-15s) is far shorter than a batch of
// queued agent runs can take. 60 is the Hobby-plan ceiling; raise to 300 on Pro+.
export const maxDuration = 60

/** Agent queue worker (logic in lib/jobs/agent-queue.ts, shared with the scheduler tick). */
export async function POST(request: NextRequest) {
  // Internal secret via X-Processor-Secret or Authorization: Bearer (pg_cron's
  // app_cron.invoke_endpoint sends the Bearer form).
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  const body = await request.json().catch(() => ({}))
  return NextResponse.json(await processAgentQueueBatch({ batchSize: body.batch_size }))
}
