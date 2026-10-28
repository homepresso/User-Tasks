import { NextRequest, NextResponse } from 'next/server'
import { requireServiceAuth } from '@/lib/cron-auth'
import { purgeExpiredUserJobs } from '@/lib/user-jobs/runner'

/**
 * Delete expired background jobs and their stored files (job registry
 * `user-jobs-cleanup`, every 15 minutes). Processor secret required.
 */

export const dynamic = 'force-dynamic'

async function handle(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized
  return NextResponse.json({ ok: true, ...(await purgeExpiredUserJobs({ deadline: Date.now() + 20_000 })) })
}

export const GET = handle
export const POST = handle
