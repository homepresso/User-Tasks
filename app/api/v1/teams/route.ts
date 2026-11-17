import { apiRoute } from '@/lib/api/route'
import { createTeamEndpoint, listTeamsEndpoint } from '@/lib/api-schemas/governance'
import { createTeam, listTeams } from '@/lib/services/teams'

/** GET /api/v1/teams?search=&origin=&limit= — teams with member counts and origin. */
export const GET = apiRoute(listTeamsEndpoint, async ({ ctx, query }) => listTeams(ctx, { search: query.search, origin: query.origin, limit: query.limit }))

/** POST /api/v1/teams */
export const POST = apiRoute(createTeamEndpoint, async ({ ctx, body }) => ({ team: await createTeam(ctx, body) }))
