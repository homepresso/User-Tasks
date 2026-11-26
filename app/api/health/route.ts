import { NextResponse } from 'next/server'
import { versionInfo } from '@/lib/version'

export const dynamic = 'force-dynamic'

/** Liveness (lib/health.ts): the process answers; no dependency checks. */
export function GET() {
  const { version } = versionInfo()
  return NextResponse.json({ status: 'ok', version }, { headers: { 'Cache-Control': 'no-store' } })
}
