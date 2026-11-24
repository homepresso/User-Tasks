import { apiRoute } from '@/lib/api/route'
import { inviteInstanceUserEndpoint, listInstanceInvitationsEndpoint } from '@/lib/api-schemas/instance'
import { clientIp } from '@/lib/scim/tokens'
import { readInstanceDataset, runInstanceAction } from '@/lib/services/instance-admin'

/** Instance admin (cloud admin) API: instance admins only (404 for everyone else); see lib/api-schemas/instance.ts. */
export const GET = apiRoute(listInstanceInvitationsEndpoint, async ({ ctx, query }) => readInstanceDataset(ctx, 'invitations', query, { via: 'api' }))
export const POST = apiRoute(inviteInstanceUserEndpoint, async ({ ctx, body, request }) => ({ result: await runInstanceAction(ctx, 'invite_user', body, { ip: clientIp(request), via: 'api' }) }))
