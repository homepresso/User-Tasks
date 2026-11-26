import { NextResponse } from 'next/server'
import { checkReadiness } from '@/lib/health'

export const dynamic = 'force-dynamic'

/** Readiness (lib/health.ts): 200 when the database answers, else 503. */
export async function GET() {
  const result = await checkReadiness()
  return NextResponse.json(
    { status: result.ready ? 'ready' : 'unavailable', checks: result.checks },
    { status: result.ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
