import { NextRequest, NextResponse } from 'next/server'
import { requireServiceAuth } from '@/lib/cron-auth'
import { processUserJobs } from '@/lib/user-jobs/runner'

/**
 * Drain due background jobs (lost starts, retries, the next chunk of long
 * jobs, jobs whose invocation died) — the runner's own kick and external
 * schedulers; the tick runs the same work as `user-jobs`
 * (lib/jobs/registry.ts). Processor secret required.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized
  return NextResponse.json({ ok: true, ...(await processUserJobs({ budgetMs: 50_000 })) })
}

export const GET = handle
export const POST = handle
