import { apiRoute } from '@/lib/api/route'
import { reactivateInstanceMemberEndpoint } from '@/lib/api-schemas/instance'
import { clientIp } from '@/lib/scim/tokens'
import { runInstanceAction } from '@/lib/services/instance-admin'

/** Instance admin (cloud admin) API: instance admins only (404 for everyone else); see lib/api-schemas/instance.ts. */
export const POST = apiRoute(reactivateInstanceMemberEndpoint, async ({ ctx, params, body, request }) => ({ result: await runInstanceAction(ctx, 'reactivate_member', { ...body, workspace_id: params.id, user_id: params.user_id }, { ip: clientIp(request), via: 'api' }) }))
