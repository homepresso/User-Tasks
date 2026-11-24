import { apiRoute } from '@/lib/api/route'
import { changeInstanceMemberRoleEndpoint } from '@/lib/api-schemas/instance'
import { clientIp } from '@/lib/scim/tokens'
import { runInstanceAction } from '@/lib/services/instance-admin'

/** Instance admin (cloud admin) API: instance admins only (404 for everyone else); see lib/api-schemas/instance.ts. */
export const POST = apiRoute(changeInstanceMemberRoleEndpoint, async ({ ctx, params, body, request }) => ({ result: await runInstanceAction(ctx, 'change_role', { ...body, workspace_id: params.id, user_id: params.user_id }, { ip: clientIp(request), via: 'api' }) }))
