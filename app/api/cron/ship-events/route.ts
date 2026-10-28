import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient, requireServiceAuth } from '@/lib/cron-auth'
import { runShipper, SHIP_BUDGET_MS } from '@/lib/log-export/shipper'

/**
 * Log export shipper (lib/log-export/shipper.ts). pg_cron calls this every
 * minute (job usertasks-ship-events); each run drains due log destinations
 * for up to ~50 s, re-polling for new events every 2 s, so events usually
 * reach Splunk / Datadog / OTLP / webhooks within seconds. Runs lease
 * destinations, so overlapping or manual invocations never double-send.
 *
 * Optional `?budget_ms=` (1000–50000) shortens a run (manual checks).
 */

export const maxDuration = 60

async function handle(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  const raw = Number(request.nextUrl.searchParams.get('budget_ms'))
  const budgetMs = Number.isFinite(raw) && raw > 0 ? Math.min(SHIP_BUDGET_MS, Math.max(1000, Math.floor(raw))) : SHIP_BUDGET_MS
  try {
    const summary = await runShipper({ supabase: createServiceClient(), budgetMs })
    return NextResponse.json(summary)
  } catch (error) {
    console.error('[ship-events] run failed:', (error as Error).message)
    return NextResponse.json({ error: 'Shipper run failed' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
