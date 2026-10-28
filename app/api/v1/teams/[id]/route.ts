import { apiRoute } from '@/lib/api/route'
import { deleteTeamEndpoint, getTeamEndpoint, updateTeamEndpoint } from '@/lib/api-schemas/governance'
import { deleteTeam, getTeam, updateTeam } from '@/lib/services/teams'

/** GET /api/v1/teams/{id} — team with its members. */
export const GET = apiRoute(getTeamEndpoint, async ({ ctx, params }) => ({ team: await getTeam(ctx, params.id) }))

/** PATCH /api/v1/teams/{id} */
export const PATCH = apiRoute(updateTeamEndpoint, async ({ ctx, params, body }) => ({ team: await updateTeam(ctx, params.id, body) }))

/** DELETE /api/v1/teams/{id} — removes its memberships too. */
export const DELETE = apiRoute(deleteTeamEndpoint, async ({ ctx, params }) => deleteTeam(ctx, params.id))
