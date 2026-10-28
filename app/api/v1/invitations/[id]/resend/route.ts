import { apiRoute } from '@/lib/api/route'
import { resendInvitationEndpoint } from '@/lib/api-schemas/governance'
import { resendInvitation } from '@/lib/services/invitations'

/** POST /api/v1/invitations/{id}/resend — fresh link and expiry, emailed again. */
export const POST = apiRoute(resendInvitationEndpoint, async ({ ctx, params }) => resendInvitation(ctx, params.id))
