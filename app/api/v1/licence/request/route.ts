import { NextResponse } from 'next/server'
import { instanceAdminRoute } from '@/lib/api/instance-admin-route'
import { getLicenceRequestEndpoint } from '@/lib/api-schemas/licence'
import { licenceActivationRequest } from '@/lib/licensing/admin'

/** GET /api/v1/licence/request — the offline activation request (instance admin token only). */
export const GET = instanceAdminRoute(getLicenceRequestEndpoint, async () => {
  return NextResponse.json({ success: true, data: await licenceActivationRequest() }, { headers: { 'Cache-Control': 'no-store' } })
})
