import { apiRoute } from '@/lib/api/route'
import { listProjectMembersEndpoint } from '@/lib/api-schemas/org'
import { getProjectMembers } from '@/lib/services/projects'

/** GET /api/v1/projects/{id}/members — direct members ∪ attached teams' members. */
export const GET = apiRoute(listProjectMembersEndpoint, async ({ ctx, params, query }) =>
  getProjectMembers(ctx, params.id, { includeTeams: query.include_teams !== 'false' }))
