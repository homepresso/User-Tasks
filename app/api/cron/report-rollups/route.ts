import { NextRequest, NextResponse } from 'next/server'
import { requireServiceAuth } from '@/lib/cron-auth'
import { runReportRollupsJob } from '@/lib/jobs/report-rollups'

/** Report rollups maintenance: queued rebuilds, backfill, reconcile (lib/jobs/report-rollups.ts). */
export async function GET(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  return NextResponse.json(await runReportRollupsJob({ deadline: Date.now() + 25_000 }))
}
