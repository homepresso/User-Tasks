import { apiRoute } from '@/lib/api/route'
import { resendInstanceInvitationEndpoint } from '@/lib/api-schemas/instance'
import { clientIp } from '@/lib/scim/tokens'
import { runInstanceAction } from '@/lib/services/instance-admin'

/** Instance admin (cloud admin) API: instance admins only (404 for everyone else); see lib/api-schemas/instance.ts. */
export const POST = apiRoute(resendInstanceInvitationEndpoint, async ({ ctx, params, body, request }) => ({ result: await runInstanceAction(ctx, 'resend_invitation', { ...body, invitation_id: params.id }, { ip: clientIp(request), via: 'api' }) }))
