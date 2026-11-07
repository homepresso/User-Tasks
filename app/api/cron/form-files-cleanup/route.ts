import { NextRequest, NextResponse } from 'next/server'
import { requireServiceAuth } from '@/lib/cron-auth'
import { purgeFormFiles } from '@/lib/services/form-files'
import { purgeTaskAttachments } from '@/lib/services/task-attachments'

/**
 * Delete expired pending form attachments and orphaned ones (task and
 * submission gone), with their stored objects, and task attachments'
 * leftovers (lib/services/task-attachments.ts purgeTaskAttachments) (job registry
 * `form-files-cleanup`, every 15 minutes). Processor secret required.
 */

export const dynamic = 'force-dynamic'

async function handle(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized
  const deadline = Date.now() + 20_000
  const files = await purgeFormFiles({ deadline })
  return NextResponse.json({ ok: true, ...files, task_attachments: await purgeTaskAttachments({ deadline }) })
}

export const GET = handle
export const POST = handle
