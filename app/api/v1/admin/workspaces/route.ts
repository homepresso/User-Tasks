import { NextResponse } from 'next/server'
import { instanceAdminRoute } from '@/lib/api/instance-admin-route'
import { createAdminWorkspaceEndpoint } from '@/lib/api-schemas/instance-admin'
import { createWorkspace } from '@/lib/services/instance-workspaces'

/**
 * POST /api/v1/admin/workspaces — create a workspace with its owner
 * (instance admin token only; idempotent on slug: 201 created, 200 existing).
 */
export const POST = instanceAdminRoute(createAdminWorkspaceEndpoint, async ({ body, ip }) => {
  const result = await createWorkspace(body, { ip })
  return NextResponse.json({ success: true, data: result }, {
    status: result.created ? 201 : 200,
    headers: { 'Cache-Control': 'no-store' },
  })
})
