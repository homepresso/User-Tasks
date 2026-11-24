import { NextResponse } from 'next/server'
import { instanceAdminRoute } from '@/lib/api/instance-admin-route'
import { apiError } from '@/lib/api/route'
import { recoverAdminProcessingJobEndpoint } from '@/lib/api-schemas/instance-admin'
import { recoverStuckJob } from '@/lib/admin/processing-status'

/** POST /api/v1/admin/processing/jobs/{id}/recover — retry / cancel a stuck job, force-cancel a live one (instance admin token; audited). */
export const POST = instanceAdminRoute(recoverAdminProcessingJobEndpoint, async ({ params, body }) => {
  const result = await recoverStuckJob({ jobId: params.id, action: body.action, force: body.force, actorId: null, via: 'api' })
  if (!result.ok) return apiError(result.error, result.status)
  return NextResponse.json({ success: true, data: { action: result.action, lease_expired: result.lease_expired, forced: result.forced } }, { headers: { 'Cache-Control': 'no-store' } })
})
