import { apiRoute } from '@/lib/api/route'
import { extendInstanceTrialEndpoint } from '@/lib/api-schemas/instance'
import { clientIp } from '@/lib/scim/tokens'
import { runInstanceAction } from '@/lib/services/instance-admin'

/** Instance admin (cloud admin) API: instance admins only (404 for everyone else); see lib/api-schemas/instance.ts. */
export const POST = apiRoute(extendInstanceTrialEndpoint, async ({ ctx, params, body, request }) => ({ result: await runInstanceAction(ctx, 'extend_trial', { ...body, workspace_id: params.id, extension_id: params.extension_id }, { ip: clientIp(request), via: 'api' }) }))
