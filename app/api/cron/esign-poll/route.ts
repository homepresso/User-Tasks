import { NextRequest, NextResponse } from "next/server"
import { requireServiceAuth } from '@/lib/cron-auth'
import { pollDueWaits } from '@/lib/esign/waits'

export const maxDuration = 120

/**
 * Cron endpoint for "Wait for signature" steps: polls the envelopes of due
 * waits (the fallback when webhooks are not configured), resumes final ones
 * and times out expired waits. The scheduler tick (/api/cron/tick) runs the
 * same work every minute.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  try {
    const result = await pollDueWaits({ batchSize: 20, deadline: Date.now() + 90_000 })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 })
  }
}

export { GET as POST }
