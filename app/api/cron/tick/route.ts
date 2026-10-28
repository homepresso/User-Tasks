import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/cron-auth'
import { getProviderConfig } from '@/lib/config'
import { runTick } from '@/lib/jobs/tick'
import { authorizeTickRequest } from '@/lib/scheduler/tick-auth'

/**
 * Scheduler tick. pg_cron's only job, `usertasks-tick`, calls this every
 * minute; it runs the jobs from lib/jobs/registry.ts that are due in that
 * minute (UTC) in-process, a few at a time, within ~50 s, and returns a
 * per-job summary. Overlapping ticks are skipped (lease in app_cron.tick_lock).
 *
 * Optional JSON body `{ "minute": "<ISO timestamp>" }`: the minute the
 * scheduler fired for (pg_cron sends date_trunc('minute', now())), so a
 * request delivered a few seconds late still runs that minute's jobs.
 * Ignored unless within 5 minutes of the server clock.
 *
 * Each job keeps its own endpoint for external schedulers and manual runs.
 *
 * Callers: pg_cron (default scheduler), or any external scheduler with the
 * cron secret, a Google Cloud Scheduler OIDC token or an Entra ID managed
 * identity token (lib/scheduler/tick-auth.ts). With SCHEDULER_PROVIDER=worker
 * the app ticks in-process and this endpoint is only for manual runs.
 */

export const maxDuration = 60

const MAX_MINUTE_SKEW_MS = 5 * 60_000

function requestedMinute(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || Math.abs(date.getTime() - Date.now()) > MAX_MINUTE_SKEW_MS) return undefined
  return date
}

let warnedPgCron = false

/** pg_net (pg_cron) still calling while another scheduler provider is active: say so once per process. */
async function warnPgCronCaller(request: NextRequest): Promise<void> {
  if (warnedPgCron || !/^pg_net\//i.test(request.headers.get('user-agent') ?? '')) return
  const { id } = await getProviderConfig('scheduler').catch(() => ({ id: 'pg_cron' as const }))
  if (id === 'pg_cron') return
  warnedPgCron = true
  console.warn(`[cron-tick] pg_cron still calls the tick but SCHEDULER_PROVIDER=${id}; remove the job with \`npm run scheduler -- uninstall-pg-cron\``)
}

async function handle(request: NextRequest) {
  const auth = await authorizeTickRequest(request)
  if (auth instanceof NextResponse) return auth
  void warnPgCronCaller(request)

  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
  const minute = requestedMinute((body as { minute?: unknown } | null)?.minute ?? request.nextUrl.searchParams.get('minute'))

  try {
    const summary = await runTick({ supabase: createServiceClient(), minute })
    return NextResponse.json(summary)
  } catch (error) {
    console.error('[cron-tick] failed:', (error as Error).message)
    return NextResponse.json({ ok: false, error: 'Tick failed' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
