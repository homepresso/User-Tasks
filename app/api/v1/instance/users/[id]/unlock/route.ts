import { apiRoute } from '@/lib/api/route'
import { unlockInstanceUserEndpoint } from '@/lib/api-schemas/instance'
import { clientIp } from '@/lib/scim/tokens'
import { runInstanceAction } from '@/lib/services/instance-admin'

/** Instance admin (cloud admin) API: instance admins only (404 for everyone else); see lib/api-schemas/instance.ts. */
export const POST = apiRoute(unlockInstanceUserEndpoint, async ({ ctx, params, body, request }) => ({ result: await runInstanceAction(ctx, 'unlock_user', { ...body, user_id: params.id }, { ip: clientIp(request), via: 'api' }) }))
