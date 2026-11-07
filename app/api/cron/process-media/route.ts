import { NextRequest, NextResponse } from "next/server"
import { requireServiceAuth } from '@/lib/cron-auth'
import { processMediaJobBatch } from '@/lib/media/jobs'

export const maxDuration = 300

/**
 * Cron endpoint that runs queued media jobs (long Transcribe / Analyze Video /
 * Redact Video / Media Utilities steps) and polls provider jobs. The
 * scheduler tick (/api/cron/tick) runs the same work every minute.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  try {
    const result = await processMediaJobBatch({ batchSize: 5, deadline: Date.now() + 240_000 })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 })
  }
}

export { GET as POST }
