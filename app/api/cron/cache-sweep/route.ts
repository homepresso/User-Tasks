import { NextRequest, NextResponse } from 'next/server'
import { requireServiceAuth } from '@/lib/cron-auth'
import { sweepCacheStore } from '@/lib/jobs/cache-sweep'

/** Expired rows of the postgres cache store (lib/jobs/cache-sweep.ts). */
export async function GET(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  return NextResponse.json(await sweepCacheStore())
}
