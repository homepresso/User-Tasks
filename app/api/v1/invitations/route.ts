import { apiRoute } from '@/lib/api/route'
import { listInvitationsEndpoint, sendInvitationEndpoint } from '@/lib/api-schemas/governance'
import { resolvePage } from '@/lib/services/_shared'
import { listInvitations, sendInvitation } from '@/lib/services/invitations'

/** GET /api/v1/invitations — pending by default; tokens are never returned. */
export const GET = apiRoute(listInvitationsEndpoint, async ({ ctx, query }) => listInvitations(ctx, { status: query.status }, resolvePage(query)))

/** POST /api/v1/invitations — create and email an invitation. */
export const POST = apiRoute(sendInvitationEndpoint, async ({ ctx, body }) => sendInvitation(ctx, body))
