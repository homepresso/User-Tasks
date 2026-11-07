import { apiRoute } from '@/lib/api/route'
import { listOrgPersonTeamsEndpoint } from '@/lib/api-schemas/org'
import { getMyTeams } from '@/lib/services/org'

/** GET /api/v1/org/people/{id}/teams — teams the person is in (with the teams above). */
export const GET = apiRoute(listOrgPersonTeamsEndpoint, async ({ ctx, params }) => getMyTeams(ctx, params.id))
