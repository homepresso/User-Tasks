import type { NextRequest } from 'next/server'
import { fromSession } from '@/lib/services/context'
import { openJobDownload } from '@/lib/services/user-jobs'
import { jobDownloadError, jobDownloadResponse } from '@/lib/user-jobs/download'

/**
 * GET /api/jobs/<id>/download — the result file of one of the signed-in
 * user's background jobs (Jobs panel, completion popup, bell notification).
 * Owner only; other users' jobs are 404, expired results 410.
 */

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    return jobDownloadResponse(await openJobDownload(await fromSession(), id))
  } catch (error) {
    return jobDownloadError(error)
  }
}
