import { apiRoute } from '@/lib/api/route'
import { createTeamEndpoint, listTeamsEndpoint } from '@/lib/api-schemas/governance'
import { createTeam, listTeams } from '@/lib/services/teams'

/** GET /api/v1/teams — teams with member counts. */
export const GET = apiRoute(listTeamsEndpoint, async ({ ctx }) => listTeams(ctx))

/** POST /api/v1/teams */
export const POST = apiRoute(createTeamEndpoint, async ({ ctx, body }) => ({ team: await createTeam(ctx, body) }))
