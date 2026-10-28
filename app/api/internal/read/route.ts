import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { fromSession, isServiceError } from '@/lib/services/context'
import { runUiRead } from '@/lib/services/ui-reads'
import { MAX_READS_PER_BATCH } from '@/lib/server-read'

/**
 * Dashboard reads (providers phase 4): the browser's batched serverRead()
 * calls (lib/server-read.ts). Session cookie auth; each read runs as the
 * user on the cookie-bound client, so RLS applies as it did to the browser
 * queries these replace. Results come back in request order.
 */

const Body = z.object({
  reads: z.array(z.object({ name: z.string().min(1).max(100), args: z.unknown().optional() })).min(1).max(MAX_READS_PER_BATCH),
})

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest) {
  // JSON only: a cross-site form post can't send it without a CORS preflight.
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Expected application/json' }, { status: 415, headers: NO_STORE })
  }
  const body = Body.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE })

  let ctx
  try {
    ctx = await fromSession()
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE })
    throw error
  }

  const results = await Promise.all(body.data.reads.map((read) => runUiRead(ctx, read)))
  return NextResponse.json({ results }, { headers: NO_STORE })
}
