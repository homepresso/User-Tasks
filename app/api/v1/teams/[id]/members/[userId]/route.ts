import { apiRoute } from '@/lib/api/route'
import { addTeamMemberEndpoint, removeTeamMemberEndpoint } from '@/lib/api-schemas/governance'
import { addTeamMember, removeTeamMember } from '@/lib/services/teams'

/** PUT /api/v1/teams/{id}/members/{userId} — idempotent. */
export const PUT = apiRoute(addTeamMemberEndpoint, async ({ ctx, params, body }) => addTeamMember(ctx, params.id, params.userId, body.role))

/** DELETE /api/v1/teams/{id}/members/{userId} */
export const DELETE = apiRoute(removeTeamMemberEndpoint, async ({ ctx, params }) => removeTeamMember(ctx, params.id, params.userId))
