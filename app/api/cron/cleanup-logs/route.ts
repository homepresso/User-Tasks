import { NextRequest, NextResponse } from 'next/server'
import { requireServiceAuth } from '@/lib/cron-auth'
import { cleanupExpiredLogs } from '@/lib/jobs/cleanup-logs'

/** Daily log / queue / OAuth row cleanup (logic and retention rules in lib/jobs/cleanup-logs.ts). */
export async function GET(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  return NextResponse.json(await cleanupExpiredLogs())
}
