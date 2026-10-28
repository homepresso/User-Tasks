import { apiRoute } from '@/lib/api/route'
import { revokeInvitationEndpoint } from '@/lib/api-schemas/governance'
import { revokeInvitation } from '@/lib/services/invitations'

/** DELETE /api/v1/invitations/{id} — revoke. */
export const DELETE = apiRoute(revokeInvitationEndpoint, async ({ ctx, params }) => revokeInvitation(ctx, params.id))
