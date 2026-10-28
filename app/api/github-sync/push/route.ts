import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient, requireServiceAuth } from '@/lib/cron-auth'
import { enqueueScheduledSyncs, processAllPendingPushes, processSyncRuns } from '@/lib/github-sync/push'

export const maxDuration = 60

/**
 * GitHub sync push worker. Driven by pg_cron every minute (auto-mode
 * tenants + scheduled syncs) and by in-app kicks after saves or a
 * "Push everything" click. Queue-mode tenants' pending rows wait for an
 * explicit commit. Order matters: enqueue due scheduled runs first so this
 * same invocation can execute them.
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized
  const supabase = createServiceClient()
  const scheduled = await enqueueScheduledSyncs(supabase as any).catch(() => 0)
  const runs = await processSyncRuns(supabase as any, `push-worker-${crypto.randomUUID().slice(0, 8)}`)
  const result = await processAllPendingPushes(supabase as any)
  return NextResponse.json({ ok: true, scheduled, runs, ...result })
}

export { POST as GET }
