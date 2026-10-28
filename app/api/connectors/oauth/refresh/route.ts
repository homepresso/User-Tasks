import { NextRequest, NextResponse } from 'next/server'
import { requireServiceAuth } from '@/lib/cron-auth'
import { refreshExpiringConnectorTokens } from '@/lib/jobs/oauth-refresh'

export const maxDuration = 60

/** Connector OAuth token warm-keeper (logic in lib/jobs/oauth-refresh.ts). */
export async function POST(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized
  return NextResponse.json(await refreshExpiringConnectorTokens())
}

export { POST as GET }
