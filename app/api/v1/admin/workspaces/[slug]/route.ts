import { NextResponse } from 'next/server'
import { instanceAdminRoute } from '@/lib/api/instance-admin-route'
import { getAdminWorkspaceEndpoint } from '@/lib/api-schemas/instance-admin'
import { getWorkspaceBySlug } from '@/lib/services/instance-workspaces'

/** GET /api/v1/admin/workspaces/{slug} — a live workspace (instance admin token only). */
export const GET = instanceAdminRoute(getAdminWorkspaceEndpoint, async ({ params }) =>
  NextResponse.json({ success: true, data: await getWorkspaceBySlug(params.slug) }, { headers: { 'Cache-Control': 'no-store' } }))
