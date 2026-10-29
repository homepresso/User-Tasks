import { NextRequest, NextResponse } from 'next/server'
import { requireServiceAuth } from '@/lib/cron-auth'
import { purgeFormFiles } from '@/lib/services/form-files'

/**
 * Delete expired pending form attachments and orphaned ones (task and
 * submission gone), with their stored objects (job registry
 * `form-files-cleanup`, every 15 minutes). Processor secret required.
 */

export const dynamic = 'force-dynamic'

async function handle(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized
  return NextResponse.json({ ok: true, ...(await purgeFormFiles({ deadline: Date.now() + 20_000 })) })
}

export const GET = handle
export const POST = handle
