import { NextRequest, NextResponse } from 'next/server'
import { requireServiceAuth } from '@/lib/cron-auth'
import { processScheduledWorkflows } from '@/lib/jobs/schedules'

/** Cron sweep for schedule-triggered workflows (logic in lib/jobs/schedules.ts). */

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  try {
    return NextResponse.json(await processScheduledWorkflows())
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 })
  }
}

// Allow POST too so it can be kicked internally like the other processors.
export { GET as POST }
