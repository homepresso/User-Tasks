import { NextRequest, NextResponse } from 'next/server'
import { requireServiceAuth } from '@/lib/cron-auth'
import { runProviderSwitchesJob } from '@/lib/jobs/provider-switches'

/** Start the background runner for queued provider switches (lib/jobs/provider-switches.ts). */
export async function GET(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  return NextResponse.json(await runProviderSwitchesJob())
}
