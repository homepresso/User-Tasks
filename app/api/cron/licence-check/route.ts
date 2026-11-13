import { NextRequest, NextResponse } from 'next/server'
import { requireServiceAuth } from '@/lib/cron-auth'
import { runLicenceCheck } from '@/lib/jobs/licence-check'

/** The daily licence check now: expiry notices to instance admins (lib/jobs/licence-check.ts). */
export async function GET(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  return NextResponse.json(await runLicenceCheck())
}
