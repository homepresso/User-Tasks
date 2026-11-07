import { apiRoute } from '@/lib/api/route'
import { getOrgTeamTreeEndpoint } from '@/lib/api-schemas/org'
import { getTeamTree } from '@/lib/services/org'

/** GET /api/v1/org/teams — the team tree. */
export const GET = apiRoute(getOrgTeamTreeEndpoint, async ({ ctx }) => getTeamTree(ctx))
