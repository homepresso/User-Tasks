import { NextResponse } from 'next/server'
import { instanceAdminRoute } from '@/lib/api/instance-admin-route'
import { configureAdminProcessingEndpoint, getAdminProcessingEndpoint } from '@/lib/api-schemas/instance-admin'
import { configureProcessing, loadProcessingStatus } from '@/lib/admin/processing-status'
import { apiError } from '@/lib/api/route'

/** GET /api/v1/admin/processing — where queued work runs, queue health, processing / stuck jobs (instance admin token). */
export const GET = instanceAdminRoute(getAdminProcessingEndpoint, async () => {
  return NextResponse.json({ success: true, data: await loadProcessingStatus() }, { headers: { 'Cache-Control': 'no-store' } })
})

/** PATCH /api/v1/admin/processing — processing mode / test-run option, through the processing add-on (instance admin token). */
export const PATCH = instanceAdminRoute(configureAdminProcessingEndpoint, async ({ body }) => {
  const result = await configureProcessing(body)
  if (!result.ok) return apiError(result.error, result.status)
  return NextResponse.json({ success: true, data: result.status }, { headers: { 'Cache-Control': 'no-store' } })
})
