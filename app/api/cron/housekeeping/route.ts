import { NextRequest, NextResponse } from 'next/server'
import { requireServiceAuth } from '@/lib/cron-auth'
import { runHousekeepingJob } from '@/lib/jobs/housekeeping'

/** One instance housekeeping pass now, whatever the scheduler (lib/jobs/housekeeping.ts). */
export async function GET(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  return NextResponse.json(await runHousekeepingJob({ force: true }))
}
