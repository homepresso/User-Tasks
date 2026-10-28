import { NextResponse } from 'next/server'
import { apiRoute } from '@/lib/api/route'
import { downloadJobEndpoint } from '@/lib/api-schemas/jobs'
import { openJobDownload } from '@/lib/services/user-jobs'
import { jobDownloadResponse } from '@/lib/user-jobs/download'

/** GET /api/v1/jobs/{id}/download — the result file (attachment). */
export const GET = apiRoute(downloadJobEndpoint, async ({ ctx, params }) => {
  const response = jobDownloadResponse(await openJobDownload(ctx, params.id))
  return new NextResponse(response.body, { status: response.status, headers: response.headers })
})
