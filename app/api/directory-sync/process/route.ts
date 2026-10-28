import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient, requireServiceAuth } from '@/lib/cron-auth'
import { enqueueScheduledDirectorySyncs, processDirectorySyncRuns } from '@/lib/directory-sync/sync'

export const maxDuration = 60

/**
 * Directory sync worker. Driven by pg_cron every 10 minutes (hourly
 * auto-sync of enabled Entra/Okta connectors) and by in-app kicks after
 * "Sync now". Order matters: enqueue due scheduled runs first so this same
 * invocation can execute them. Runs need the service client — provisioning
 * uses auth.admin and writes across tenant RLS.
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized
  const supabase = createServiceClient()
  const scheduled = await enqueueScheduledDirectorySyncs(supabase as any).catch(() => 0)
  const runs = await processDirectorySyncRuns(supabase as any, `directory-worker-${crypto.randomUUID().slice(0, 8)}`)
  return NextResponse.json({ ok: true, scheduled, runs })
}

export { POST as GET }
